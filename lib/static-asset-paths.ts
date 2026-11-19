/**
 * Static files that never need the middleware (SCALE-FIX-1 A2). middleware.ts has a matcher that skips them, and
 * personalizedDocument() also checks this list, so a signed-in visitor's static files are never marked
 * `private, no-store` even if the matcher changes. Before, every static file of a signed-in visitor got
 * `private, no-store` + `Vary: Cookie` (SCALE-1 report 7c), so browsers and Cloudflare re-downloaded them on every view.
 *
 * Kept in middleware for every other path: canonical-host redirect, maintenance mode, CSRF, the pathname header and
 * the personalised Cache-Control. robots.txt and sitemap.xml stay in middleware (host redirect applies to them).
 */
const STATIC_PREFIXES = ["/_next/static/", "/_next/image", "/images/", "/uploads/"];
const STATIC_FILES = new Set(["/icon.svg", "/bagati-mark.svg", "/favicon.ico", "/manifest.webmanifest"]);
const FONT_FILE = /\.(?:woff2?|ttf|otf)$/i;

export function isStaticAssetPath(pathname: string): boolean {
  if (STATIC_FILES.has(pathname)) return true;
  if (pathname.startsWith("/apple-icon")) return true;
  if (STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  return FONT_FILE.test(pathname);
}

/**
 * Browser and CDN cache for public static files whose names do not change when the content changes (so no
 * `immutable`): one day fresh, then served while revalidating for up to a week.
 */
export const STATIC_ASSET_CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";
