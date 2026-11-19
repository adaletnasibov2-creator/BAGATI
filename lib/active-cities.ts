/**
 * Active cities for public pages (SCALE-FIX-2 A6).
 *
 * Before: the customer layout read the city list on every page, and the home page and checkout read it again. Now it
 * is cached in this process for 30 s (one key), shared by concurrent requests, and de-duplicated within a request. An
 * admin city create/edit/activate calls invalidateActiveCitiesCache(). A failing read is not cached and surfaces as
 * before (no stale or empty list is invented: an empty list would show every visitor an empty home page).
 *
 * ?city= bounds: the city slug comes from the query string. The category tree cache is keyed by it, so before, every
 * random ?city= value forced a full category count (the heaviest layout query, about 200 ms in SCALE-1) and pushed
 * real entries out of the cache. publicCityKey() maps every value that is not an active city's slug to one shared
 * key. That key matches no city, which is exactly what the unknown value did (the catalog filter is
 * `city: { isActive: true, slug }`), so results are unchanged.
 */
import { cache } from "react";
import { createKeyedTtlCache } from "@/lib/keyed-ttl-cache";

export type ActiveCity = { id: string; name: string; slug: string };

export const ACTIVE_CITIES_CACHE_TTL_MS = 30_000;
/**
 * Admin city input is at most 120 characters (app/api/admin/[...resource]/route.ts); 200 leaves room for Unicode
 * normalisation in slug(). Longer values are never compared against the list.
 */
export const CITY_SLUG_MAX_LENGTH = 200;
/** Shared key for every ?city= value that is not an active city. `~` never appears in a slug, so it matches no city. */
export const UNKNOWN_CITY_KEY = "~unknown-city";

export type ActiveCitiesLoader = () => Promise<ActiveCity[]>;

export function createActiveCitiesReader(load: ActiveCitiesLoader, clock: () => number = Date.now) {
  const shared = createKeyedTtlCache<"active", readonly ActiveCity[]>({ ttlMs: ACTIVE_CITIES_CACHE_TTL_MS, maxKeys: 1, clock });
  return {
    /** A new array per call, so callers cannot change the cached one. */
    async read(): Promise<ActiveCity[]> {
      const cities = await shared.get("active", async () => Object.freeze((await load()).map((city) => Object.freeze({ id: city.id, name: city.name, slug: city.slug }))));
      return [...cities];
    },
    invalidate: () => shared.invalidate(),
  };
}

/**
 * The value to use as the city key for caches and city filters: null for no city (every city), the slug when it is an
 * active city's slug, otherwise UNKNOWN_CITY_KEY. Matching is exact, like the catalog filter (no trimming or
 * lower-casing), so "Qazax" stays "no such city" as before.
 */
export function publicCityKey(raw: string | null | undefined, activeCities: readonly ActiveCity[]): string | null {
  if (!raw) return null;
  if (raw.length > CITY_SLUG_MAX_LENGTH) return UNKNOWN_CITY_KEY;
  return activeCities.some((city) => city.slug === raw) ? raw : UNKNOWN_CITY_KEY;
}

/** Kept on globalThis so route handlers and pages share one instance even if the bundler duplicates this module. */
const globalForCities = globalThis as unknown as { bagatiActiveCitiesReader?: ReturnType<typeof createActiveCitiesReader> };
function reader() {
  return globalForCities.bagatiActiveCitiesReader ??= createActiveCitiesReader(async () => {
    const { prisma } = await import("@/lib/prisma");
    return prisma.city.findMany({ where: { isActive: true }, select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } });
  });
}

/** Active cities by name (same query and order as before), cached for 30 s and once per request. */
export const getActiveCities = cache((): Promise<ActiveCity[]> => reader().read());

/** Call after a committed admin city create or update (name, slug, active state). */
export function invalidateActiveCitiesCache(): void {
  reader().invalidate();
}
