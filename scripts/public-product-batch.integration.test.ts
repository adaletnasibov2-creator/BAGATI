/**
 * Favorites batch read on real PostgreSQL: findPublicProductsByIds returns exactly the products GET /api/products/[id]
 * would return (same where, same eligibility), in request order.
 *
 * Safety: uses only BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL (loopback, port 5433, database name containing "verify")
 * and BAGATI_VERIFY_SCHEMA = scale_audit or a cat_* scratch schema with eligible stores and active products. Changes are
 * made inside one transaction that is always rolled back. The batch function runs on the same transaction through its
 * deps parameter. Skips (NOT VERIFIED) when the cluster or schema is missing.
 *
 *   BAGATI_VERIFY_SCHEMA=scale_audit npx tsx --test scripts/public-product-batch.integration.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

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

test("favorites batch: same visibility and eligibility as the single product endpoint", { timeout: 120_000 }, async (t) => {
  const guard = guardedScratchUrl();
  if ("skip" in guard) return t.skip(`NOT VERIFIED: ${guard.skip}`);
  if ("refuse" in guard) throw new Error(`Refusing to run: ${guard.refuse}.`);
  process.env.DATABASE_URL = guard.url;
  const prisma = new PrismaClient({ datasources: { db: { url: guard.url } } });
  try {
    try { await prisma.$queryRaw`SELECT 1`; } catch { return t.skip("NOT VERIFIED: verify database on 127.0.0.1:5433 is unreachable"); }
    const [where] = await prisma.$queryRaw<{ db: string; port: number }[]>`SELECT current_database() AS db, inet_server_port() AS port`;
    assert.ok(where.db.includes("verify") && Number(where.port) === 5433);
    const { findPublicProductsByIds, publicProductDetailInclude } = await import("../lib/public-product-batch");
    const { publicProductVisibilityWhere, publicStoreVisibilityWhere } = await import("../lib/store-visibility");
    const { resolvePublicStoreEligibility } = await import("../lib/store-eligibility");
    const stores = await prisma.store.findMany({ where: publicStoreVisibilityWhere(), select: { id: true }, orderBy: { id: "asc" }, take: 2 });
    if (stores.length < 2) return t.skip("NOT VERIFIED: schema has fewer than two publicly visible stores");

    let checked = false;
    await assert.rejects(prisma.$transaction(async (tx) => {
      const [firstTwo, visibleB, hiddenStore] = await Promise.all([
        tx.product.findMany({ where: { storeId: stores[0].id, status: "ACTIVE" }, select: { id: true }, orderBy: { id: "asc" }, take: 2 }),
        tx.product.findFirst({ where: { storeId: stores[0].id, status: "ACTIVE" }, select: { id: true }, orderBy: { id: "desc" } }),
        tx.product.findFirst({ where: { storeId: stores[1].id, status: "ACTIVE" }, select: { id: true }, orderBy: { id: "asc" } }),
      ]);
      const [visibleA, drafted] = firstTwo;
      assert.ok(visibleA && drafted && visibleB && hiddenStore);
      assert.equal(new Set([visibleA.id, drafted.id, visibleB.id]).size, 3, "three distinct products");
      await tx.product.update({ where: { id: drafted.id }, data: { status: "DRAFT" } });
      await tx.store.update({ where: { id: stores[1].id }, data: { isActive: false } });

      const requested = [visibleB.id, "it-ppb-missing", drafted.id, hiddenStore.id, visibleA.id];
      const single = async (id: string) => {
        const item = await tx.product.findFirst({ where: { id, ...publicProductVisibilityWhere() }, include: publicProductDetailInclude });
        if (!item) return null;
        return (await resolvePublicStoreEligibility([item.store.id], tx)).has(item.store.id) ? item : null;
      };
      const expected = (await Promise.all(requested.map(single))).filter((item) => item !== null);
      const batch = await findPublicProductsByIds(requested, {
        findProducts: (ids) => tx.product.findMany({ where: { id: { in: ids }, ...publicProductVisibilityWhere() }, include: publicProductDetailInclude }),
        resolveEligibleStores: (storeIds) => resolvePublicStoreEligibility(storeIds, tx),
      });
      assert.deepEqual(batch.map((item) => item.id), [visibleB.id, visibleA.id]);
      assert.deepEqual(JSON.parse(JSON.stringify(batch)), JSON.parse(JSON.stringify(expected)));
      checked = true;
      throw new Rollback("rollback");
    }, { timeout: 60_000 }), Rollback);
    assert.ok(checked);
    assert.equal((await prisma.store.findUnique({ where: { id: stores[1].id }, select: { isActive: true } }))?.isActive, true, "rolled back");
  } finally {
    await prisma.$disconnect();
  }
});
