/**
 * Single rule for "which city is the shopper looking at", shared by the server-rendered
 * homepage and the client city selector so both always agree.
 *
 * 1. The requested slug, if it names an active city.
 * 2. Otherwise the marketplace default city (Qazax), if active.
 * 3. Otherwise the first active city by name.
 * 4. null only when there are no active cities at all.
 */
export const DEFAULT_CITY_SLUG = "qazax";

export type CityOption = { id: string; name: string; slug: string };

export function resolveActiveCity<T extends CityOption>(activeCities: readonly T[], requestedSlug?: string | null): T | null {
  const requested = requestedSlug?.trim().toLowerCase();
  if (requested) {
    const match = activeCities.find((city) => city.slug === requested);
    if (match) return match;
  }
  return activeCities.find((city) => city.slug === DEFAULT_CITY_SLUG)
    ?? [...activeCities].sort((a, b) => a.name.localeCompare(b.name, "az"))[0]
    ?? null;
}
