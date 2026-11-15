/**
 * Category tree against the isolated verification PostgreSQL cluster, in a SCRATCH schema only.
 *
 * Safety: uses only BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL (loopback, port 5433, database name containing "verify")
 * and REQUIRES BAGATI_VERIFY_SCHEMA starting with "cat_" that already has migration 20261116010000 (it creates and
 * removes its own fixture rows, tagged with a random prefix). Never applies migrations. Skips (NOT VERIFIED) when the
 * cluster, schema or migration is missing.
 *
 *   BAGATI_VERIFY_SCHEMA=cat_it npm run test:category-tree:integration
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
  if (!schema) return { skip: "BAGATI_VERIFY_SCHEMA is not set (needs a migrated cat_* scratch schema)" };
  if (!/^cat_[a-z0-9_]{1,40}$/.test(schema)) return { refuse: "BAGATI_VERIFY_SCHEMA must be a cat_* scratch schema" };
  parsed.searchParams.set("schema", schema);
  return { url: parsed.toString() };
}

test("category tree: DB guards, admin service, scope query and counts on PostgreSQL", { timeout: 120_000 }, async (t) => {
  const guard = guardedScratchUrl();
  if ("skip" in guard) return t.skip(`NOT VERIFIED: ${guard.skip}`);
  if ("refuse" in guard) throw new Error(`Refusing to run: ${guard.refuse}.`);
  process.env.DATABASE_URL = guard.url;
  const prisma = new PrismaClient({ datasources: { db: { url: guard.url } } });
  const tag = `it${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const ids = { city: `${tag}_city`, user: `${tag}_user`, admin: `${tag}_admin`, vendor: `${tag}_vendor`, store: `${tag}_store` };
  try {
    try { await prisma.$queryRaw`SELECT 1`; } catch { return t.skip("NOT VERIFIED: verify database on 127.0.0.1:5433 is unreachable"); }
    const [where] = await prisma.$queryRaw<{ db: string; port: number; schema: string }[]>`SELECT current_database() AS db, inet_server_port() AS port, current_schema() AS schema`;
    assert.ok(where.db.includes("verify") && Number(where.port) === 5433 && where.schema.startsWith("cat_"));
    const migrated = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE migration_name = '20261116010000_category_tree' AND finished_at IS NOT NULL`.catch(() => [{ n: 0 }]);
    if (!migrated[0]?.n) return t.skip("NOT VERIFIED: scratch schema lacks migration 20261116010000 (this test never migrates)");

    const service = await import("../lib/admin-category-service");
    const { categoryScopeWhere } = await import("../lib/category-where");
    await prisma.user.create({ data: { id: ids.admin, email: `${tag}-admin@verify.invalid`, passwordHash: "x", role: "ADMIN" } });
    const top = await service.createCategory(prisma, ids.admin, { name: `Üst ${tag}`, slug: `${tag}-ust`, iconKey: "Car" });
    const other = await service.createCategory(prisma, ids.admin, { name: `Digər üst ${tag}`, slug: `${tag}-diger-ust` });
    const sub = await service.createCategory(prisma, ids.admin, { name: `Alt ${tag}`, slug: `${tag}-alt`, parentId: top!.id });

    await t.test("triggers: no third level, no moving a parent under another, no delete in use", async () => {
      await assert.rejects(prisma.category.create({ data: { name: "x", slug: `${tag}-deep`, parentId: sub!.id } }), /CATEGORY_DEPTH/);
      await assert.rejects(prisma.category.update({ where: { id: top!.id }, data: { parentId: other!.id } }), /CATEGORY_DEPTH/);
      await assert.rejects(prisma.category.delete({ where: { id: top!.id } }), /CATEGORY_IN_USE/);
      await assert.rejects(prisma.$executeRaw`UPDATE "Category" SET "iconKey" = 'no such!' WHERE id = ${top!.id}`, /Category_iconKey_format_check/);
      await assert.rejects(prisma.$executeRaw`UPDATE "Category" SET "parentId" = id WHERE id = ${other!.id}`);
    });

    await t.test("service maps the same rules to admin errors and writes one audit row per action", async () => {
      await assert.rejects(service.createCategory(prisma, ids.admin, { name: "Dərin", slug: `${tag}-deep2`, parentId: sub!.id }), (error: unknown) => error instanceof service.CategoryAdminError && error.status === 422);
      await assert.rejects(service.updateCategory(prisma, ids.admin, top!.id, { parentId: other!.id }), (error: unknown) => error instanceof service.CategoryAdminError && error.status === 422);
      await assert.rejects(service.createCategory(prisma, ids.admin, { name: "Dup", slug: `${tag}-alt` }), (error: unknown) => error instanceof service.CategoryAdminError && error.status === 409);
      await service.updateCategory(prisma, ids.admin, sub!.id, { parentId: other!.id });
      await service.updateCategory(prisma, ids.admin, sub!.id, { parentId: top!.id });
      const actions = await prisma.auditLog.findMany({ where: { actorId: ids.admin }, select: { action: true, entityId: true }, orderBy: { createdAt: "asc" } });
      assert.deepEqual(actions.map((a) => a.action), ["CATEGORY_CREATE", "CATEGORY_CREATE", "CATEGORY_CREATE", "CATEGORY_MOVE", "CATEGORY_MOVE"]);
      assert.equal(actions.at(-1)?.entityId, sub!.id);
    });

    await prisma.city.create({ data: { id: ids.city, name: `City ${tag}`, slug: `${tag}-city` } });
    await prisma.user.create({ data: { id: ids.user, email: `${tag}-vendor@verify.invalid`, passwordHash: "x", role: "VENDOR" } });
    await prisma.vendorProfile.create({ data: { id: ids.vendor, userId: ids.user, displayName: "Fixture" } });
    await prisma.store.create({ data: { id: ids.store, vendorId: ids.vendor, cityId: ids.city, name: `Store ${tag}`, slug: `${tag}-store` } });
    const p1 = await prisma.product.create({ data: { storeId: ids.store, name: "P1", slug: `${tag}-p1`, price: 10, status: "ACTIVE", categoryId: top!.id } });
    const p2 = await prisma.product.create({ data: { storeId: ids.store, name: "P2", slug: `${tag}-p2`, price: 10, status: "ACTIVE", categoryId: sub!.id } });

    await t.test("scope: a top-level slug lists its own and its subcategories' products; a subcategory only its own", async () => {
      const topIds = (await prisma.product.findMany({ where: { storeId: ids.store, category: categoryScopeWhere(`${tag}-ust`) }, select: { id: true } })).map((p) => p.id).sort();
      assert.deepEqual(topIds, [p1.id, p2.id].sort());
      const subIds = (await prisma.product.findMany({ where: { storeId: ids.store, category: categoryScopeWhere(`${tag}-alt`) }, select: { id: true } })).map((p) => p.id);
      assert.deepEqual(subIds, [p2.id]);
      await prisma.category.update({ where: { id: top!.id }, data: { isActive: false } });
      assert.equal(await prisma.product.count({ where: { storeId: ids.store, category: categoryScopeWhere(`${tag}-alt`) } }), 0, "inactive parent hides its subcategory");
      await prisma.category.update({ where: { id: top!.id }, data: { isActive: true } });
    });

    await t.test("bulk move: stale version moves nothing; fresh version moves and audits once", async () => {
      const stale = await service.moveProductsToCategory(prisma, ids.admin, { fromCategoryId: top!.id, toCategoryId: sub!.id, items: [{ id: p1.id, version: new Date(0).toISOString() }] }).catch((error) => error);
      assert.ok(stale instanceof service.CategoryAdminError && stale.status === 409);
      assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: p1.id } })).categoryId, top!.id);
      const before = await prisma.product.findUniqueOrThrow({ where: { id: p1.id } });
      await service.moveProductsToCategory(prisma, ids.admin, { fromCategoryId: top!.id, toCategoryId: sub!.id, items: [{ id: p1.id, version: before.updatedAt.toISOString() }] });
      const after = await prisma.product.findUniqueOrThrow({ where: { id: p1.id } });
      assert.equal(after.categoryId, sub!.id);
      assert.deepEqual([after.name, after.slug, after.status, after.price.toString(), after.storeId], [before.name, before.slug, before.status, before.price.toString(), before.storeId], "nothing else changed");
      assert.equal(await prisma.auditLog.count({ where: { actorId: ids.admin, action: "PRODUCTS_CATEGORY_MOVE" } }), 1);
    });

    await t.test("Aktiv/Deaktiv: parent off hides an active child publicly without changing it; products untouched; audited", async () => {
      const { loadAllCategoryRows, toPublicTree } = await import("../lib/public-category-tree");
      const productsBefore = await prisma.product.findMany({ where: { storeId: ids.store }, orderBy: { id: "asc" } });
      await service.updateCategory(prisma, ids.admin, top!.id, { isActive: false });
      const childAfter = await prisma.category.findUniqueOrThrow({ where: { id: sub!.id } });
      assert.equal(childAfter.isActive, true, "child keeps its own state");
      let tree = toPublicTree(await loadAllCategoryRows(prisma), new Map(), { showEmpty: true });
      assert.ok(!tree.some((node) => node.id === top!.id) && !tree.flatMap((node) => node.children).some((child) => child.id === sub!.id), "hidden publicly");
      await service.updateCategory(prisma, ids.admin, top!.id, { isActive: true });
      tree = toPublicTree(await loadAllCategoryRows(prisma), new Map(), { showEmpty: true });
      assert.ok(tree.find((node) => node.id === top!.id)?.children.some((child) => child.id === sub!.id), "restored with its child");
      const productsAfter = await prisma.product.findMany({ where: { storeId: ids.store }, orderBy: { id: "asc" } });
      assert.deepEqual(productsAfter, productsBefore, "no product row changed");
      const toggles = await prisma.auditLog.findMany({ where: { actorId: ids.admin, entityId: top!.id, action: { in: ["CATEGORY_DEACTIVATE", "CATEGORY_ACTIVATE"] } }, orderBy: { createdAt: "asc" }, select: { action: true } });
      assert.deepEqual(toggles.map((row) => row.action), ["CATEGORY_DEACTIVATE", "CATEGORY_ACTIVATE"]);
    });

    await t.test("delete: refused while in use, allowed when empty", async () => {
      await assert.rejects(service.deleteCategory(prisma, ids.admin, sub!.id), (error: unknown) => error instanceof service.CategoryAdminError && error.status === 409);
      const empty = await service.createCategory(prisma, ids.admin, { name: `Boş ${tag}`, slug: `${tag}-bos`, parentId: other!.id });
      await service.deleteCategory(prisma, ids.admin, empty!.id);
      assert.equal(await prisma.category.count({ where: { id: empty!.id } }), 0);
    });
  } finally {
    await prisma.product.deleteMany({ where: { storeId: ids.store } }).catch(() => undefined);
    await prisma.store.deleteMany({ where: { id: ids.store } }).catch(() => undefined);
    await prisma.vendorProfile.deleteMany({ where: { id: ids.vendor } }).catch(() => undefined);
    await prisma.city.deleteMany({ where: { id: ids.city } }).catch(() => undefined);
    await prisma.category.deleteMany({ where: { slug: { startsWith: `${tag}-` }, parentId: { not: null } } }).catch(() => undefined);
    await prisma.category.deleteMany({ where: { slug: { startsWith: `${tag}-` } } }).catch(() => undefined);
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [ids.admin] } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: [ids.user, ids.admin] } } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});
