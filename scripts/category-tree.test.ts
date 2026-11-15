import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCategoryTree,
  categoryBreadcrumbs,
  categoryHref,
  categoryScopeIds,
  categorySlug,
  checkCategoryPlacement,
  checkProductCategoryChoice,
  findCategoryBySlug,
  isValidCategorySlug,
  parseCategoryPath,
  publicCategoryTree,
  rollUpCategoryCounts,
  sortCategories,
  uniqueCategorySlug,
  type CategoryRow,
} from "../lib/category-tree";
import { INITIAL_CATEGORIES } from "../lib/reference-data";
import { CATEGORY_SEED } from "../lib/category-seed";

function row(id: string, name: string, parentId: string | null = null, extra: Partial<CategoryRow> = {}): CategoryRow {
  return { id, name, slug: categorySlug(name), parentId, isActive: true, sortOrder: 0, iconKey: null, imageUrl: null, ...extra };
}

const rows: CategoryRow[] = [
  row("el", "Elektronika", null, { slug: "elektronika", sortOrder: 20 }),
  row("ak", "Aksesuarlar", null, { slug: "aksesuarlar", sortOrder: 10 }),
  row("dg", "Digər", null, { slug: "diger", sortOrder: 5 }),
  row("tel", "Telefonlar", "el", { sortOrder: 10 }),
  row("pla", "Planşetlər", "el", { sortOrder: 20 }),
  row("saat", "Saatlar", "ak", { sortOrder: 10 }),
];

test("depth rule: a subcategory's parent must be top-level", () => {
  assert.equal(checkCategoryPlacement(rows, { parentId: null }), null);
  assert.equal(checkCategoryPlacement(rows, { parentId: "el" }), null);
  assert.equal(checkCategoryPlacement(rows, { parentId: "tel" }), "PARENT_IS_SUBCATEGORY");
  assert.equal(checkCategoryPlacement(rows, { parentId: "missing" }), "PARENT_NOT_FOUND");
});

test("depth rule: a top-level with children cannot be moved under another; self-parent refused", () => {
  assert.equal(checkCategoryPlacement(rows, { id: "el", parentId: "ak" }), "HAS_CHILDREN");
  assert.equal(checkCategoryPlacement(rows, { id: "dg", parentId: "ak" }), null);
  assert.equal(checkCategoryPlacement(rows, { id: "ak", parentId: "ak" }), "SELF_PARENT");
  assert.equal(checkCategoryPlacement(rows, { id: "tel", parentId: "ak" }), null, "moving a subcategory to another parent");
});

test("slugs are ASCII via the project transliteration and unique with a numeric suffix", () => {
  assert.equal(categorySlug("Ev heyvanları"), "ev-heyvanlari");
  assert.equal(categorySlug("Zərgərlik (əl işi)"), "zergerlik-el-isi");
  assert.equal(categorySlug("İçkilər"), "ickiler");
  assert.ok(isValidCategorySlug("ev-heyvanlari"));
  assert.ok(!isValidCategorySlug("Ev"));
  assert.ok(!isValidCategorySlug("a"));
  assert.ok(!isValidCategorySlug("ev--x"));
  assert.equal(uniqueCategorySlug("saatlar", new Set(["saatlar", "saatlar-2"])), "saatlar-3");
  assert.equal(uniqueCategorySlug("yeni", new Set()), "yeni");
});

test("seed list: every slug is unique, valid and does not collide with the launch categories", () => {
  const all = new Set<string>(INITIAL_CATEGORIES.map((c) => c.slug));
  for (const top of CATEGORY_SEED) {
    for (const item of [top, ...top.children]) {
      if (top.existing && item === top) {
        assert.ok(all.has(item.slug), `${item.slug} is a launch category`);
        continue;
      }
      assert.ok(isValidCategorySlug(item.slug), item.slug);
      assert.ok(!all.has(item.slug), `duplicate slug ${item.slug}`);
      all.add(item.slug);
    }
  }
  assert.equal(all.size, 10 + 84);
});

test("ordering: sortOrder, then name, and Digər always last", () => {
  assert.deepEqual(sortCategories(rows.filter((r) => !r.parentId)).map((r) => r.id), ["ak", "el", "dg"]);
  const tree = buildCategoryTree(rows);
  assert.deepEqual(tree.map((t) => t.id), ["ak", "el", "dg"]);
  assert.deepEqual(tree[1].children.map((c) => c.id), ["tel", "pla"]);
});

test("tree drops orphans and rows below a subcategory instead of promoting them", () => {
  const tree = buildCategoryTree([...rows, row("x", "Orphan", "gone"), row("deep", "Dərin", "tel")]);
  assert.deepEqual(tree.map((t) => t.id), ["ak", "el", "dg"]);
  assert.ok(!tree.flatMap((t) => t.children).some((c) => c.id === "deep" || c.id === "x"));
});

test("scope: a top-level lists itself and its subcategories, a subcategory only itself", () => {
  assert.deepEqual(categoryScopeIds(rows, "el").sort(), ["el", "pla", "tel"]);
  assert.deepEqual(categoryScopeIds(rows, "tel"), ["tel"]);
  assert.deepEqual(categoryScopeIds(rows, "dg"), ["dg"]);
  assert.deepEqual(categoryScopeIds(rows, "none"), []);
});

test("old ?category=<slug> URLs resolve; the canonical URL is unchanged", () => {
  assert.equal(findCategoryBySlug(rows, "elektronika")?.category.id, "el");
  assert.equal(findCategoryBySlug(rows, "telefonlar")?.parent?.id, "el");
  assert.equal(findCategoryBySlug(rows, "nope"), null);
  assert.equal(findCategoryBySlug(rows, ""), null);
  assert.equal(categoryHref("ev-ve-mesiet"), "/products?category=ev-ve-mesiet");
});

test("breadcrumbs: Ana səhifə > Üst > Alt", () => {
  const found = findCategoryBySlug(rows, "telefonlar")!;
  assert.deepEqual(categoryBreadcrumbs(found.category, found.parent), [
    { name: "Ana səhifə", href: "/" },
    { name: "Elektronika", href: "/products?category=elektronika" },
    { name: "Telefonlar", href: null },
  ]);
  assert.deepEqual(categoryBreadcrumbs(rows[0], null).map((c) => c.name), ["Ana səhifə", "Elektronika"]);
});

test("counts roll up to the parent; public tree hides empty and inactive categories", () => {
  const direct = new Map([["el", 2], ["tel", 3], ["saat", 0]]);
  const totals = rollUpCategoryCounts(rows, direct);
  assert.equal(totals.get("el"), 5);
  assert.equal(totals.get("tel"), 3);
  assert.equal(totals.get("ak"), 0);

  const tree = publicCategoryTree(rows, direct);
  assert.deepEqual(tree.map((t) => [t.id, t.count]), [["el", 5]], "empty Aksesuarlar and Digər hidden");
  assert.deepEqual(tree[0].children.map((c) => [c.id, c.count]), [["tel", 3]], "empty Planşetlər hidden");

  const inactiveParent = rows.map((r) => (r.id === "el" ? { ...r, isActive: false } : r));
  assert.deepEqual(publicCategoryTree(inactiveParent, direct), [], "an inactive top-level hides its subcategories too");
  const inactiveChild = rows.map((r) => (r.id === "tel" ? { ...r, isActive: false } : r));
  assert.deepEqual(publicCategoryTree(inactiveChild, direct).map((t) => [t.id, t.count]), [["el", 2]]);
});

test("product category choice: new products must pick a subcategory; old ones are not blocked", () => {
  assert.equal(checkProductCategoryChoice(rows, { categoryId: "el" }), "SUBCATEGORY_REQUIRED");
  assert.equal(checkProductCategoryChoice(rows, { categoryId: "tel" }), null);
  assert.equal(checkProductCategoryChoice(rows, { categoryId: "dg" }), null, "a top-level without subcategories is fine");
  assert.equal(checkProductCategoryChoice(rows, { categoryId: null }), null);
  assert.equal(checkProductCategoryChoice(rows, { categoryId: "el", previousCategoryId: "el" }), null, "unchanged old product");
  assert.equal(checkProductCategoryChoice(rows, { categoryId: "el", previousCategoryId: "dg" }), "SUBCATEGORY_REQUIRED", "changed");
  assert.equal(checkProductCategoryChoice(rows, { categoryId: "nope" }), "NOT_FOUND");
  assert.equal(checkProductCategoryChoice(rows, { categoryId: "tel", expectedParentId: "ak" }), "PARENT_MISMATCH");
  assert.equal(checkProductCategoryChoice(rows, { categoryId: "tel", expectedParentId: "el" }), null);
  const off = rows.map((r) => (r.id === "el" ? { ...r, isActive: false } : r));
  assert.equal(checkProductCategoryChoice(off, { categoryId: "tel" }), "PARENT_INACTIVE");
  const offChild = rows.map((r) => (r.id === "tel" ? { ...r, isActive: false } : r));
  assert.equal(checkProductCategoryChoice(offChild, { categoryId: "tel" }), "INACTIVE");
  assert.equal(checkProductCategoryChoice(offChild, { categoryId: "tel", previousCategoryId: "tel" }), null, "unchanged inactive is kept");
});

test("category path parsing for the importer", () => {
  assert.deepEqual(parseCategoryPath("Elektronika > Telefonlar"), ["Elektronika", "Telefonlar"]);
  assert.deepEqual(parseCategoryPath(" telefonlar "), ["telefonlar"]);
  assert.equal(parseCategoryPath("a > b > c"), null);
  assert.equal(parseCategoryPath("a > "), null);
});

test("DB guard errors use check_violation so the CATEGORY_* text reaches the app (Prisma maps 23503 to a generic P2003)", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync("prisma/migrations/20261116010000_category_tree/migration.sql", "utf8");
  assert.doesNotMatch(sql, /foreign_key_violation/);
  assert.equal(sql.match(/USING ERRCODE = 'check_violation'/g)?.length, 5);
});
