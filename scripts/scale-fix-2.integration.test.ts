/**
 * SCALE-FIX-2 on real PostgreSQL.
 *  A5: product cards built from the new card selects are identical to cards built from the old full rows (price,
 *      campaign, stock, variants, PRO badge, images, links), with active, disabled, ended, scheduled and other-store
 *      promotions, active/inactive variants and stock rows; ProductGrid HTML is byte-identical.
 *  A6: the category counts for a random or inactive ?city= value equal the counts for the shared unknown-city key.
 *  A8: the login lookup on lower(btrim(email)) finds the same users as the old ILIKE lookup, can use the unique
 *      index, and the cases where the two differ are recorded.
 *
 * Safety: same guard as scripts/scale-fix-1.integration.test.ts: only BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL
 * (loopback, port 5433, database name containing "verify") and an already-migrated cat_* schema in
 * BAGATI_VERIFY_SCHEMA. Creates rows under a random tag and deletes them at the end. Never migrates. Skips (NOT
 * VERIFIED) when the cluster or schema is missing.
 *
 *   BAGATI_VERIFY_SCHEMA=cat_<name> npx tsx --test scripts/scale-fix-2.integration.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { Prisma, PrismaClient } from "@prisma/client";

(globalThis as { React?: typeof React }).React = React;

type StockRow = { variantId?: string | null; quantity: number; reserved: number; lowStockThreshold?: number };
type PromotionLink = { promotion: { id: string; storeId: string | null; name: string; startsAt: Date; endsAt: Date; isActive: boolean; discountType: string | null; discountValue: Prisma.Decimal | null } };
/** The fields every card mapping reads (old full rows and new selects both have them). */
type CardRow = {
  id: string; name: string; price: Prisma.Decimal; discountPrice: Prisma.Decimal | null; images: string[];
  store: { id: string; name: string }; inventory: StockRow[]; variants: { inventory: StockRow[] }[]; promotionProducts: PromotionLink[];
};

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
  const migrated = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('Product', 'Store', 'Inventory', 'User')`;
  if (migrated[0]?.n !== 4) { await prisma.$disconnect(); t.skip("NOT VERIFIED: scratch schema is not migrated (this test never migrates)"); return null; }
  return prisma;
}

test("A5 + A6: card selects give the same cards; unknown city keys give the same category counts", { timeout: 180_000 }, async (t) => {
  const prisma = await openScratch(t);
  if (!prisma) return;
  const tag = `sg${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const { productCardSelect, productListCardSelect } = await import("../lib/product-card-select");
  const { homeProductCardSelect, availableStock } = await import("../lib/home-page-data");
  const { calculateEffectivePrice, productPromotions } = await import("../lib/promotion-pricing");
  const { ProductGrid } = await import("../components/product-grid");
  const { countVisibleProductsByCategory } = await import("../lib/public-category-tree");
  const { UNKNOWN_CITY_KEY } = await import("../lib/active-cities");
  const created = { users: [] as string[], vendors: [] as string[], stores: [] as string[], categories: [] as string[], cities: [] as string[], promotions: [] as string[] };
  try {
    const city = await prisma.city.create({ data: { name: `Şəhər ${tag}`, slug: `${tag}-city`, isActive: true } });
    const inactiveCity = await prisma.city.create({ data: { name: `Bağlı ${tag}`, slug: `${tag}-closed`, isActive: false } });
    created.cities.push(city.id, inactiveCity.id);
    const category = await prisma.category.create({ data: { name: `Kat ${tag}`, slug: `${tag}-cat`, isActive: true } });
    created.categories.push(category.id);
    const makeStore = async (n: number) => {
      const user = await prisma.user.create({ data: { email: `${tag}-s${n}@verify.invalid`, passwordHash: "x", role: "VENDOR" } });
      created.users.push(user.id);
      const vendor = await prisma.vendorProfile.create({ data: { userId: user.id, displayName: `Satıcı ${n} ${tag}`, sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: `Satıcı ${n}`, voen: `8${String(n).padStart(8, "0")}1`, legalAddress: "Ünvan" } });
      created.vendors.push(vendor.id);
      const store = await prisma.store.create({ data: { vendorId: vendor.id, cityId: n === 3 ? inactiveCity.id : city.id, name: `Mağaza ${n} ${tag}`, slug: `${tag}-store-${n}`, status: "ACTIVE", isActive: true, legalInfoApproved: true, adminManaged: true } });
      created.stores.push(store.id);
      return store;
    };
    const [store1, store2] = [await makeStore(1), await makeStore(2), await makeStore(3)];
    const now = new Date();
    const minutes = (m: number) => new Date(now.getTime() + m * 60_000);
    const promo = async (name: string, storeId: string, data: Partial<Prisma.PromotionUncheckedCreateInput>) => {
      const row = await prisma.promotion.create({ data: { name: `${name} ${tag}`, storeId, startsAt: minutes(-60), endsAt: minutes(60), isActive: true, discountType: "PERCENT", discountValue: new Prisma.Decimal(10), ...data } });
      created.promotions.push(row.id);
      return row;
    };
    const promotions = {
      active: await promo("Aktiv", store1.id, {}),
      bigger: await promo("Böyük", store1.id, { startsAt: minutes(-30), discountValue: new Prisma.Decimal(30) }),
      disabled: await promo("Söndürülmüş", store1.id, { isActive: false, discountValue: new Prisma.Decimal(50) }),
      ended: await promo("Bitmiş", store1.id, { endsAt: minutes(-5), discountValue: new Prisma.Decimal(40) }),
      scheduled: await promo("Gələcək", store1.id, { startsAt: minutes(30), discountValue: new Prisma.Decimal(25) }),
      fixed: await promo("Sabit", store2.id, { discountType: "FIXED", discountValue: new Prisma.Decimal(3) }),
      otherStore: await promo("Başqa mağaza", store2.id, { discountValue: new Prisma.Decimal(60) }),
    };
    // 12 products: legacy discounts, promotions in every state, variants (active/inactive), stock rows, no stock.
    for (let i = 0; i < 12; i += 1) {
      const store = i % 2 === 0 ? store1 : store2;
      const product = await prisma.product.create({ data: {
        storeId: store.id, categoryId: category.id, name: `Məhsul ${i} ${tag}`, slug: `${tag}-p${i}`, sku: `${tag}-sku-${i}`,
        description: "Uzun təsvir ".repeat(200), price: new Prisma.Decimal(20 + i * 7), discountPrice: i % 3 === 0 ? new Prisma.Decimal(15 + i * 7) : null,
        images: i % 4 === 0 ? [] : [`/images/${tag}-${i}-a.webp`, `/images/${tag}-${i}-b.webp`, `/images/${tag}-${i}-c.webp`],
        status: "ACTIVE", createdAt: minutes(-i),
      } });
      if (i % 4 === 1) {
        for (const [v, active] of [[0, true], [1, true], [2, false]] as const) {
          const variant = await prisma.productVariant.create({ data: { productId: product.id, name: `V${v}`, options: { ölçü: `M${v}` }, isActive: active } });
          await prisma.inventory.create({ data: { productId: product.id, variantId: variant.id, quantity: v === 1 ? 0 : 4 + i, reserved: v === 0 ? 1 : 0, lowStockThreshold: 2 + v } });
        }
      } else {
        await prisma.inventory.create({ data: { productId: product.id, quantity: i === 6 ? 0 : 3 + i, reserved: i === 2 ? 1 : 0, lowStockThreshold: 4 } });
      }
      const links = store.id === store1.id
        ? [promotions.active, promotions.bigger, promotions.disabled, promotions.ended, promotions.scheduled].filter((_, k) => (i + k) % 2 === 0)
        : [promotions.fixed, promotions.otherStore].filter((_, k) => (i + k) % 3 !== 0);
      for (const link of links) await prisma.promotionProduct.create({ data: { promotionId: link.id, productId: product.id } });
    }

    const where = { storeId: { in: [store1.id, store2.id] } };
    const orderBy = [{ createdAt: "desc" as const }, { id: "desc" as const }];
    // The old includes, as on main before A5.
    const oldGridInclude = { store: { select: { id: true, name: true, isActive: true, status: true, subscription: { select: { status: true, currentPeriodEnd: true, plan: { select: { slug: true, isActive: true } } } } } }, inventory: { select: { variantId: true, quantity: true, reserved: true } }, variants: { where: { isActive: true }, select: { id: true, isActive: true, inventory: { select: { quantity: true, reserved: true } } } }, promotionProducts: { include: { promotion: true } } } satisfies Prisma.ProductInclude;
    const oldHomeInclude = { store: { select: { id: true, name: true, isActive: true, status: true, subscription: { select: { status: true, currentPeriodEnd: true, plan: { select: { slug: true, isActive: true } } } } } }, inventory: { select: { variantId: true, quantity: true, reserved: true, lowStockThreshold: true } }, variants: { where: { isActive: true }, select: { isActive: true, options: true, inventory: { select: { variantId: true, quantity: true, reserved: true, lowStockThreshold: true } } } }, promotionProducts: { include: { promotion: true } } } satisfies Prisma.ProductInclude;

    // ProductGrid pages (new products / categories): same mapping as the pages, then the rendered HTML.
    const gridProducts = (rows: CardRow[]) => rows.map((product) => { const effective = calculateEffectivePrice(product.price, product.discountPrice, productPromotions(product.promotionProducts, product.store.id), now); return { ...product, storeId: product.store.id, effectivePrice: effective.unitPrice.toFixed(2), campaignName: effective.promotion?.name || null }; });
    const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
    const renderGrid = (rows: CardRow[]) => renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router as never }, createElement(ProductGrid, { products: gridProducts(rows) as unknown as Parameters<typeof ProductGrid>[0]["products"] })));
    const [oldGrid, newGrid] = await Promise.all([
      prisma.product.findMany({ where, orderBy, include: oldGridInclude }),
      prisma.product.findMany({ where, orderBy, select: productCardSelect(now) }),
    ]);
    assert.equal(newGrid.length, 12);
    const htmlBefore = renderGrid(oldGrid);
    assert.equal(renderGrid(newGrid), htmlBefore, "ProductGrid HTML is identical");
    assert.match(htmlBefore, /Böyük|Aktiv|Sabit|Başqa mağaza/, "the fixture shows campaign names");
    const promoLinksBefore = oldGrid.reduce((sum, row) => sum + row.promotionProducts.length, 0);
    const promoLinksAfter = newGrid.reduce((sum, row) => sum + row.promotionProducts.length, 0);
    assert.ok(promoLinksAfter < promoLinksBefore, `fewer promotion rows loaded (${promoLinksBefore} -> ${promoLinksAfter})`);
    t.diagnostic(`A5 promotion links loaded: ${promoLinksBefore} before, ${promoLinksAfter} after`);

    // Product list cards and home cards: the props the pages pass to ProductCard.
    const listProps = (product: CardRow) => {
      const effective = calculateEffectivePrice(product.price, product.discountPrice, productPromotions(product.promotionProducts, product.store.id), now);
      const rows = product.variants.length ? product.variants.flatMap((variant) => variant.inventory) : product.inventory.filter((row) => row.variantId === null);
      return { id: product.id, name: product.name, price: effective.unitPrice.toFixed(2), originalPrice: effective.unitPrice.lt(effective.basePrice) ? effective.basePrice.toFixed(2) : null, store: product.store.name, storeHref: `/stores/${product.store.id}`, campaignName: effective.promotion?.name, image: product.images[0], secondaryImage: product.images[1], stock: rows.reduce((sum, row) => sum + row.quantity - row.reserved, 0), variantCount: product.variants.filter((variant) => variant.inventory.some((row) => row.quantity > row.reserved)).length || undefined };
    };
    const homeProps = (product: CardRow) => ({ ...listProps(product), stock: availableStock(product.inventory as Parameters<typeof availableStock>[0], product.variants as Parameters<typeof availableStock>[1]), lowStockThreshold: Math.max(0, ...(product.variants.length ? product.variants.flatMap((variant) => variant.inventory) : product.inventory).map((row) => row.lowStockThreshold ?? 0)) });
    const [oldList, newList, oldHome, newHome] = await Promise.all([
      prisma.product.findMany({ where, orderBy, include: oldGridInclude }),
      prisma.product.findMany({ where, orderBy, select: productListCardSelect(now) }),
      prisma.product.findMany({ where, orderBy, include: oldHomeInclude }),
      prisma.product.findMany({ where, orderBy, select: homeProductCardSelect(now) }),
    ]);
    assert.deepEqual(newList.map(listProps), oldList.map(listProps), "product list cards");
    assert.deepEqual(newHome.map(homeProps), oldHome.map(homeProps), "home shelf cards");
    // Render at a later time too (the home cache keeps rows up to 30 s): a promotion ending in between still drops out.
    for (const later of [minutes(0.5), minutes(31), minutes(61)]) {
      const at = (product: CardRow) => calculateEffectivePrice(product.price, product.discountPrice, productPromotions(product.promotionProducts, product.store.id), later).unitPrice.toFixed(2);
      assert.deepEqual(newHome.map(at), oldHome.map(at), `prices rendered at +${Math.round((later.getTime() - now.getTime()) / 60_000)} min`);
    }

    // A6: random and inactive city values count exactly like the shared unknown-city key (nothing).
    const [random, inactive, shared, real] = await Promise.all([
      countVisibleProductsByCategory(prisma, now, `${tag}-random-xyz`),
      countVisibleProductsByCategory(prisma, now, inactiveCity.slug),
      countVisibleProductsByCategory(prisma, now, UNKNOWN_CITY_KEY),
      countVisibleProductsByCategory(prisma, now, city.slug),
    ]);
    assert.deepEqual([...random], [...shared]);
    assert.deepEqual([...inactive], [...shared]);
    assert.equal(shared.size, 0);
    assert.equal(real.get(category.id), 12, "the real city still counts its products");
  } finally {
    await prisma.promotionProduct.deleteMany({ where: { promotionId: { in: created.promotions } } });
    await prisma.promotion.deleteMany({ where: { id: { in: created.promotions } } });
    await prisma.product.deleteMany({ where: { storeId: { in: created.stores } } });
    await prisma.store.deleteMany({ where: { id: { in: created.stores } } });
    await prisma.vendorProfile.deleteMany({ where: { id: { in: created.vendors } } });
    await prisma.user.deleteMany({ where: { id: { in: created.users } } });
    for (const id of created.categories) await prisma.category.deleteMany({ where: { id } });
    await prisma.city.deleteMany({ where: { id: { in: created.cities } } });
    await prisma.$disconnect();
  }
});

test("A8: the login lookup finds the same users as the old ILIKE query and can use the unique index", { timeout: 120_000 }, async (t) => {
  const prisma = await openScratch(t);
  if (!prisma) return;
  const tag = `sl${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const { findUserByLoginEmail } = await import("../lib/login-user-lookup");
  const ids: string[] = [];
  try {
    const make = async (email: string) => { const user = await prisma.user.create({ data: { email, passwordHash: "x", role: "CUSTOMER" } }); ids.push(user.id); return user; };
    const plain = await make(`${tag}-ali@verify.invalid`);
    const mixed = await make(`${tag.toUpperCase()}-Mixed.Case@Verify.Invalid`);
    const padded = await make(`  ${tag}-padded@verify.invalid `);
    const axb = await make(`${tag}-axb@verify.invalid`);
    const percent = await make(`${tag}-pct-anything@verify.invalid`);
    const old = (email: string) => prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } }).then((user) => user?.id ?? null);
    const now = (email: string) => findUserByLoginEmail(prisma, email).then((user) => user?.id ?? null);
    // Inputs as the routes pass them: trimmed and lower-cased.
    const cases = [
      { input: `${tag}-ali@verify.invalid`, expect: plain.id },
      { input: `${tag}-mixed.case@verify.invalid`, expect: mixed.id },
      { input: `${tag}-nobody@verify.invalid`, expect: null },
    ];
    for (const { input, expect } of cases) {
      assert.equal(await now(input), expect, input);
      assert.equal(await old(input), expect, `old: ${input}`);
    }
    // Where the two can differ: record what each returns.
    const differences = {
      paddedStoredEmail: { old: await old(`${tag}-padded@verify.invalid`), now: await now(`${tag}-padded@verify.invalid`), user: padded.id },
      underscoreInInput: { old: await old(`${tag}-a_b@verify.invalid`), now: await now(`${tag}-a_b@verify.invalid`), wildcardTarget: axb.id },
      percentInInput: { old: await old(`${tag}-pct-%@verify.invalid`), now: await now(`${tag}-pct-%@verify.invalid`), wildcardTarget: percent.id },
    };
    t.diagnostic(`A8 differences: ${JSON.stringify(differences)}`);
    assert.equal(differences.paddedStoredEmail.now, padded.id, "the index expression trims the stored email");
    assert.equal(differences.underscoreInInput.now, null, "no wildcard in the new lookup");
    assert.equal(differences.percentInInput.now, null, "no wildcard in the new lookup");
    // The planner can serve the new lookup from the unique index (seq scan disabled to show it is usable on a small table).
    const plans = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
      const index = await tx.$queryRaw<{ "QUERY PLAN": string }[]>`EXPLAIN SELECT "id" FROM "User" WHERE lower(btrim("email")) = ${`${tag}-ali@verify.invalid`} LIMIT 1`;
      const ilike = await tx.$queryRaw<{ "QUERY PLAN": string }[]>`EXPLAIN SELECT "id" FROM "User" WHERE "email" ILIKE ${`${tag}-ali@verify.invalid`}`;
      return { index: index.map((row) => row["QUERY PLAN"]).join("\n"), ilike: ilike.map((row) => row["QUERY PLAN"]).join("\n") };
    });
    t.diagnostic(`A8 plan (new): ${plans.index.replace(/\s+/g, " ")}`);
    t.diagnostic(`A8 plan (ILIKE): ${plans.ilike.replace(/\s+/g, " ")}`);
    assert.match(plans.index, /User_email_normalized_key/);
    assert.doesNotMatch(plans.ilike, /User_email_normalized_key/);
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
});
