/**
 * SCALE-FIX-1 on real PostgreSQL.
 *  A3: the product catalog and store discovery on plain reads (no interactive transaction) return exactly the same
 *      pages, in the same order, with the same cursors, as the previous RepeatableRead transactions, for every filter
 *      and sort the list page uses; and the /api/products count equals the exact eligible count for normal data.
 *  A7: two buyers lock the same stock row in Serializable transactions, as POST /api/orders does. The loser's error
 *      (P2010 with SQLSTATE 40001 on this stack) is recognised by withOrderSerializationRetry and its retry succeeds;
 *      stock never goes below zero.
 *
 * Safety: uses only BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL (loopback, port 5433, database name containing "verify")
 * and REQUIRES BAGATI_VERIFY_SCHEMA = an already-migrated cat_* scratch schema. It creates its own rows under a random
 * tag and deletes them at the end. Never migrates. Skips (NOT VERIFIED) when the cluster or schema is missing.
 *
 *   BAGATI_VERIFY_SCHEMA=cat_<name> npx tsx --test scripts/scale-fix-1.integration.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";

function guardedScratchUrl(): { url: string } | { refuse: string } | { skip: string } {
  const raw = process.env.BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL;
  if (!raw) return { skip: "verify database URL is not set" };
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return { refuse: "the verify URL is not a valid URL" }; }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) return { refuse: "verify database host must be loopback" };
  if (parsed.port !== "5433") return { refuse: "verify database port must be exactly 5433" };
  if (!database.includes("verify")) return { refuse: "verify database name must contain \"verify\"" };
  const schema = process.env.BAGATI_VERIFY_SCHEMA;
  if (!schema) return { skip: "BAGATI_VERIFY_SCHEMA is not set (needs a migrated cat_* scratch schema)" };
  if (!/^cat_[a-z0-9_]{1,40}$/.test(schema)) return { refuse: "BAGATI_VERIFY_SCHEMA must be a cat_* scratch schema" };
  parsed.searchParams.set("schema", schema);
  return { url: parsed.toString() };
}

const guard = guardedScratchUrl();

async function openScratch(t: { skip: (message: string) => void }): Promise<PrismaClient | null> {
  if ("skip" in guard) { t.skip(`NOT VERIFIED: ${guard.skip}`); return null; }
  if ("refuse" in guard) throw new Error(`Refusing to run: ${guard.refuse}.`);
  process.env.DATABASE_URL = guard.url;
  const prisma = new PrismaClient({ datasources: { db: { url: guard.url } } });
  try { await prisma.$queryRaw`SELECT 1`; } catch { await prisma.$disconnect(); t.skip("NOT VERIFIED: verify database on 127.0.0.1:5433 is unreachable"); return null; }
  const [where] = await prisma.$queryRaw<{ db: string; port: number; schema: string }[]>`SELECT current_database() AS db, inet_server_port() AS port, current_schema() AS schema`;
  assert.ok(where.db.includes("verify") && Number(where.port) === 5433 && where.schema.startsWith("cat_"), "guarded scratch schema");
  const migrated = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('Product', 'Store', 'Inventory')`;
  if (migrated[0]?.n !== 3) { await prisma.$disconnect(); t.skip("NOT VERIFIED: scratch schema is not migrated (this test never migrates)"); return null; }
  return prisma;
}

test("A3: plain reads give the same catalog and store pages as the RepeatableRead transactions", { timeout: 180_000 }, async (t) => {
  const prisma = await openScratch(t);
  if (!prisma) return;
  const tag = `sf${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const catalog = await import("../lib/public-product-catalog");
  const discovery = await import("../lib/public-store-discovery");
  const { countPublicProductsForApi } = await import("../lib/public-products-api");
  const created = { users: [] as string[], vendors: [] as string[], stores: [] as string[], categories: [] as string[], city: "" };
  try {
    const city = await prisma.city.create({ data: { name: `Şəhər ${tag}`, slug: `${tag}-city`, isActive: true } });
    created.city = city.id;
    const parent = await prisma.category.create({ data: { name: `Ana ${tag}`, slug: `${tag}-parent`, isActive: true } });
    const child = await prisma.category.create({ data: { name: `Alt ${tag}`, slug: `${tag}-child`, isActive: true, parentId: parent.id } });
    created.categories.push(child.id, parent.id);

    // Three eligible stores (admin-managed) and one that is not approved: its products must never appear.
    const makeStore = async (n: number, eligible: boolean) => {
      const user = await prisma.user.create({ data: { email: `${tag}-s${n}@verify.invalid`, passwordHash: "x", role: "VENDOR" } });
      created.users.push(user.id);
      const vendor = await prisma.vendorProfile.create({ data: { userId: user.id, displayName: `Satıcı ${n} ${tag}`, sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: `Satıcı ${n}`, voen: `7${String(n).padStart(8, "0")}1`, legalAddress: "Ünvan" } });
      created.vendors.push(vendor.id);
      const store = await prisma.store.create({ data: { vendorId: vendor.id, cityId: city.id, name: n === 2 ? `Eyni ad ${tag}` : `Mağaza ${n} ${tag}`, slug: `${tag}-store-${n}`, status: "ACTIVE", isActive: true, legalInfoApproved: eligible, adminManaged: true } });
      created.stores.push(store.id);
      return store;
    };
    const stores = [await makeStore(1, true), await makeStore(2, true), await makeStore(3, true), await makeStore(4, false)];

    // 130 products: shared timestamps (tie-break on id), shared names (tie-break on id), the search word in name,
    // description or SKU, both categories, and a few non-ACTIVE ones.
    const base = Date.UTC(2026, 5, 1);
    for (let i = 0; i < 130; i += 1) {
      const store = stores[i % stores.length];
      await prisma.product.create({ data: {
        storeId: store.id,
        categoryId: i % 3 === 0 ? parent.id : child.id,
        name: i % 10 === 0 ? `Eyni məhsul ${tag}` : i % 7 === 0 ? `İynə needle ${i} ${tag}` : `Məhsul ${String(i).padStart(3, "0")} ${tag}`,
        description: i % 11 === 0 ? "description has NEEDLE inside" : "adi təsvir",
        sku: i % 13 === 0 ? `${tag}-needle-${i}` : `${tag}-sku-${i}`,
        slug: `${tag}-p${i}`,
        price: new Prisma.Decimal(10 + i),
        status: i % 17 === 0 ? "DRAFT" : "ACTIVE",
        createdAt: new Date(base + Math.floor(i / 4) * 60_000),
      } });
    }

    const include = { store: { select: { id: true, name: true } } } satisfies Prisma.ProductInclude;
    const filterSets: Array<{ label: string; filters: Parameters<typeof catalog.findPublicProductCatalogPage>[1] }> = [
      { label: "city", filters: { citySlug: city.slug } },
      { label: "city+parent category", filters: { citySlug: city.slug, categorySlug: parent.slug } },
      { label: "city+child category", filters: { citySlug: city.slug, categorySlug: child.slug } },
      { label: "city+store", filters: { citySlug: city.slug, storeId: stores[1].id } },
      { label: "city+search (name/description/sku)", filters: { citySlug: city.slug, query: "needle", searchFields: "catalog" } },
      { label: "city+search no hit", filters: { citySlug: city.slug, query: `${tag}-yoxdur`, searchFields: "catalog" } },
    ];

    for (const { label, filters } of filterSets) {
      for (const sort of ["newest", "name"] as const) {
        const now = new Date();
        const walk = async (mode: "tx" | "plain") => {
          const pages: { ids: string[]; next: string | null; prev: string | null }[] = [];
          let cursor: string | undefined;
          for (let guardPages = 0; guardPages < 50; guardPages += 1) {
            const options = { sort, now, limit: 7, paginate: true, maxScanRows: 20, batchSize: 6, ...(cursor ? { cursor } : {}) };
            const page = mode === "tx"
              ? await prisma.$transaction((tx) => catalog.findPublicProductCatalogPage(catalog.createPrismaPublicProductCatalogClient(tx, include), filters, options), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
              : await catalog.findPublicProductCatalogPage(catalog.createPrismaPublicProductCatalogClient(prisma, include), filters, { ...options, allowMissingRecords: true });
            pages.push({ ids: page.items.map(({ id }) => id), next: page.nextCursor, prev: page.previousCursor });
            if (!page.hasNext || !page.nextCursor) break;
            cursor = page.nextCursor;
          }
          return pages;
        };
        const [viaTx, viaPlain] = [await walk("tx"), await walk("plain")];
        assert.deepEqual(viaPlain, viaTx, `${label} / ${sort}: same pages, order and cursors`);
        const seen = viaPlain.flatMap((page) => page.ids);
        assert.equal(new Set(seen).size, seen.length, `${label} / ${sort}: no duplicates across pages`);
      }
    }

    // Offset mode (GET /api/products): plain first page equals the transactional one, and the bounded SQL count equals
    // the exact eligible count of the old route for normal data.
    const apiFilters = { citySlug: city.slug, searchFields: "name" as const };
    const now = new Date();
    const exact = await prisma.$transaction((tx) => catalog.findPublicProductCatalogPage(catalog.createPrismaPublicProductCatalogClient(tx, include), apiFilters, { sort: "newest", now, offset: 0, limit: 20, exactTotal: true }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const plain = await catalog.findPublicProductCatalogPage(catalog.createPrismaPublicProductCatalogClient(prisma, include), apiFilters, { sort: "newest", now, offset: 0, limit: 20, allowMissingRecords: true });
    assert.deepEqual(plain.items.map(({ id }) => id), exact.items.map(({ id }) => id));
    assert.equal(await countPublicProductsForApi(prisma, apiFilters, now), exact.total);
    assert.ok((exact.total ?? 0) > 50, "fixture has enough eligible products");

    // Store discovery (the /products store filter and /api/store-options).
    const storeWalk = async (mode: "tx" | "plain") => {
      const pages: { ids: string[]; next: string | null }[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 10; i += 1) {
        const options = { pageSize: 1, ...(cursor ? { cursor } : {}) };
        const page = mode === "tx"
          ? await prisma.$transaction((tx) => discovery.findPublicStoreDiscoveryCursorPage(discovery.createPrismaPublicStoreDiscoveryClient(tx), { citySlug: city.slug }, options), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
          : await discovery.findPublicStoreDiscoveryCursorPage(discovery.createPrismaPublicStoreDiscoveryClient(prisma), { citySlug: city.slug }, { ...options, allowMissingRecords: true });
        pages.push({ ids: page.items.map(({ id }) => id), next: page.nextCursor });
        if (!page.hasNext || !page.nextCursor) break;
        cursor = page.nextCursor;
      }
      return pages;
    };
    const [storesTx, storesPlain] = [await storeWalk("tx"), await storeWalk("plain")];
    assert.deepEqual(storesPlain, storesTx);
    assert.deepEqual(storesPlain.flatMap((page) => page.ids).sort(), stores.slice(0, 3).map(({ id }) => id).sort(), "only the 3 eligible stores");
  } finally {
    await prisma.product.deleteMany({ where: { storeId: { in: created.stores } } });
    await prisma.store.deleteMany({ where: { id: { in: created.stores } } });
    await prisma.vendorProfile.deleteMany({ where: { id: { in: created.vendors } } });
    await prisma.user.deleteMany({ where: { id: { in: created.users } } });
    for (const id of created.categories) await prisma.category.deleteMany({ where: { id } });
    if (created.city) await prisma.city.deleteMany({ where: { id: created.city } });
    await prisma.$disconnect();
  }
});

test("A7: a concurrent-buyer conflict on a stock row is a serialization conflict and the retry succeeds", { timeout: 120_000 }, async (t) => {
  const prisma = await openScratch(t);
  if (!prisma) return;
  const tag = `sr${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const { withOrderSerializationRetry, isOrderSerializationConflict } = await import("../lib/order-transaction-retry");
  const created = { user: "", vendor: "", store: "", city: "" };
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    const city = await prisma.city.create({ data: { name: `Şəhər ${tag}`, slug: `${tag}-city`, isActive: true } });
    created.city = city.id;
    const user = await prisma.user.create({ data: { email: `${tag}-seller@verify.invalid`, passwordHash: "x", role: "VENDOR" } });
    created.user = user.id;
    const vendor = await prisma.vendorProfile.create({ data: { userId: user.id, displayName: `Satıcı ${tag}`, sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: "Satıcı", voen: "7000000011", legalAddress: "Ünvan" } });
    created.vendor = vendor.id;
    const store = await prisma.store.create({ data: { vendorId: vendor.id, cityId: city.id, name: `Mağaza ${tag}`, slug: `${tag}-store`, status: "ACTIVE", isActive: true, legalInfoApproved: true, adminManaged: true } });
    created.store = store.id;
    const product = await prisma.product.create({ data: { storeId: store.id, name: `Məhsul ${tag}`, slug: `${tag}-p`, price: new Prisma.Decimal(10), status: "ACTIVE", inventory: { create: { quantity: 5 } } }, include: { inventory: true } });
    const inventoryId = product.inventory[0].id;

    // Same statements and order as the order route: read first (snapshot), lock the stock row, compare-and-set.
    const buy = (holdMs: number) => prisma.$transaction(async (tx) => {
      await tx.product.findUnique({ where: { id: product.id }, select: { id: true } });
      await tx.$queryRawUnsafe('SELECT "id" FROM "Inventory" WHERE "id" = $1 FOR UPDATE', inventoryId);
      const row = await tx.inventory.findUnique({ where: { id: inventoryId } });
      const updated = await tx.inventory.updateMany({ where: { id: inventoryId, quantity: { gte: 1 }, reserved: row!.reserved }, data: { quantity: { decrement: 1 } } });
      if (updated.count !== 1) throw new Error("STOCK_CHANGED");
      if (holdMs) await sleep(holdMs);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 20_000 });

    // 1) Without retry: buyer A holds the lock; buyer B starts its snapshot, then waits for the lock and fails.
    const first = buy(600);
    await sleep(150);
    const second = buy(0).then(() => null, (error: unknown) => error);
    await first;
    const conflict = await second;
    assert.ok(conflict, "the second buyer must hit a conflict when its snapshot predates the first buyer's commit");
    const code = conflict instanceof Prisma.PrismaClientKnownRequestError ? `${conflict.code} ${JSON.stringify(conflict.meta)}` : conflict instanceof Error ? conflict.message.slice(0, 80) : String(conflict);
    // PostgreSQL 18 + Prisma 6.19 report it as P2010 with meta.code "40001" (raw FOR UPDATE), not P2034.
    assert.equal(isOrderSerializationConflict(conflict), true, `expected a serialization conflict (P2034 or P2010/40001), got ${code}`);

    // 2) With the route's retry: the same race ends with both purchases done.
    const third = buy(600);
    await sleep(150);
    const fourth = withOrderSerializationRetry(() => buy(0));
    await Promise.all([third, fourth]);
    const stock = await prisma.inventory.findUnique({ where: { id: inventoryId } });
    assert.equal(stock!.quantity, 5 - 3, "purchases 1, 3 and 4 succeeded; 2 was rolled back");

    // 3) Never oversells: 6 buyers at once for the 2 items left, each with the retry.
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => withOrderSerializationRetry(() => buy(50))));
    const after = await prisma.inventory.findUnique({ where: { id: inventoryId } });
    assert.ok(after!.quantity >= 0, "no negative stock");
    assert.equal(2 - after!.quantity, results.filter((result) => result.status === "fulfilled").length, "stock taken = successful buyers");
  } finally {
    if (created.store) {
      await prisma.inventory.deleteMany({ where: { product: { storeId: created.store } } });
      await prisma.product.deleteMany({ where: { storeId: created.store } });
      await prisma.store.deleteMany({ where: { id: created.store } });
    }
    if (created.vendor) await prisma.vendorProfile.deleteMany({ where: { id: created.vendor } });
    if (created.user) await prisma.user.deleteMany({ where: { id: created.user } });
    if (created.city) await prisma.city.deleteMany({ where: { id: created.city } });
    await prisma.$disconnect();
  }
});
