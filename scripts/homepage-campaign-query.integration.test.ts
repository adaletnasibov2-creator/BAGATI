/**
 * Homepage campaign products: the new single query (findHomepageCampaignProductBatches) returns exactly what the old
 * one-query-per-campaign code returned, on real PostgreSQL.
 *
 * Safety: uses only BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL (loopback, port 5433, database name containing "verify")
 * and BAGATI_VERIFY_SCHEMA = scale_audit or a cat_* scratch schema with products, stores and inventory. Everything runs
 * in one interactive transaction that is always rolled back: the extra fixture campaigns and stock changes never
 * persist. Skips (NOT VERIFIED) when the cluster or schema is missing.
 *
 *   BAGATI_VERIFY_SCHEMA=scale_audit npx tsx --test scripts/homepage-campaign-query.integration.test.ts
 */
import assert from "node:assert/strict";
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
  if (!schema) return { skip: "BAGATI_VERIFY_SCHEMA is not set (scale_audit or a cat_* scratch schema)" };
  if (!/^(scale_audit|cat_[a-z0-9_]{1,40})$/.test(schema)) return { refuse: "BAGATI_VERIFY_SCHEMA must be scale_audit or a cat_* scratch schema" };
  parsed.searchParams.set("schema", schema);
  return { url: parsed.toString() };
}

class Rollback extends Error {}

test("homepage campaign products: one query equals one query per campaign", { timeout: 120_000 }, async (t) => {
  const guard = guardedScratchUrl();
  if ("skip" in guard) return t.skip(`NOT VERIFIED: ${guard.skip}`);
  if ("refuse" in guard) throw new Error(`Refusing to run: ${guard.refuse}.`);
  process.env.DATABASE_URL = guard.url;
  const prisma = new PrismaClient({ datasources: { db: { url: guard.url } } });
  try {
    try { await prisma.$queryRaw`SELECT 1`; } catch { return t.skip("NOT VERIFIED: verify database on 127.0.0.1:5433 is unreachable"); }
    const [where] = await prisma.$queryRaw<{ db: string; port: number }[]>`SELECT current_database() AS db, inet_server_port() AS port`;
    assert.ok(where.db.includes("verify") && Number(where.port) === 5433);
    const { findHomepageCampaignProductBatches, homepageCampaignProductSelect } = await import("../lib/homepage-campaign-query");
    const { publicStoreVisibilityWhere } = await import("../lib/store-visibility");
    const stores = await prisma.store.findMany({ where: publicStoreVisibilityWhere(), select: { id: true }, orderBy: { id: "asc" }, take: 3 });
    if (stores.length < 2) return t.skip("NOT VERIFIED: schema has fewer than two publicly visible stores");
    const [storeA, storeB] = stores.map((store) => store.id);

    let compared = 0;
    await assert.rejects(prisma.$transaction(async (tx) => {
      const now = new Date();
      const productsA = await tx.product.findMany({ where: { storeId: storeA, status: "ACTIVE" }, select: { id: true }, orderBy: { id: "asc" }, take: 30 });
      const productsB = await tx.product.findMany({ where: { storeId: storeB, status: "ACTIVE" }, select: { id: true }, orderBy: { id: "asc" }, take: 5 });
      if (productsA.length < 25 || !productsB.length) throw new Error("FIXTURE_TOO_SMALL");
      // Campaign 1 (store A): 25 products, more than the 10 kept. Campaign 2 (store A): includes a product of store B
      // (must be dropped by the storeId filter). Campaign 3 (store B): its first product is put out of stock.
      const fixtures = [
        { id: "it-hcq-1", storeId: storeA, productIds: productsA.slice(0, 25).map((p) => p.id) },
        { id: "it-hcq-2", storeId: storeA, productIds: [...productsA.slice(20, 30).map((p) => p.id), productsB[0].id] },
        { id: "it-hcq-3", storeId: storeB, productIds: productsB.map((p) => p.id) },
      ];
      for (const fixture of fixtures) {
        await tx.promotion.create({ data: {
          id: fixture.id, storeId: fixture.storeId, name: fixture.id, isActive: true, discountType: "PERCENT", discountValue: new Prisma.Decimal(10),
          startsAt: new Date(now.getTime() - 86_400_000), endsAt: new Date(now.getTime() + 86_400_000),
          products: { create: fixture.productIds.map((productId) => ({ productId })) },
        } });
      }
      await tx.inventory.updateMany({ where: { productId: productsB[0].id }, data: { quantity: 0, reserved: 0 } });
      // A same-name tie inside campaign 1, to check the id tiebreak.
      await tx.product.update({ where: { id: productsA[1].id }, data: { name: "Eyni ad" } });
      await tx.product.update({ where: { id: productsA[2].id }, data: { name: "Eyni ad" } });

      const campaigns = await tx.promotion.findMany({
        where: { storeId: { not: null }, isActive: true, startsAt: { lte: now }, endsAt: { gte: now } },
        select: { id: true, storeId: true }, orderBy: [{ startsAt: "asc" }, { id: "asc" }], take: 12,
      });
      const storeFilter = publicStoreVisibilityWhere(now);

      // The code the homepage ran before, verbatim apart from the client variable.
      const before = await Promise.all(campaigns.map((campaign) => tx.promotionProduct.findMany({
        where: { promotionId: campaign.id, product: { status: "ACTIVE", storeId: campaign.storeId!, store: storeFilter, OR: [
          { variants: { none: { isActive: true } }, inventory: { some: { variantId: null, quantity: { gt: prisma.inventory.fields.reserved } } } },
          { variants: { some: { isActive: true, inventory: { some: { quantity: { gt: prisma.inventory.fields.reserved } } } } } },
        ] } },
        orderBy: [{ product: { name: "asc" } }, { product: { id: "asc" } }],
        take: 10,
        select: { product: { select: homepageCampaignProductSelect } },
      })));
      const after = await findHomepageCampaignProductBatches(tx, campaigns, storeFilter, 10);

      const plain = (batches: { product: unknown }[][]) => JSON.parse(JSON.stringify(batches.map((batch) => batch.map((row) => row.product))));
      assert.deepEqual(plain(after), plain(before));
      const fixtureIndex = (id: string) => campaigns.findIndex((campaign) => campaign.id === id);
      assert.equal(after[fixtureIndex("it-hcq-1")].length, 10);
      assert.ok(after[fixtureIndex("it-hcq-2")].every((row) => row.product.storeId === storeA));
      assert.ok(!after[fixtureIndex("it-hcq-3")].some((row) => row.product.id === productsB[0].id));
      compared = campaigns.length;
      throw new Rollback("rollback");
    }, { timeout: 60_000 }), Rollback);
    assert.ok(compared >= 3, "compared at least the three fixture campaigns");
    assert.equal(await prisma.promotion.count({ where: { id: { startsWith: "it-hcq-" } } }), 0, "fixtures rolled back");
  } finally {
    await prisma.$disconnect();
  }
});
