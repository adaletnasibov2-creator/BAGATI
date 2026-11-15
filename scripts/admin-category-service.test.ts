import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import {
  CategoryAdminError,
  createCategory,
  deleteCategory,
  mapCategoryDbError,
  moveProductsToCategory,
  reorderCategory,
  updateCategory,
} from "../lib/admin-category-service";

type Row = { id: string; name: string; slug: string; parentId: string | null; isActive: boolean; sortOrder: number; iconKey: string | null; imageUrl: string | null };
type Product = { id: string; categoryId: string | null; updatedAt: Date };

/** In-memory stand-in for the transaction client: just enough of Prisma for the service. */
function fakeDb(rows: Row[], products: Product[] = []) {
  const audits: { action: string; entityId: string | null; metadata: unknown }[] = [];
  const state = { rows: rows.map((row) => ({ ...row })), products: products.map((product) => ({ ...product })) };
  const pick = (row: Row, select?: Record<string, unknown>) => {
    if (!select) return { ...row };
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(select)) {
      if (key === "_count") out._count = { products: state.products.filter((p) => p.categoryId === row.id).length, children: state.rows.filter((r) => r.parentId === row.id).length };
      else if (key === "parent") { const parent = state.rows.find((r) => r.id === row.parentId); out.parent = parent ? { isActive: parent.isActive } : null; }
      else out[key] = (row as Record<string, unknown>)[key];
    }
    return out;
  };
  const matches = (row: Row, where: Record<string, unknown> = {}): boolean => {
    if ("OR" in where) return (where.OR as Record<string, unknown>[]).some((clause) => matches(row, clause));
    return Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value);
  };
  const tx = {
    $queryRaw: async () => [],
    category: {
      findUnique: async ({ where, select }: { where: { id: string }; select?: Record<string, unknown> }) => { const row = state.rows.find((r) => r.id === where.id); return row ? pick(row, select) : null; },
      findMany: async ({ where, select }: { where?: Record<string, unknown>; select?: Record<string, unknown> }) => state.rows.filter((row) => matches(row, where)).map((row) => pick(row, select)),
      create: async ({ data }: { data: Omit<Row, "id"> }) => {
        if (state.rows.some((row) => row.slug === data.slug)) throw new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" });
        const row = { id: `new-${state.rows.length}`, ...data } as Row;
        state.rows.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => { const row = state.rows.find((r) => r.id === where.id)!; Object.assign(row, data); return { ...row }; },
      delete: async ({ where }: { where: { id: string } }) => { state.rows = state.rows.filter((row) => row.id !== where.id); },
    },
    product: {
      updateMany: async ({ where, data }: { where: { id: string; categoryId: string; updatedAt: Date }; data: { categoryId: string } }) => {
        const product = state.products.find((p) => p.id === where.id && p.categoryId === where.categoryId && p.updatedAt.getTime() === where.updatedAt.getTime());
        if (!product) return { count: 0 };
        product.categoryId = data.categoryId;
        product.updatedAt = new Date(product.updatedAt.getTime() + 1);
        return { count: 1 };
      },
    },
    auditLog: { create: async ({ data }: { data: { action: string; entityId: string | null; metadata: unknown } }) => { audits.push(data); } },
  };
  // Commit only when the callback succeeds (rollback on throw), like a real transaction.
  const db = {
    $transaction: async (work: (client: typeof tx) => Promise<unknown>) => {
      const snapshot = JSON.stringify(state);
      const auditCount = audits.length;
      try { return await work(tx); } catch (error) {
        const restored = JSON.parse(snapshot, (key, value) => (key === "updatedAt" ? new Date(value) : value));
        state.rows = restored.rows; state.products = restored.products; audits.length = auditCount;
        throw error;
      }
    },
  };
  return { db: db as never, state, audits };
}

const base = (): Row[] => [
  { id: "el", name: "Elektronika", slug: "elektronika", parentId: null, isActive: true, sortOrder: 20, iconKey: "Smartphone", imageUrl: null },
  { id: "ak", name: "Aksesuarlar", slug: "aksesuarlar", parentId: null, isActive: true, sortOrder: 10, iconKey: "Watch", imageUrl: null },
  { id: "dg", name: "Digər", slug: "diger", parentId: null, isActive: true, sortOrder: 1000, iconKey: "Shapes", imageUrl: null },
  { id: "tel", name: "Telefonlar", slug: "telefonlar", parentId: "el", isActive: true, sortOrder: 10, iconKey: null, imageUrl: null },
  { id: "pla", name: "Planşetlər", slug: "plansetler", parentId: "el", isActive: true, sortOrder: 20, iconKey: null, imageUrl: null },
];

async function rejects(promise: Promise<unknown>, status: number, pattern: RegExp) {
  await assert.rejects(promise, (error: unknown) => error instanceof CategoryAdminError && error.status === status && pattern.test(error.message));
}

test("create: subcategory gets the next sortOrder, transliterated slug, one audit row", async () => {
  const { db, state, audits } = fakeDb(base());
  const created = await createCategory(db, "admin", { name: "Ağıllı saatlar", parentId: "el", iconKey: "Watch" });
  assert.equal(created?.slug, "agilli-saatlar");
  assert.equal(created?.sortOrder, 30);
  assert.equal(state.rows.length, 6);
  assert.deepEqual(audits.map((a) => a.action), ["CATEGORY_CREATE"]);
});

test("create: depth rule, unknown icon, unsafe photo and duplicate slug are refused without writes", async () => {
  const { db, state, audits } = fakeDb(base());
  await rejects(createCategory(db, "admin", { name: "Dərin", parentId: "tel" }), 422, /iki səviyyə|alt kateqoriyanın altına/i);
  await rejects(createCategory(db, "admin", { name: "Yeni", iconKey: "NotAnIcon" }), 422, /ikon/);
  await rejects(createCategory(db, "admin", { name: "Yeni", imageUrl: "javascript:alert(1)" }), 422, /Şəkil/);
  await rejects(createCategory(db, "admin", { name: "Telefonlar", parentId: "el" }), 409, /slug/);
  await rejects(createCategory(db, "admin", { name: "X" }), 422, /2 simvol/);
  assert.equal(state.rows.length, 5);
  assert.equal(audits.length, 0);
});

test("top-levels sort before Digər: a new top-level is not placed after it", async () => {
  const { db } = fakeDb(base());
  const created = await createCategory(db, "admin", { name: "Avtomobil", iconKey: "Car" });
  assert.equal(created?.sortOrder, 30, "max of non-Digər siblings + 10");
});

test("move: a subcategory can change parent; a top-level with children cannot go under another", async () => {
  const { db, state, audits } = fakeDb(base());
  await updateCategory(db, "admin", "tel", { parentId: "ak" });
  assert.equal(state.rows.find((r) => r.id === "tel")?.parentId, "ak");
  assert.equal(audits.at(-1)?.action, "CATEGORY_MOVE");
  assert.equal(audits.at(-1)?.entityId, "tel", "audited with the category's own id");
  await rejects(updateCategory(db, "admin", "el", { parentId: "ak" }), 422, /Alt kateqoriyaları olan/);
  await rejects(updateCategory(db, "admin", "ak", { parentId: "tel" }), 422, /.+/);
});

test("edit: icon change, deactivate and unknown icon; no-op writes no audit", async () => {
  const { db, state, audits } = fakeDb(base());
  await updateCategory(db, "admin", "tel", { iconKey: "Smartphone" });
  await updateCategory(db, "admin", "tel", { isActive: false });
  assert.equal(state.rows.find((r) => r.id === "tel")?.isActive, false);
  assert.deepEqual(audits.map((a) => a.action), ["CATEGORY_UPDATE", "CATEGORY_DEACTIVATE"]);
  await updateCategory(db, "admin", "tel", { name: "Telefonlar" });
  assert.equal(audits.length, 2);
  await rejects(updateCategory(db, "admin", "tel", { iconKey: "bogus" }), 422, /ikon/);
  await rejects(updateCategory(db, "admin", "missing", { name: "Yox" }), 404, /tapılmadı/);
});

test("reorder: swaps neighbours and renumbers; Digər stays last and cannot move", async () => {
  const { db, state, audits } = fakeDb(base());
  await reorderCategory(db, "admin", "el", "up");
  const order = state.rows.filter((r) => !r.parentId).sort((a, b) => a.sortOrder - b.sortOrder).map((r) => r.id);
  assert.deepEqual(order, ["el", "ak", "dg"]);
  assert.equal(audits.at(-1)?.action, "CATEGORY_REORDER");
  assert.deepEqual(await reorderCategory(db, "admin", "ak", "down"), { changed: false }, "cannot pass Digər");
  await rejects(reorderCategory(db, "admin", "dg", "up"), 422, /Digər/);
});

test("delete: only without products and subcategories, with an explanation otherwise", async () => {
  const { db, state, audits } = fakeDb(base(), [{ id: "p1", categoryId: "pla", updatedAt: new Date() }]);
  await rejects(deleteCategory(db, "admin", "el"), 409, /alt kateqoriyası var.*deaktiv/);
  await rejects(deleteCategory(db, "admin", "pla"), 409, /1 məhsul.*deaktiv/);
  await deleteCategory(db, "admin", "tel");
  assert.ok(!state.rows.some((r) => r.id === "tel"));
  assert.deepEqual(audits.map((a) => a.action), ["CATEGORY_DELETE"]);
});

test("bulk move: version-checked, all-or-nothing, max 100, active subcategory target, one audit row", async () => {
  const t1 = new Date("2026-11-15T10:00:00.000Z");
  const products = [{ id: "p1", categoryId: "el", updatedAt: t1 }, { id: "p2", categoryId: "el", updatedAt: t1 }];
  const { db, state, audits } = fakeDb(base(), products);
  const result = await moveProductsToCategory(db, "admin", { fromCategoryId: "el", toCategoryId: "tel", items: products.map((p) => ({ id: p.id, version: t1.toISOString() })) });
  assert.deepEqual(result, { moved: 2 });
  assert.deepEqual(state.products.map((p) => p.categoryId), ["tel", "tel"]);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "PRODUCTS_CATEGORY_MOVE");
  assert.deepEqual((audits[0].metadata as { productIds: string[] }).productIds, ["p1", "p2"]);

  const second = fakeDb(base(), [{ id: "p1", categoryId: "el", updatedAt: t1 }, { id: "p2", categoryId: "el", updatedAt: new Date("2026-11-15T11:00:00.000Z") }]);
  await rejects(moveProductsToCategory(second.db, "admin", { fromCategoryId: "el", toCategoryId: "tel", items: [{ id: "p1", version: t1.toISOString() }, { id: "p2", version: t1.toISOString() }] }), 409, /heç nə köçürülmədi/);
  assert.deepEqual(second.state.products.map((p) => p.categoryId), ["el", "el"], "rolled back");
  assert.equal(second.audits.length, 0);

  await rejects(moveProductsToCategory(db, "admin", { fromCategoryId: "tel", toCategoryId: "el", items: [{ id: "p1", version: t1.toISOString() }] }), 422, /alt kateqoriya/);
  const tooMany = Array.from({ length: 101 }, (_, i) => ({ id: `x${i}`, version: t1.toISOString() }));
  await rejects(moveProductsToCategory(db, "admin", { fromCategoryId: "el", toCategoryId: "tel", items: tooMany }), 422, /100/);
  await rejects(moveProductsToCategory(db, "admin", { fromCategoryId: "el", toCategoryId: "tel", items: [{ id: "p1", version: t1.toISOString() }, { id: "p1", version: t1.toISOString() }] }), 422, /təkrar/);
});

test("DB guard errors are mapped to admin messages", () => {
  assert.throws(() => mapCategoryDbError(new Error("CATEGORY_DEPTH: parent x is itself a subcategory")), (error: unknown) => error instanceof CategoryAdminError && error.status === 422);
  assert.throws(() => mapCategoryDbError(new Error("CATEGORY_IN_USE: category x has products")), (error: unknown) => error instanceof CategoryAdminError && error.status === 409);
  assert.throws(() => mapCategoryDbError(new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "test" })), (error: unknown) => error instanceof CategoryAdminError && error.status === 409);
  assert.throws(() => mapCategoryDbError(new Error("other")), /other/);
});

test("admin routes: admin role and same-origin check on every category-tree endpoint; legacy branches use the service", () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
  assert.match(read("lib/admin-category-route.ts"), /csrfRejection\(request\)/);
  for (const path of ["app/api/admin/category-tree/route.ts", "app/api/admin/category-tree/[categoryId]/route.ts", "app/api/admin/category-tree/[categoryId]/reorder/route.ts", "app/api/admin/category-tree/move-products/route.ts"]) {
    const source = read(path);
    const handlers = source.match(/export async function (POST|PATCH|DELETE)/g) ?? [];
    assert.ok(handlers.length >= 1, path);
    assert.equal(source.match(/const admin = await requireRole\("ADMIN"\);\s*if \(!admin\) return adminForbidden\(\);/g)?.length, handlers.length, `${path}: every handler checks the ADMIN role first`);
    assert.equal(source.match(/runCategoryAdmin\(request,/g)?.length, handlers.length, `${path}: every handler runs the same-origin check`);
  }
  const legacy = read("app/api/admin/[...resource]/route.ts");
  assert.match(legacy, /createCategory\(db, admin\.id, body\)/);
  assert.match(legacy, /updateCategory\(db, admin\.id, categoryId, values\)/);
  assert.match(legacy, /deleteCategory\(db, admin\.id, parsed\.data\.id\)/);
  assert.doesNotMatch(legacy, /audit\(admin\.id, "UPDATE", "Category", id\)/);
});

test("Aktiv/Deaktiv switch: one audited change per click, products never touched", async () => {
  const t1 = new Date("2026-11-15T10:00:00.000Z");
  const { db, state, audits } = fakeDb(base(), [{ id: "p1", categoryId: "tel", updatedAt: t1 }, { id: "p2", categoryId: "el", updatedAt: t1 }]);
  const productsBefore = JSON.stringify(state.products);
  await updateCategory(db, "admin", "tel", { isActive: false });
  assert.equal(state.rows.find((r) => r.id === "tel")?.isActive, false);
  assert.deepEqual(audits.map((a) => [a.action, a.entityId]), [["CATEGORY_DEACTIVATE", "tel"]]);
  assert.deepEqual((audits[0].metadata as { before: unknown; after: unknown }), { before: { isActive: true }, after: { isActive: false } });
  await updateCategory(db, "admin", "tel", { isActive: true });
  assert.deepEqual(audits.map((a) => a.action), ["CATEGORY_DEACTIVATE", "CATEGORY_ACTIVATE"]);
  assert.equal(JSON.stringify(state.products), productsBefore, "no product row changed");
  const row = state.rows.find((r) => r.id === "tel")!;
  assert.deepEqual([row.parentId, row.sortOrder, row.iconKey, row.slug], ["el", 10, null, "telefonlar"], "parent, order, icon and slug unchanged");
});

test("parent off keeps each child's own state; parent on restores exactly the previously active children", async () => {
  const { db, state, audits } = fakeDb(base());
  await updateCategory(db, "admin", "pla", { isActive: false }); // a child that was already off
  await updateCategory(db, "admin", "el", { isActive: false });
  assert.deepEqual(state.rows.filter((r) => r.parentId === "el").map((r) => [r.id, r.isActive]), [["tel", true], ["pla", false]], "children untouched");
  assert.equal(audits.filter((a) => a.entityId === "tel").length, 0, "no write on the child");
  await updateCategory(db, "admin", "el", { isActive: true });
  assert.deepEqual(state.rows.filter((r) => r.parentId === "el").map((r) => [r.id, r.isActive]), [["tel", true], ["pla", false]]);
  assert.deepEqual(audits.map((a) => [a.action, a.entityId]), [["CATEGORY_DEACTIVATE", "pla"], ["CATEGORY_DEACTIVATE", "el"], ["CATEGORY_ACTIVATE", "el"]]);
});

test("the deactivate confirm explains children and what happens to products", async () => {
  const { deactivateMessage } = await import("../components/admin-category-manager");
  const withAll = deactivateMessage({ name: "Elektronika", parentId: null, totalCount: 5, childCount: 2 });
  assert.match(withAll, /2 alt kateqoriyası da mağazada gizlənəcək; onların öz statusu dəyişmir/);
  assert.match(withAll, /5 məhsul silinmir və köçürülmür: məhsul səhifəsi, axtarış, mağaza səhifəsi, səbət və sifariş əvvəlki kimi işləyir/);
  assert.match(withAll, /qaralama məhsullar .* yayımlana bilməz/);
  const empty = deactivateMessage({ name: "Keramika", parentId: "x", totalCount: 0, childCount: 0 });
  assert.doesNotMatch(empty, /məhsul|alt kateqoriya/);
  const source = readFileSync(resolve(process.cwd(), "components/admin-category-manager.tsx"), "utf8");
  assert.match(source, /if \(!next && \(category\.totalCount > 0 \|\| category\.childCount > 0\)\)/, "confirm only with products or subcategories");
  assert.match(source, /role="switch"/);
  assert.match(source, /aria-checked=\{active\}/);
  assert.match(source, /Üst kateqoriya deaktivdir/);
});
