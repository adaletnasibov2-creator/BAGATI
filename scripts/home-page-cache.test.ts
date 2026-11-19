/**
 * Home page data cache (SCALE-FIX-2 B3): one load per city per 30 s, shared by every visitor, nothing per visitor in
 * it, invalidated by admin banner / homepage-selection saves, and a direct database read if the cache layer fails.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  createHomePageDataReader,
  HOME_PAGE_CACHE_TTL_MS,
  homePageCacheKey,
  type HomeCity,
  type HomePageData,
} from "../lib/home-page-data";
import type { KeyedTtlCache } from "../lib/keyed-ttl-cache";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const qazax: HomeCity = { id: "city-qazax", name: "Qazax", slug: "qazax" };
const baku: HomeCity = { id: "city-baku", name: "Bakı", slug: "baki" };

function data(label: string): HomePageData {
  return {
    banners: [{ id: label, title: label, description: "", imageUrl: "/x.webp", buttonLabel: "", href: "/", startsAt: new Date(0), endsAt: new Date(1), isActive: true, sortOrder: 0 }],
    featuredProducts: [], popular: [], newestVisible: [], promotionalById: new Map(), discounted: [], eligibleCampaigns: [],
    homepageStores: [], storesAreFeatured: false, hasHomepageContent: false,
  };
}

function harness() {
  let now = 1_000_000;
  const loads: { city: string; at: number }[] = [];
  const logs: string[] = [];
  const reader = createHomePageDataReader({
    clock: () => now,
    log: (line) => logs.push(line),
    load: async (city, at) => {
      loads.push({ city: city?.slug ?? "", at: at.getTime() });
      return data(`${city?.slug ?? "none"}-${loads.length}`);
    },
  });
  return { reader, loads, logs, advance: (ms: number) => { now += ms; } };
}

test("TTL is between 30 and 60 seconds", () => {
  assert.ok(HOME_PAGE_CACHE_TTL_MS >= 30_000 && HOME_PAGE_CACHE_TTL_MS <= 60_000);
});

test("one load per city within the TTL, a new load after it", async () => {
  const { reader, loads, advance } = harness();
  const first = await reader.read(qazax);
  advance(HOME_PAGE_CACHE_TTL_MS - 1);
  assert.equal(await reader.read(qazax), first, "served from memory");
  assert.equal(loads.length, 1);
  advance(1);
  const second = await reader.read(qazax);
  assert.notEqual(second, first);
  assert.equal(loads.length, 2);
});

test("each city has its own entry; the key is the resolved city id, never the raw ?city= value", async () => {
  const { reader, loads } = harness();
  const q = await reader.read(qazax);
  const b = await reader.read(baku);
  assert.notEqual(q, b);
  assert.equal(await reader.read(qazax), q);
  assert.equal(await reader.read(baku), b);
  assert.deepEqual(loads.map((load) => load.city), ["qazax", "baki"]);
  assert.equal(homePageCacheKey(qazax), "city-qazax");
  assert.equal(homePageCacheKey(null), "");
  // The page resolves ?city= against the active city list first, so unknown values share the default city's entry.
  const page = read("app/(customer)/(home)/page.tsx");
  assert.match(page, /const city = resolveActiveCity\(activeCities, params\.city\);[\s\S]*getHomePageData\(city\)/);
  assert.doesNotMatch(page, /getHomePageData\(params/);
});

test("concurrent visitors share one load", async () => {
  const { reader, loads } = harness();
  const results = await Promise.all(Array.from({ length: 20 }, () => reader.read(qazax)));
  assert.equal(loads.length, 1);
  assert.ok(results.every((result) => result === results[0]));
});

test("invalidate() (admin save) makes the next visit load fresh data for every city", async () => {
  const { reader, loads } = harness();
  await reader.read(qazax);
  await reader.read(baku);
  reader.invalidate();
  await reader.read(qazax);
  await reader.read(baku);
  assert.equal(loads.length, 4);
});

test("a failing database read is not cached and not retried (surfaces as before)", async () => {
  let calls = 0;
  const reader = createHomePageDataReader({
    log: () => {},
    load: async () => { calls += 1; throw Object.assign(new Error("pool timeout"), { code: "P2024" }); },
  });
  await assert.rejects(reader.read(qazax), /pool timeout/);
  assert.equal(calls, 1, "no second database attempt");
  await assert.rejects(reader.read(qazax), /pool timeout/);
  assert.equal(calls, 2, "the next visit tries again (errors are not cached)");
  assert.equal(reader.size(), 0);
});

test("if the cache layer fails, the page reads straight from the database", async () => {
  const logs: string[] = [];
  let calls = 0;
  const broken: KeyedTtlCache<string, HomePageData> = {
    get: async () => { throw new TypeError("cache broken"); },
    invalidate: () => {},
    size: () => 0,
  };
  const reader = createHomePageDataReader({
    cache: broken,
    log: (line) => logs.push(line),
    load: async () => { calls += 1; return data("direct"); },
  });
  const result = await reader.read(qazax);
  assert.equal(result.banners[0].id, "direct");
  assert.equal(calls, 1);
  assert.deepEqual(logs.map((line) => JSON.parse(line)), [{ event: "home_page_cache.failed", error: "TypeError" }]);
});

test("nothing per visitor goes into the cache", () => {
  const lib = read("lib/home-page-data.ts");
  const page = read("app/(customer)/(home)/page.tsx");
  for (const source of [lib, page]) {
    assert.doesNotMatch(source, /currentUser|requireRole|getSession|next\/headers|cookies\(\)|headers\(\)|bagati_session|favorite|cart/i);
  }
  // The cached value has exactly these fields: shelves, banners, campaigns and stores.
  assert.deepEqual(Object.keys(data("x")).sort(), [
    "banners", "discounted", "eligibleCampaigns", "featuredProducts", "hasHomepageContent", "homepageStores",
    "newestVisible", "popular", "promotionalById", "storesAreFeatured",
  ]);
  // The page reads no database rows itself: shelves, cities (A6), categories and settings are all cached.
  assert.doesNotMatch(page, /prisma\./);
});

test("admin banner and homepage-selection saves invalidate the cache after the write commits", () => {
  for (const [path, after] of [
    ["app/api/admin/homepage/banners/route.ts", /HOME_BANNER_CREATE[\s\S]*\}\);\s*invalidateHomePageCache\(\)/],
    ["app/api/admin/homepage/banners/[bannerId]/route.ts", /HOME_BANNER_UPDATE[\s\S]*\}\);\s*invalidateHomePageCache\(\)/],
    ["app/api/admin/homepage/banners/[bannerId]/route.ts", /if \(!changed\)[^\n]*\n\s*invalidateHomePageCache\(\)/],
    ["app/api/admin/homepage/featured/route.ts", /HOMEPAGE_FEATURED_UPDATE[\s\S]*\}\);\s*invalidateHomePageCache\(\)/],
  ] as const) {
    assert.match(read(path), after, path);
  }
});
