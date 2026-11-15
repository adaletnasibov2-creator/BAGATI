import assert from "node:assert/strict";
import test from "node:test";
import { countVisibleProductsByCategory, toPublicTree } from "../lib/public-category-tree";
import { publicProductCatalogCandidateWhere } from "../lib/public-product-catalog";
import { categoryScopeWhere } from "../lib/category-where";
import type { CategoryRow } from "../lib/category-tree";

function store(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: "ACTIVE",
    isActive: true,
    legalInfoApproved: true,
    adminManaged: false,
    city: { isActive: true },
    vendor: { user: { isActive: true }, sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: "Seller", voen: "1234567890", legalAddress: null },
    subscription: { status: "ACTIVE", currentPeriodStart: null, currentPeriodEnd: null, plan: { isActive: true, slug: "basic" } },
    complimentaryEntitlements: [],
    ...overrides,
  };
}

function fakeDb(groups: { categoryId: string | null; storeId: string; n: number }[], stores: ReturnType<typeof store>[]) {
  const calls: { groupBy?: unknown } = {};
  const db = {
    product: {
      groupBy: async (args: unknown) => {
        calls.groupBy = args;
        return groups.map((group) => ({ categoryId: group.categoryId, storeId: group.storeId, _count: { _all: group.n } }));
      },
    },
    store: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => stores.filter((row) => where.id.in.includes(row.id)),
    },
  };
  return { db: db as never, calls };
}

const rows: CategoryRow[] = [
  { id: "el", name: "Elektronika", slug: "elektronika", parentId: null, isActive: true, sortOrder: 20, iconKey: "Smartphone", imageUrl: null },
  { id: "tel", name: "Telefonlar", slug: "telefonlar", parentId: "el", isActive: true, sortOrder: 10, iconKey: null, imageUrl: null },
  { id: "pla", name: "Planşetlər", slug: "plansetler", parentId: "el", isActive: true, sortOrder: 20, iconKey: null, imageUrl: null },
  { id: "av", name: "Avtomobil", slug: "avtomobil", parentId: null, isActive: true, sortOrder: 100, iconKey: "Car", imageUrl: null },
];

test("counts use the product list's candidate filter and exclude ineligible stores", async () => {
  const now = new Date("2026-11-15T10:00:00.000Z");
  const { db, calls } = fakeDb(
    [
      { categoryId: "el", storeId: "ok", n: 2 },
      { categoryId: "tel", storeId: "ok", n: 3 },
      { categoryId: "tel", storeId: "expired", n: 7 },
      { categoryId: null, storeId: "ok", n: 9 },
    ],
    [store("ok"), store("expired", { subscription: { status: "ACTIVE", currentPeriodStart: null, currentPeriodEnd: new Date("2026-01-01T00:00:00.000Z"), plan: { isActive: true, slug: "basic" } } })],
  );
  const counts = await countVisibleProductsByCategory(db, now, "qazax");
  assert.deepEqual([...counts.entries()].sort(), [["el", 2], ["tel", 3]]);
  const where = JSON.stringify((calls.groupBy as { where: unknown }).where);
  assert.ok(where.includes(JSON.stringify(publicProductCatalogCandidateWhere({ citySlug: "qazax" }, now))), "same candidate filter as the catalog");
  assert.match(where, /"categoryId":\{"not":null\}/);
});

test("public tree: top-level count includes subcategories; empty subcategories and top-levels are hidden", () => {
  const tree = toPublicTree(rows, new Map([["el", 2], ["tel", 3]]));
  assert.deepEqual(tree.map((top) => [top.slug, top.count]), [["elektronika", 5]]);
  assert.deepEqual(tree[0].children.map((child) => [child.slug, child.count, child.parentIconKey]), [["telefonlar", 3, "Smartphone"]]);
});

test("category scope filter: top-level slug matches itself or its subcategories, parent must be active", () => {
  const where = categoryScopeWhere("elektronika");
  assert.deepEqual(where, {
    isActive: true,
    AND: [
      { OR: [{ parentId: null }, { parent: { is: { isActive: true } } }] },
      { OR: [{ slug: "elektronika" }, { parent: { is: { slug: "elektronika" } } }] },
    ],
  });
  const catalog = JSON.stringify(publicProductCatalogCandidateWhere({ categorySlug: "telefonlar" }));
  assert.match(catalog, /"slug":"telefonlar"/);
});
