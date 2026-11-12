/**
 * Display helpers for the public store page. Pure functions, unit-tested.
 * The store's email address is deliberately not part of anything here.
 */

const key = (part: string) => part.toLocaleLowerCase("az-AZ").replace(/[\s.]+/g, " ").trim();

/**
 * Joins the street address and the city once. Repeated parts are removed case-insensitively,
 * so "Qazax" + "Qazax" becomes "Qazax" and "Nizami küç. 5, Bakı" + "Bakı" stays "Nizami küç. 5, Bakı".
 */
export function formatStoreAddress(address: string | null | undefined, cityName: string | null | undefined): string | null {
  const parts = (address ?? "").split(",").map((part) => part.replace(/\s+/g, " ").trim()).filter(Boolean);
  const city = (cityName ?? "").replace(/\s+/g, " ").trim();
  if (city) parts.push(city);
  const seen = new Set<string>();
  const unique = parts.filter((part) => {
    const id = key(part);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return unique.length ? unique.join(", ") : null;
}

/** Only absolute http(s) links without credentials may be rendered as a public map link. */
export function safePublicMapUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function openStreetMapUrl(latitude: number | null | undefined, longitude: number | null | undefined): string | null {
  if (typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`;
}
