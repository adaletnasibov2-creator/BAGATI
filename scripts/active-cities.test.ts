/**
 * City list cache and ?city= bounds (SCALE-FIX-2 A6): one city query per 30 s instead of one or two per page, and
 * random ?city= values share one category-cache key instead of forcing a full category count each.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  ACTIVE_CITIES_CACHE_TTL_MS,
  CITY_SLUG_MAX_LENGTH,
  createActiveCitiesReader,
  publicCityKey,
  UNKNOWN_CITY_KEY,
  type ActiveCity,
} from "../lib/active-cities";
import { createPublicCategoryDataReader } from "../lib/public-category-tree";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const CITIES: ActiveCity[] = [
  { id: "c1", name: "Bakı", slug: "baki" },
  { id: "c2", name: "Qazax", slug: "qazax" },
];

test("the city list is read once per 30 s, shared, and a copy is returned", async () => {
  let now = 0;
  let loads = 0;
  const reader = createActiveCitiesReader(async () => { loads += 1; return CITIES.map((city) => ({ ...city, extra: "x" } as ActiveCity)); }, () => now);
  const [a, b] = await Promise.all([reader.read(), reader.read()]);
  assert.equal(loads, 1);
  assert.deepEqual(a, CITIES, "only id, name and slug");
  assert.notEqual(a, b, "each caller gets its own array");
  a.pop();
  assert.equal((await reader.read()).length, 2, "changing a copy does not change the cache");
  now += ACTIVE_CITIES_CACHE_TTL_MS - 1;
  await reader.read();
  assert.equal(loads, 1);
  now += 1;
  await reader.read();
  assert.equal(loads, 2);
  reader.invalidate();
  await reader.read();
  assert.equal(loads, 3, "an admin city save is visible on the next request");
  assert.ok(ACTIVE_CITIES_CACHE_TTL_MS >= 10_000 && ACTIVE_CITIES_CACHE_TTL_MS <= 60_000);
});

test("a failing city read is not cached and no empty list is invented", async () => {
  let fail = true;
  const reader = createActiveCitiesReader(async () => { if (fail) throw new Error("db down"); return CITIES; });
  await assert.rejects(reader.read(), /db down/);
  fail = false;
  assert.deepEqual(await reader.read(), CITIES);
});

test("publicCityKey: active slugs as given, nothing for no city, one shared key for everything else", () => {
  assert.equal(publicCityKey(undefined, CITIES), null);
  assert.equal(publicCityKey(null, CITIES), null);
  assert.equal(publicCityKey("", CITIES), null);
  assert.equal(publicCityKey("qazax", CITIES), "qazax");
  assert.equal(publicCityKey("baki", CITIES), "baki");
  for (const unknown of ["random-1", "Qazax", " qazax", "qazax ", "inactive-city", "x".repeat(CITY_SLUG_MAX_LENGTH + 1), "q".repeat(10_000)]) {
    assert.equal(publicCityKey(unknown, CITIES), UNKNOWN_CITY_KEY, unknown.slice(0, 20));
  }
  // The admin slug() keeps only [a-z0-9-], so the shared key can never be a real city's slug.
  assert.doesNotMatch(UNKNOWN_CITY_KEY, /^[a-z0-9-]+$/);
  assert.match(read("app/api/admin/[...resource]/route.ts"), /const slug = \(text: string\) => [^\n]*\.replace\(\/\[\^a-z0-9\]\+\/g, "-"\)/);
});

test("1000 random ?city= values load the category counts once, not 1000 times", async () => {
  let countLoads = 0;
  const categoryReader = createPublicCategoryDataReader({
    loadRows: async () => [],
    loadCounts: async () => { countLoads += 1; return new Map(); },
    readShowEmptySetting: async () => true,
  });
  await Promise.all(Array.from({ length: 1000 }, (_, index) => categoryReader.read(publicCityKey(`random-${index}`, CITIES))));
  assert.equal(countLoads, 1);
  assert.equal(categoryReader.size(), 1);
  // Before A6 every value was its own key (at most 32 kept, so real cities were evicted too).
  const before = createPublicCategoryDataReader({ loadRows: async () => [], loadCounts: async () => { countLoads += 1; return new Map(); }, readShowEmptySetting: async () => true });
  countLoads = 0;
  for (let index = 0; index < 50; index += 1) await before.read(`random-${index}`);
  assert.equal(countLoads, 50);
});

test("getPublicCategoryData bounds the city key; layout, home and checkout use the cached city list", () => {
  const tree = read("lib/public-category-tree.ts");
  assert.match(tree, /return getPublicCategoryDataForKey\(key === null \? null : publicCityKey\(key, await getActiveCities\(\)\)\);/);
  for (const path of ["app/(customer)/layout.tsx", "app/(customer)/(home)/page.tsx", "app/(customer)/checkout/page.tsx"]) {
    const source = read(path);
    assert.match(source, /getActiveCities\(\)/, path);
    assert.doesNotMatch(source, /city\.findMany/, path);
  }
  // The home page still resolves the shopper's city with the shared rule (default city for unknown values).
  assert.match(read("app/(customer)/(home)/page.tsx"), /const activeCities = await getActiveCities\(\);[\s\S]*resolveActiveCity\(activeCities, params\.city\)/);
  // Same query and order as before.
  assert.match(read("lib/active-cities.ts"), /prisma\.city\.findMany\(\{ where: \{ isActive: true \}, select: \{ id: true, name: true, slug: true \}, orderBy: \{ name: "asc" \} \}\)/);
});

test("admin city create and update invalidate the city list", () => {
  const admin = read("app/api/admin/[...resource]/route.ts");
  assert.match(admin, /entityType: "City", entityId: created\.id \} \}\); return created; \}\); invalidateActiveCitiesCache\(\);/);
  // ADMIN-3-SAFETY-1: the update and its audit row run in one transaction (lib/admin-audited-writes.ts); the cache is
  // invalidated after it, as before.
  assert.match(admin, /const item = await updateCityAudited\(db, admin\.id, cityId, id, [^\n]*\}\); invalidateActiveCitiesCache\(\);/);
  assert.match(read("lib/admin-audited-writes.ts"), /tx\.city\.update\(\{ where: \{ id: cityId \}, data \}\);\s*await tx\.auditLog\.create\(\{ data: \{ actorId: adminId, action: "UPDATE", entityType: "City", entityId: auditEntityId \} \}\);/);
});
