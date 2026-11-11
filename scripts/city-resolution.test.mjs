import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_CITY_SLUG, resolveActiveCity } from "../lib/city-resolution.ts";

const cities = [
  { id: "c1", name: "Bakı", slug: "baki" },
  { id: "c2", name: "Gəncə", slug: "gence" },
  { id: "c3", name: "Qazax", slug: "qazax" },
];

test("a requested active city is used as-is", () => {
  assert.equal(resolveActiveCity(cities, "gence")?.name, "Gəncə");
  assert.equal(resolveActiveCity(cities, " GENCE ")?.slug, "gence");
});

test("missing or unknown/inactive slugs fall back to the default city instead of an empty page", () => {
  assert.equal(DEFAULT_CITY_SLUG, "qazax");
  assert.equal(resolveActiveCity(cities, undefined)?.slug, "qazax");
  assert.equal(resolveActiveCity(cities, "deleted-city")?.slug, "qazax");
});

test("without the default city, the first active city by Azerbaijani name order is used", () => {
  const withoutDefault = cities.filter((city) => city.slug !== "qazax").reverse();
  assert.equal(resolveActiveCity(withoutDefault, null)?.slug, "baki");
});

test("no active cities resolves to null so pages can show an explicit empty state", () => {
  assert.equal(resolveActiveCity([], "qazax"), null);
});

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the public city API returns only active cities with the fields the UI needs", () => {
  const api = read("app/api/cities/route.ts");
  assert.match(api, /where: \{ isActive: true \}/);
  assert.match(api, /select: \{ id: true, name: true, slug: true \}/);
});

test("homepage and city selector share the same resolution rule", () => {
  assert.match(read("app/(customer)/page.tsx"), /resolveActiveCity\(activeCities, params\.city\)/);
  assert.doesNotMatch(read("app/(customer)/page.tsx"), /params\.city \|\| "qazax"/);
  assert.match(read("components/city-selector.tsx"), /resolveActiveCity\(cities\)/);
});

test("the city selector is visible in the mobile header, not only inside the menu", () => {
  const header = read("components/header.tsx");
  const mobileRow = header.slice(header.indexOf('pb-3 md:hidden'));
  assert.match(mobileRow, /<CitySelector cities=\{cities\} compact \/>/);
});
