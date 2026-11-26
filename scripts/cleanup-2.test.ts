/**
 * CLEANUP-2: store-eligibility data is read once per request on the product list / search page and the product page,
 * and the stale store-hours migration pin is fixed.
 *
 * (i)   A counting fake database runs the same wiring as the pages: before = two eligibility reads per render path,
 *       after = one.
 * (ii)  The old two-read wiring and the new one-read wiring return identical results on the same fixture (eligible,
 *       legal data missing, expired subscription, suspended, admin-managed, complimentary current / ended stores;
 *       draft, archived and out-of-stock products; search, store filter, both sorts, a second page, >100 stores).
 * (iii) The store-hours migration pin checks order, not "newest".
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { createPrismaPublicProductCatalogSelectClient, findPublicProductCatalogPage } from "../lib/public-product-catalog";
import { createPrismaPublicStoreDiscoveryClient, findPublicStoreDiscoveryCursorPage } from "../lib/public-store-discovery";
import { resolvePublicStoreEligibility, type PublicStoreCandidate } from "../lib/public-store-eligibility";
import { createPublicStoreEligibilityMemo } from "../lib/public-store-eligibility-memo";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");

// ---------------------------------------------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------------------------------------------

const NOW = new Date("2026-11-26T10:00:00.000Z");
const PAST = new Date("2026-11-01T00:00:00.000Z");
const FUTURE = new Date("2027-01-01T00:00:00.000Z");

type StoreRow = PublicStoreCandidate & { name: string; slug: string; description: string | null; cityName: string };
type ProductRow = { id: string; name: string; status: string; createdAt: Date; storeId: string; sku: string | null; description: string | null; stock: number };

function store(id: string, name: string, overrides: Partial<StoreRow> = {}): StoreRow {
  return {
    id, name, slug: id, description: null, cityName: "Baki",
    status: "ACTIVE", isActive: true, legalInfoApproved: true, adminManaged: false,
    city: { isActive: true },
    vendor: { user: { isActive: true }, sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: `${name} MMC`, voen: "1234567890", legalAddress: null },
    subscription: { status: "ACTIVE", currentPeriodStart: PAST, currentPeriodEnd: FUTURE, plan: { isActive: true, slug: "basic" } },
    complimentaryEntitlements: [],
    ...overrides,
  };
}

const baseStores: StoreRow[] = [
  store("s-eligible", "Alma"),
  store("s-legal-missing", "Bakkal", { legalInfoApproved: false }),
  store("s-no-voen", "Ceviz", { vendor: { user: { isActive: true }, sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: "Ceviz", voen: null, legalAddress: null } }),
  store("s-expired", "Dad", { subscription: { status: "ACTIVE", currentPeriodStart: PAST, currentPeriodEnd: new Date("2026-11-20T00:00:00.000Z"), plan: { isActive: true, slug: "basic" } } }),
  store("s-suspended", "Elma", { status: "SUSPENDED", isActive: false }),
  store("s-admin", "Feyruz", { adminManaged: true, subscription: null }),
  store("s-comp", "Gul", { subscription: null, complimentaryEntitlements: [{ tier: "BASIC", endsAt: FUTURE }] }),
  store("s-comp-ended", "Hilal", { subscription: null, complimentaryEntitlements: [{ tier: "BASIC", endsAt: PAST }] }),
  store("s-user-off", "Ilgar", { vendor: { user: { isActive: false }, sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: "Ilgar MMC", voen: "1234567890", legalAddress: null } }),
];

let clock = 0;
function product(id: string, storeId: string, overrides: Partial<ProductRow> = {}): ProductRow {
  clock += 1;
  return {
    id, storeId, name: `Mehsul ${id}`, status: "ACTIVE", createdAt: new Date(Date.UTC(2026, 10, 1, 0, clock)),
    sku: `SKU-${id}`, description: null, stock: 5, ...overrides,
  };
}

const baseProducts: ProductRow[] = [
  product("p-1", "s-eligible", { name: "Alma sirəsi" }),
  product("p-2", "s-eligible", { name: "Armud", stock: 0 }), // out of stock: still listed (stock is not a visibility rule)
  product("p-draft", "s-eligible", { status: "DRAFT" }),
  product("p-archived", "s-eligible", { status: "ARCHIVED" }),
  product("p-legal", "s-legal-missing"),
  product("p-novoen", "s-no-voen"),
  product("p-expired", "s-expired"),
  product("p-suspended", "s-suspended"),
  product("p-admin", "s-admin", { name: "Alma qurusu" }),
  product("p-comp", "s-comp"),
  product("p-comp-ended", "s-comp-ended"),
  product("p-user-off", "s-user-off"),
];

// ---------------------------------------------------------------------------------------------------------------
// Counting fake Prisma client. Scalar filters, cursors, search (contains) and ordering are evaluated; relation
// filters (store, city, vendor, subscription, complimentary grants, category) are treated as "match", so products and
// stores of INELIGIBLE stores reach the code and must be removed by isPublicStoreEligible in both paths.
// ---------------------------------------------------------------------------------------------------------------

const RELATION_KEYS = new Set(["store", "category", "city", "vendor", "subscription", "complimentaryEntitlements"]);

function matches(row: Record<string, unknown>, where: unknown, storeOf?: (row: Record<string, unknown>) => Record<string, unknown>): boolean {
  if (!where || typeof where !== "object") return true;
  for (const [key, condition] of Object.entries(where as Record<string, unknown>)) {
    if (key === "AND") { if (!(condition as unknown[]).every((part) => matches(row, part, storeOf))) return false; continue; }
    if (key === "OR") { if (!(condition as unknown[]).some((part) => matches(row, part, storeOf))) return false; continue; }
    // A product's store filter: the store's own scalar columns (isActive, status, legalInfoApproved, id) are checked
    // like the database does; its relation filters are still treated as "match".
    if (key === "store" && storeOf) {
      const storeWhere = (condition as { is?: unknown }).is ?? condition;
      if (!matches(storeOf(row), storeWhere)) return false;
      continue;
    }
    if (RELATION_KEYS.has(key)) continue;
    const value = row[key] as string | number | Date | boolean | null;
    if (condition !== null && typeof condition === "object" && !(condition instanceof Date)) {
      const ops = condition as Record<string, unknown>;
      const cmp = (other: unknown) => (value instanceof Date ? value.getTime() : value as string) < (other instanceof Date ? other.getTime() : other as string) ? -1
        : (value instanceof Date ? value.getTime() : value as string) > (other instanceof Date ? other.getTime() : other as string) ? 1 : 0;
      if ("in" in ops && !(ops.in as unknown[]).includes(value)) return false;
      if ("gt" in ops && !(cmp(ops.gt) > 0)) return false;
      if ("lt" in ops && !(cmp(ops.lt) < 0)) return false;
      if ("not" in ops && value === ops.not) return false;
      if ("contains" in ops && !String(value ?? "").toLowerCase().includes(String(ops.contains).toLowerCase())) return false;
      continue;
    }
    const plain = condition instanceof Date ? condition.getTime() : condition;
    if ((value instanceof Date ? value.getTime() : value) !== plain) return false;
  }
  return true;
}

function ordered<T extends Record<string, unknown>>(rows: T[], orderBy: unknown): T[] {
  const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Record<string, "asc" | "desc">[];
  return [...rows].sort((a, b) => {
    for (const part of keys) {
      const [field, direction] = Object.entries(part)[0];
      const left = a[field] instanceof Date ? (a[field] as Date).getTime() : a[field] as string;
      const right = b[field] instanceof Date ? (b[field] as Date).getTime() : b[field] as string;
      if (left === right) continue;
      return (left < right ? -1 : 1) * (direction === "asc" ? 1 : -1);
    }
    return 0;
  });
}

const eligibilityFields = (row: StoreRow): PublicStoreCandidate => ({
  id: row.id, status: row.status, isActive: row.isActive, legalInfoApproved: row.legalInfoApproved, adminManaged: row.adminManaged,
  city: row.city, vendor: row.vendor, subscription: row.subscription, complimentaryEntitlements: row.complimentaryEntitlements,
});

type Args = { where?: unknown; select?: Record<string, unknown>; orderBy?: unknown; take?: number };

function fakeDb(stores: StoreRow[], products: ProductRow[]) {
  const storeById = new Map(stores.map((row) => [row.id, row]));
  const counts = { eligibilityReads: 0, storeEligibilityReads: 0, nestedEligibilityReads: 0, calls: 0 };
  const loadsEligibility = (select: Record<string, unknown> | undefined) => Boolean(select && "complimentaryEntitlements" in select);
  const db = {
    store: {
      findMany: async (args: Args) => {
        counts.calls += 1;
        if (loadsEligibility(args.select)) { counts.eligibilityReads += 1; counts.storeEligibilityReads += 1; }
        const rows = ordered(stores.filter((row) => matches(row as unknown as Record<string, unknown>, args.where)) as unknown as Record<string, unknown>[], args.orderBy);
        const taken = (args.take === undefined ? rows : rows.slice(0, args.take)) as unknown as StoreRow[];
        if (loadsEligibility(args.select)) return taken.map((row) => ({ ...eligibilityFields(row), ...("name" in (args.select ?? {}) ? { name: row.name } : {}) }));
        return taken.map((row) => ({ id: row.id, name: row.name, slug: row.slug, description: row.description, city: { name: row.cityName, slug: "baki" } }));
      },
    },
    product: {
      findMany: async (args: Args) => {
        counts.calls += 1;
        const nested = (args.select?.store as { select?: Record<string, unknown> } | undefined)?.select;
        if (loadsEligibility(nested)) { counts.eligibilityReads += 1; counts.nestedEligibilityReads += 1; }
        const storeOf = (row: Record<string, unknown>) => storeById.get(row.storeId as string) as unknown as Record<string, unknown>;
        const rows = ordered(products.filter((row) => matches(row as unknown as Record<string, unknown>, args.where, storeOf)) as unknown as Record<string, unknown>[], args.orderBy);
        const taken = (args.take === undefined ? rows : rows.slice(0, args.take)) as unknown as ProductRow[];
        if (loadsEligibility(nested)) {
          return taken.map((row) => ({ id: row.id, status: row.status, name: row.name, createdAt: row.createdAt, store: eligibilityFields(storeById.get(row.storeId)!) }));
        }
        if (args.select && "storeId" in args.select && !("price" in args.select)) {
          return taken.map((row) => ({ id: row.id, status: row.status, name: row.name, createdAt: row.createdAt, storeId: row.storeId }));
        }
        // Page records (the card select): the whole fixture row, plus the store name as the card shows it.
        return taken.map((row) => ({ ...row, store: { id: row.storeId, name: storeById.get(row.storeId)!.name } }));
      },
    },
  };
  return { db, counts };
}

// The card select the list page passes; the fake returns full rows for it, so only the key set matters.
const cardSelect = { id: true, storeId: true, name: true, price: true } as const;

type ListParams = { city?: string; store?: string; q?: string; category?: string; sort: "newest" | "name"; cursor?: string };

/** The list page's wiring BEFORE CLEANUP-2 (app/(customer)/products/(list)/page.tsx at f582839). */
async function listPageBefore(db: ReturnType<typeof fakeDb>["db"], params: ListParams) {
  const [storePage, selectedStore, products] = await Promise.all([
    findPublicStoreDiscoveryCursorPage(createPrismaPublicStoreDiscoveryClient(db as never), { citySlug: params.city }, { now: NOW, pageSize: 20, allowMissingRecords: true }),
    params.store ? Promise.resolve({ id: params.store }) : Promise.resolve(null),
    findPublicProductCatalogPage(createPrismaPublicProductCatalogSelectClient(db as never, cardSelect),
      { citySlug: params.city, storeId: params.store, categorySlug: params.category, query: params.q, searchFields: "catalog" },
      { sort: params.sort, now: NOW, limit: 48, paginate: true, allowMissingRecords: true, ...(params.cursor ? { cursor: params.cursor } : {}) }),
  ]);
  const selected = selectedStore ? await resolvePublicStoreEligibility([selectedStore.id], db as never, NOW) : new Set<string>();
  return { storePage, products, selected: [...selected] };
}

/** The list page's wiring AFTER CLEANUP-2: one request memo shared by the store scan, the product scan and ?store=. */
async function listPageAfter(db: ReturnType<typeof fakeDb>["db"], params: ListParams) {
  const storeEligibility = createPublicStoreEligibilityMemo(db as never);
  const [storePage, selectedStore, products] = await Promise.all([
    findPublicStoreDiscoveryCursorPage(createPrismaPublicStoreDiscoveryClient(db as never, storeEligibility), { citySlug: params.city }, { now: NOW, pageSize: 20, allowMissingRecords: true }),
    params.store ? Promise.resolve({ id: params.store }) : Promise.resolve(null),
    findPublicProductCatalogPage(createPrismaPublicProductCatalogSelectClient(db as never, cardSelect, storeEligibility),
      { citySlug: params.city, storeId: params.store, categorySlug: params.category, query: params.q, searchFields: "catalog" },
      { sort: params.sort, now: NOW, limit: 48, paginate: true, allowMissingRecords: true, ...(params.cursor ? { cursor: params.cursor } : {}) }),
  ]);
  const selected = selectedStore ? await storeEligibility.resolve([selectedStore.id], NOW) : new Set<string>();
  return { storePage, products, selected: [...selected] };
}

/** The product page: generateMetadata + page, before (two reads) and after (one request memo). */
async function productPageBefore(db: ReturnType<typeof fakeDb>["db"], storeId: string) {
  const meta = await resolvePublicStoreEligibility([storeId], db as never, NOW);
  const page = await resolvePublicStoreEligibility([storeId], db as never, NOW);
  return { meta: meta.has(storeId), page: page.has(storeId) };
}
async function productPageAfter(db: ReturnType<typeof fakeDb>["db"], storeId: string, concurrent = false) {
  const memo = createPublicStoreEligibilityMemo(db as never);
  const [meta, page] = concurrent
    ? await Promise.all([memo.resolve([storeId], NOW), memo.resolve([storeId], NOW)])
    : [await memo.resolve([storeId], NOW), await memo.resolve([storeId], NOW)];
  return { meta: meta.has(storeId), page: page.has(storeId) };
}

const ELIGIBLE = ["s-eligible", "s-admin", "s-comp"];

// ---------------------------------------------------------------------------------------------------------------
// (i) one eligibility read per render path
// ---------------------------------------------------------------------------------------------------------------

test("(i) list / search page: before 2 eligibility reads (store scan + nested in product scan), after 1", async () => {
  for (const params of [{ sort: "newest" }, { sort: "name" }, { sort: "newest", q: "alma" }, { sort: "newest", store: "s-eligible" }] as ListParams[]) {
    const before = fakeDb(baseStores, baseProducts);
    await listPageBefore(before.db, params);
    const after = fakeDb(baseStores, baseProducts);
    await listPageAfter(after.db, params);
    const label = JSON.stringify(params);
    // ?store= adds a third read before (resolvePublicStoreEligibility for the selected store); after it is remembered.
    assert.equal(before.counts.eligibilityReads, params.store ? 3 : 2, `before ${label}`);
    assert.equal(before.counts.nestedEligibilityReads, 1, `before nested ${label}`);
    assert.equal(after.counts.eligibilityReads, 1, `after ${label}`);
    assert.equal(after.counts.nestedEligibilityReads, 0, `after: the product scan no longer loads store eligibility ${label}`);
  }
});

test("(i) product page: before 2 eligibility reads (generateMetadata + page), after 1 (also when both run at once)", async () => {
  const before = fakeDb(baseStores, baseProducts);
  await productPageBefore(before.db, "s-eligible");
  assert.equal(before.counts.eligibilityReads, 2);
  for (const concurrent of [false, true]) {
    const after = fakeDb(baseStores, baseProducts);
    await productPageAfter(after.db, "s-eligible", concurrent);
    assert.equal(after.counts.eligibilityReads, 1, `concurrent=${concurrent}`);
  }
});

test("(i) the memo only reads stores it has not seen; a failed read is reported and retried by the next call", async () => {
  const { db, counts } = fakeDb(baseStores, baseProducts);
  const memo = createPublicStoreEligibilityMemo(db as never);
  assert.deepEqual([...await memo.resolve(["s-eligible", "s-expired"], NOW)], ["s-eligible"]);
  assert.deepEqual([...await memo.resolve(["s-expired", "s-eligible", "s-eligible"], NOW)], ["s-eligible"]);
  assert.equal(counts.eligibilityReads, 1);
  await memo.resolve(["s-admin"], NOW);
  assert.equal(counts.eligibilityReads, 2, "only the new id is read");

  let fail = true;
  const flaky = createPublicStoreEligibilityMemo({ store: { findMany: async (args: never) => {
    if (fail) { fail = false; throw new Error("DB_DOWN"); }
    return db.store.findMany(args);
  } } } as never);
  await assert.rejects(flaky.resolve(["s-eligible"], NOW), /DB_DOWN/);
  assert.deepEqual([...await flaky.resolve(["s-eligible"], NOW)], ["s-eligible"]);
});

// ---------------------------------------------------------------------------------------------------------------
// (ii) old two-read path === new one-read path
// ---------------------------------------------------------------------------------------------------------------

async function assertSameList(stores: StoreRow[], products: ProductRow[], params: ListParams) {
  const before = await listPageBefore(fakeDb(stores, products).db, params);
  const after = await listPageAfter(fakeDb(stores, products).db, params);
  assert.deepEqual(after, before, JSON.stringify(params));
  return before;
}

test("(ii) list / search: identical stores, products, order, cursors and ?store= result on the mixed fixture", async () => {
  const all = await assertSameList(baseStores, baseProducts, { sort: "newest" });
  // Sanity: the fixture really exercises the rules.
  assert.deepEqual(all.products.items.map((item) => (item as unknown as ProductRow).id).sort(), ["p-1", "p-2", "p-admin", "p-comp"]);
  assert.deepEqual(all.storePage.items.map((item) => item.id), ["s-eligible", "s-admin", "s-comp"]);
  for (const params of [
    { sort: "name" }, { sort: "newest", q: "alma" }, { sort: "name", q: "SKU-P" }, { sort: "newest", q: "yoxdur" },
    ...[...baseStores.map((row) => row.id), "s-unknown"].map((id) => ({ sort: "newest", store: id })),
  ] as ListParams[]) {
    const result = await assertSameList(baseStores, baseProducts, params);
    if (params.store) assert.deepEqual(result.selected, ELIGIBLE.includes(params.store) ? [params.store] : [], params.store);
  }
});

test("(ii) list: identical with more than 100 stores (memo misses are read) and on the second page", async () => {
  const stores = [...baseStores];
  const products = [...baseProducts];
  for (let index = 0; index < 130; index += 1) {
    const id = `s-many-${String(index).padStart(3, "0")}`;
    // Every 4th store has an expired subscription, every 7th is suspended.
    stores.push(store(id, `Z ${String(index).padStart(3, "0")}`, index % 4 === 0
      ? { subscription: { status: "ACTIVE", currentPeriodStart: PAST, currentPeriodEnd: PAST, plan: { isActive: true, slug: "basic" } } }
      : index % 7 === 0 ? { status: "SUSPENDED", isActive: false } : {}));
    products.push(product(`p-many-${index}`, id), product(`p-many-${index}-draft`, id, { status: "DRAFT" }));
  }
  for (const sort of ["newest", "name"] as const) {
    const first = await assertSameList(stores, products, { sort });
    assert.equal(first.products.items.length, 48);
    assert.ok(first.products.nextCursor, "there is a second page");
    const second = await assertSameList(stores, products, { sort, cursor: first.products.nextCursor! });
    assert.ok(second.products.items.length > 0);
  }
  // The memo reads only the stores the store scan did not bring, and still one eligibility read for them per batch.
  const after = fakeDb(stores, products);
  await listPageAfter(after.db, { sort: "name" });
  assert.equal(after.counts.nestedEligibilityReads, 0);
});

test("(ii) product page: identical 404 / public answer for every store in the fixture", async () => {
  for (const row of [...baseStores, { id: "s-unknown" }]) {
    const before = await productPageBefore(fakeDb(baseStores, baseProducts).db, row.id);
    const after = await productPageAfter(fakeDb(baseStores, baseProducts).db, row.id);
    assert.deepEqual(after, before, row.id);
    assert.equal(after.page, ELIGIBLE.includes(row.id), row.id);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Wiring pins: the pages use the memo, once per request, and nothing else changed.
// ---------------------------------------------------------------------------------------------------------------

test("pages: list page creates one request memo and passes it to the store scan, the product scan and ?store=", () => {
  const page = read("app/(customer)/products/(list)/page.tsx");
  assert.equal(page.match(/requestPublicStoreEligibility\(\)/g)?.length, 1);
  assert.match(page, /createPrismaPublicStoreDiscoveryClient\(prisma, storeEligibility\)/);
  assert.match(page, /createPrismaPublicProductCatalogSelectClient\(prisma, productSelect, storeEligibility\)/);
  assert.match(page, /await storeEligibility\.resolve\(\[selectedStore\.id\], now\)/);
  assert.doesNotMatch(page, /resolvePublicStoreEligibility/);
});

test("pages: product page metadata and page both use the request memo (React cache), no direct reads", () => {
  const page = read("app/(customer)/products/[productId]/page.tsx");
  assert.equal(page.match(/requestPublicStoreEligibility\(\)\.resolve\(\[product\.store\.id\], /g)?.length, 2);
  assert.doesNotMatch(page, /resolvePublicStoreEligibility/);
  const memo = read("lib/public-store-eligibility-memo.ts");
  assert.match(memo, /export const requestPublicStoreEligibility = cache\(\(\): PublicStoreEligibilityMemo => createPublicStoreEligibilityMemo\(prisma\)\);/);
  assert.match(memo, /loadPublicStoreCandidates\(missing, client\)/, "same query as resolvePublicStoreEligibility");
});

test("other callers keep the old nested select / direct reads (no change outside the two pages)", () => {
  for (const path of ["app/api/products/route.ts", "app/api/products/cursor/route.ts"]) {
    assert.match(read(path), /createPrismaPublicProductCatalogClient\((prisma|tx), productInclude\)/, path);
  }
  for (const path of ["app/api/store-options/route.ts", "app/api/stores/cursor/route.ts", "app/(customer)/stores/page.tsx"]) {
    assert.match(read(path), /createPrismaPublicStoreDiscoveryClient\((prisma|tx)\)/, path);
  }
  for (const path of ["app/api/orders/route.ts", "app/api/cart/route.ts", "app/(customer)/checkout/page.tsx", "lib/sitemap.ts"]) {
    assert.doesNotMatch(read(path), /public-store-eligibility-memo|requestPublicStoreEligibility/, path);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// (iii) store-hours migration pin
// ---------------------------------------------------------------------------------------------------------------

test("(iii) store-hours migration pin checks the order, not that it is the newest migration", () => {
  const folders = readdirSync(join(root, "prisma/migrations")).filter((name) => /^\d{14}_/.test(name)).sort();
  const index = folders.indexOf("20261122000000_store_business_hours");
  assert.ok(index > 0);
  assert.equal(folders[index - 1], "20261121010000_store_notification_email");
  assert.ok(index < folders.length - 1, "a newer migration exists, which is why 'sorts last' was stale");
  const pin = read("scripts/store-hours.test.ts");
  assert.doesNotMatch(pin, /folders\[folders\.length - 1\], "20261122000000_store_business_hours"/);
  assert.match(pin, /assert\.equal\(folders\[index - 1\], "20261121010000_store_notification_email"/);
});
