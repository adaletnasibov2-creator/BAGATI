import { prisma } from "@/lib/prisma";
import { SITE_SETTINGS_DEFAULTS } from "@/lib/site-content";
import { createFailSafeLoader } from "@/lib/fail-safe-cache";

/** Public pages may show a site-settings change up to this long after it was saved in another process. */
export const SITE_SETTINGS_CACHE_TTL_MS = 30_000;

const loader = createFailSafeLoader({
  label: "site-settings",
  ttlMs: SITE_SETTINGS_CACHE_TTL_MS,
  load: async () => (await prisma.siteSettings.findUnique({ where: { id: SITE_SETTINGS_DEFAULTS.id } })) ?? SITE_SETTINGS_DEFAULTS,
  fallback: () => SITE_SETTINGS_DEFAULTS,
});

/**
 * Site settings for public pages (root metadata, customer layout, contact, product pages).
 * Cached for 30 seconds and never throws: on a database error it serves the last good value, then the defaults.
 * Admin screens read the row directly so they always show the stored state.
 */
export function getSiteSettings() {
  return loader.get();
}

/** Called after an admin save so this process shows the new values at once. */
export function invalidateSiteSettingsCache() {
  loader.invalidate();
}
