/**
 * Lighter page payload (SCALE-FIX-3, B2): the product card and the /products category filter tree are client
 * components, so the server sends their props instead of their rendered element trees. The HTML and every link must
 * stay the same (the browser DOM comparison main vs branch is in release-output/scale-fix-3-report.md).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { CategoryFilterTree } from "../components/category-filter-tree";
import { categoryFilterHref, type CategoryFilterLink } from "../lib/category-filter-href";
import { previewCategoryTree } from "../lib/category-preview-data";

// Components use the classic JSX runtime under tsx (same as scripts/design-home.test.ts).
(globalThis as { React?: typeof React }).React = React;

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
const render = (element: React.ReactElement) => renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router as never }, element));

/** The page's filter-link function before SCALE-FIX-3, copied verbatim as the reference. */
function oldCategoryFilterHref(slug: string | null, searchQuery: string, params: { city?: string; store?: string }, sort: string) {
  const query = new URLSearchParams();
  if (slug) query.set("category", slug);
  if (searchQuery) query.set("q", searchQuery);
  if (params.city) query.set("city", params.city);
  if (params.store) query.set("store", params.store);
  if (sort !== "newest") query.set("sort", sort);
  return `/products${query.size ? `?${query.toString()}` : ""}`;
}
/** Same construction as app/(customer)/products/(list)/page.tsx. */
function pageLink(searchQuery: string, params: { city?: string; store?: string }, sort: string): CategoryFilterLink {
  return {
    path: "/products",
    params: [
      ...(searchQuery ? [["q", searchQuery] as [string, string]] : []),
      ...(params.city ? [["city", params.city] as [string, string]] : []),
      ...(params.store ? [["store", params.store] as [string, string]] : []),
      ...(sort !== "newest" ? [["sort", sort] as [string, string]] : []),
    ],
  };
}

test("filter links are byte-identical to the old page function for every combination", () => {
  const queries = ["", "Noutbuk", "qırmızı & ağ", "a+b=c?d#e/f"];
  const cities = [{}, { city: "qazax" }, { city: "x y&z" }];
  const stores = [{}, { store: "st1" }];
  const sorts = ["newest", "name"];
  const slugs = [null, "elektronika", "el-isi-ve-milli"];
  let checked = 0;
  for (const q of queries) for (const city of cities) for (const store of stores) for (const sort of sorts) for (const slug of slugs) {
    const params = { ...city, ...store };
    assert.equal(categoryFilterHref(pageLink(q, params, sort), slug), oldCategoryFilterHref(slug, q, params, sort));
    checked += 1;
  }
  assert.equal(checked, 4 * 3 * 2 * 2 * 3);
  assert.equal(categoryFilterHref({ path: "/products", params: [] }, null), "/products", "no '?' when nothing is added");
  assert.equal(categoryFilterHref({ path: "/storefront-preview/categories", params: [] }, "elektronika"), "/storefront-preview/categories?category=elektronika");
});

test("the client filter tree renders every link, count and selected state as before", () => {
  const link = pageLink("Noutbuk", { city: "qazax" }, "name");
  const top = previewCategoryTree.find((node) => node.children.length > 0)!;
  const child = top.children[0];
  const html = render(createElement(CategoryFilterTree, { tree: previewCategoryTree, selectedSlug: child.slug, link }));
  const hrefs = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
  const expected = [oldCategoryFilterHref(null, "Noutbuk", { city: "qazax" }, "name")];
  for (const node of previewCategoryTree) {
    expected.push(oldCategoryFilterHref(node.slug, "Noutbuk", { city: "qazax" }, "name"));
    for (const sub of node.children) expected.push(oldCategoryFilterHref(sub.slug, "Noutbuk", { city: "qazax" }, "name"));
  }
  assert.deepEqual(hrefs, expected);
  // The selected child is marked current and its parent group is open; nothing else is current.
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(html, new RegExp(`aria-current="page"[^>]*>(?:(?!</a>).)*${child.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.equal((html.match(/<details open=""/g) ?? []).length, 1);
});

test("card and filter tree are client components; the server passes only plain data", () => {
  assert.match(read("components/product-card.tsx"), /^"use client";/);
  assert.match(read("components/category-filter-tree.tsx"), /^"use client";/);
  const list = read("app/(customer)/products/(list)/page.tsx");
  assert.match(list, /<CategoryFilterTree tree=\{categoryData\.tree\} selectedSlug=\{[^}]+\} link=\{filterLink\} \/>/);
  assert.doesNotMatch(list, /<CategoryFilterTree[^>]*href=/, "no function prop to a client component");
  const preview = read("app/storefront-preview/categories/page.tsx");
  assert.equal((preview.match(/<CategoryFilterTree [^>]*link=\{filterLink\} \/>/g) ?? []).length, 2);
  assert.doesNotMatch(preview, /<CategoryFilterTree[^>]*href=/);
  // Every ProductCard caller passes strings, numbers, booleans or null (a function or element would not serialise).
  for (const path of ["app/(customer)/(home)/page.tsx", "app/(customer)/products/(list)/page.tsx", "components/product-grid.tsx", "app/storefront-preview/page.tsx", "app/storefront-preview/categories/page.tsx"]) {
    const source = read(path);
    for (const call of source.match(/<ProductCard\b[\s\S]*?\/>/g) ?? []) {
      assert.doesNotMatch(call, /\b\w+=\{\s*(?:async\s*)?(?:\([^()]*\)|\w+)\s*=>/, `${path}: no function prop to the card`);
      assert.doesNotMatch(call, /\b\w+=\{\s*</, `${path}: no element prop to the card`);
    }
  }
});
