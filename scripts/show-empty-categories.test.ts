import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { categorySiblingLinks, isPublicCategory, publicCategoryTree, type CategoryRow } from "../lib/category-tree";
import { toPublicTree } from "../lib/public-category-tree";
import { categoryPageMetadata } from "../lib/category-seo";

const row = (id: string, name: string, parentId: string | null, sortOrder: number, extra: Partial<CategoryRow> = {}): CategoryRow =>
  ({ id, name, slug: id, parentId, isActive: true, sortOrder, iconKey: null, imageUrl: null, ...extra });

const rows: CategoryRow[] = [
  row("el", "Elektronika", null, 20, { iconKey: "Smartphone" }),
  row("ak", "Aksesuarlar", null, 10, { iconKey: "Watch" }),
  row("av", "Avtomobil", null, 100, { iconKey: "Car" }),
  row("dg", "Digər", null, 1000),
  row("tel", "Telefonlar", "el", 10),
  row("pla", "Planşetlər", "el", 20),
  row("saat", "Saatlar", "ak", 10),
  row("teker", "Təkər", "av", 10),
];
const oneProduct = new Map([["tel", 1]]);
const ids = (tree: { id: string; children: { id: string }[] }[]) => tree.map((top) => [top.id, top.children.map((child) => child.id)]);

test("setting ON: every active category and subcategory is shown in sortOrder, Digər last, empty ones with count 0", () => {
  const tree = publicCategoryTree(rows, oneProduct, { showEmpty: true });
  assert.deepEqual(ids(tree), [["ak", ["saat"]], ["el", ["tel", "pla"]], ["av", ["teker"]], ["dg", []]]);
  assert.deepEqual(tree.map((top) => top.count), [0, 1, 0, 0]);
  assert.equal(tree[1].children[1].count, 0);
});

test("setting OFF: the old behaviour, only categories with visible products", () => {
  assert.deepEqual(ids(publicCategoryTree(rows, oneProduct, { showEmpty: false })), [["el", ["tel"]]]);
  assert.deepEqual(ids(publicCategoryTree(rows, oneProduct)), [["el", ["tel"]]], "OFF is the function default");
});

test("deactivated categories are hidden in both states; a deactivated parent hides its still-active subcategories", () => {
  const off = rows.map((r) => (r.id === "pla" ? { ...r, isActive: false } : r.id === "el" ? r : r));
  assert.deepEqual(ids(publicCategoryTree(off, oneProduct, { showEmpty: true }))[1], ["el", ["tel"]]);
  const parentOff = rows.map((r) => (r.id === "el" ? { ...r, isActive: false } : r));
  for (const showEmpty of [true, false]) {
    const tree = publicCategoryTree(parentOff, oneProduct, { showEmpty });
    assert.ok(!tree.some((top) => top.id === "el"), `parent hidden (showEmpty ${showEmpty})`);
    assert.ok(!tree.flatMap((top) => top.children).some((child) => child.id === "tel" || child.id === "pla"), "children hidden with it");
  }
  assert.equal(parentOff.find((r) => r.id === "tel")?.isActive, true, "the child's own state is untouched");
  // Reactivating the parent restores exactly the children that were active (pla stays off if it was off).
  const restored = parentOff.map((r) => (r.id === "el" ? { ...r, isActive: true } : r.id === "pla" ? { ...r, isActive: false } : r));
  assert.deepEqual(ids(publicCategoryTree(restored, oneProduct, { showEmpty: true }))[1], ["el", ["tel"]]);
});

test("isPublicCategory: active, and for a subcategory an active parent", () => {
  assert.equal(isPublicCategory(rows, "tel"), true);
  assert.equal(isPublicCategory(rows, "av"), true, "an empty active top-level is public");
  assert.equal(isPublicCategory(rows.map((r) => (r.id === "el" ? { ...r, isActive: false } : r)), "tel"), false);
  assert.equal(isPublicCategory(rows.map((r) => (r.id === "tel" ? { ...r, isActive: false } : r)), "tel"), false);
  assert.equal(isPublicCategory(rows, "missing"), false);
});

test("empty-page links: siblings for a subcategory, children or other top-levels for a top-level", () => {
  const tree = toPublicTree(rows, oneProduct, { showEmpty: true });
  assert.deepEqual(categorySiblingLinks(tree, "pla").map((link) => link.slug), ["el", "tel"]);
  assert.deepEqual(categorySiblingLinks(tree, "el").map((link) => link.slug), ["tel", "pla"]);
  assert.deepEqual(categorySiblingLinks(tree, "dg").map((link) => link.slug), ["ak", "el", "av"]);
  assert.deepEqual(categorySiblingLinks(tree, "").map((link) => link.slug), ["ak", "el", "av", "dg"], "unknown/unavailable: top-levels");
  assert.ok(categorySiblingLinks(tree, "dg", 2).length === 2);
});

test("SEO: an empty category page is noindex,follow and keeps its canonical; a non-empty one is indexable", () => {
  const empty = categoryPageMetadata({ category: { name: "Avtomobil", slug: "avtomobil", isActive: true }, parent: null, visibleCount: 0, base: "https://shopbagati.example" });
  assert.deepEqual(empty.robots, { index: false, follow: true });
  assert.equal((empty.alternates as { canonical: string }).canonical, "https://shopbagati.example/products?category=avtomobil");
  const full = categoryPageMetadata({ category: { name: "Elektronika", slug: "elektronika", isActive: true }, parent: null, visibleCount: 3, base: "https://shopbagati.example" });
  assert.equal(full.robots, undefined);
  assert.deepEqual(categoryPageMetadata({ category: null, parent: null, visibleCount: 0 }).robots, { index: false, follow: true });
});

test("wiring: the public loader reads the setting; zero counts are never rendered; empty states are in place", () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
  const loader = read("lib/public-category-tree.ts");
  assert.match(loader, /getSetting<boolean>\(SETTING_KEYS\.catalogShowEmptyCategories\)/);
  assert.match(loader, /const showEmpty = setting !== false;/, "default ON when the setting has no value");
  assert.match(loader, /toPublicTree\(rows, counts, \{ showEmpty \}\)/);
  for (const path of ["components/category-mega-menu.tsx", "components/mobile-menu.tsx"]) {
    assert.match(read(path), /\{child\.count \? <span/, path);
    assert.doesNotMatch(read(path), /typeof child\.count === "number"/, path);
  }
  const filter = read("components/category-filter-tree.tsx");
  assert.match(filter, /\{top\.count \? <span/);
  assert.match(filter, /\{child\.count \? <span/);
  assert.match(read("app/(customer)/categories/page.tsx"), /\{child\.count \? <span className="opacity-70">/);
  assert.match(read("components/category-empty-state.tsx"), /Bu kateqoriyada hələ məhsul yoxdur\. Tezliklə əlavə olunacaq\./);
  assert.match(read("components/category-empty-state.tsx"), />Bütün məhsullar</);
  assert.match(read("app/(customer)/products/(list)/page.tsx"), /<CategoryEmptyState links=\{categorySiblingLinks\(categoryData\.tree, selectedCategory\.category\.id\)\} \/>/);
  assert.match(read("app/(customer)/categories/page.tsx"), /<CategoryEmptyState links=\{categorySiblingLinks\(categories, selected\.id\)\}/);
  assert.match(read("app/(customer)/products/[productId]/page.tsx"), /const publicCategory = product\.category && product\.category\.isActive && \(!product\.category\.parent \|\| product\.category\.parent\.isActive\)/);
});
