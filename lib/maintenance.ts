/**
 * Maintenance mode (settings maintenance.enabled / maintenance.message): which paths stay reachable, and the 503
 * responses for everything else. Pure and Edge-safe (used by middleware.ts); unit-tested.
 *
 * Reachable while maintenance is on (explicit list, MAINTENANCE-PAGE):
 *  - /admin and /admin/* (includes the admin login page), /api/admin and /api/admin/* (admin login, 2FA, all admin APIs)
 *  - /api/payments/epoint/callback (Epoint's server-to-server result) and /api/payments/epoint/reconcile (the customer's
 *    "check my payment" after returning from Epoint): both only settle money that was already paid. Starting a NEW
 *    payment (/api/payments/epoint/initiate) is blocked while the shop is closed (until MAINTENANCE-PAGE the whole
 *    /api/payments/ prefix was open).
 *  - /api/ready, /api/health (deployment and uptime checks)
 *  - /api/maintenance-state and /api/maintenance-state/viewer (middleware reads the state and the admin preview from them)
 *  - /api/auth/logout (so an admin can sign out; it only ends a session)
 *  - /api/security/ingest/* (Cloudflare security events keep arriving)
 *  - /_next/* and static files (anything whose last path segment has a static file extension, e.g. /favicon.ico,
 *    /uploads/x.webp, /robots.txt, /sitemap.xml, /fonts/fraunces-variable-az.woff2)
 * Everything else (customer and seller pages, their APIs, customer/seller login and registration) gets 503, except that
 * a signed-in admin still sees the public PAGES (preview, lib/maintenance-preview.ts); APIs stay blocked for everyone.
 *
 * The page is a self-contained HTML string: no database, no React, no JavaScript, so it still works when the database
 * is what is being maintained. It shows only the owner-approved texts below (the admin's maintenance.message setting
 * is still returned as the API error text, which the existing client code already shows).
 */
export const MAINTENANCE_RETRY_AFTER_SECONDS = 600;

/** Owner-approved texts (MAINTENANCE-PAGE). Nothing else is visible on the page besides the brand name. */
export const MAINTENANCE_PAGE_TEXT = {
  title: "Sayt qısa müddətə texniki xidmətdədir",
  body: "Daha yaxşı xidmət üçün yeniləmələr aparırıq. Tezliklə yenidən buradayıq.",
  footnote: "Anlayışınıza görə təşəkkür edirik.",
} as const;

/**
 * Fraunces for the heading, served from public/ under a fixed address (the next/font copy has a build hash the Edge
 * middleware cannot know). Font files skip the middleware (config.matcher), so it loads while the site is closed.
 * scripts/maintenance-page.test.ts keeps this file byte-identical to app/fonts/fraunces-variable-az.woff2.
 */
export const MAINTENANCE_FONT_PATH = "/fonts/fraunces-variable-az.woff2";

/**
 * Headers of every maintenance 503. no-store also for shared caches: CDN-Cache-Control and Cloudflare-CDN-Cache-Control
 * tell Cloudflare not to keep it even under a "cache everything" rule, so the normal site is back as soon as the
 * setting is switched off.
 */
export function maintenanceHeaders(): Record<string, string> {
  return {
    "Retry-After": String(MAINTENANCE_RETRY_AFTER_SECONDS),
    "Cache-Control": "no-store",
    "CDN-Cache-Control": "no-store",
    "Cloudflare-CDN-Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
  };
}

const EXACT = new Set([
  "/admin", "/api/admin", "/api/ready", "/api/health", "/api/maintenance-state", "/api/maintenance-state/viewer", "/api/auth/logout",
  "/api/payments/epoint/callback", "/api/payments/epoint/reconcile",
]);
const PREFIXES = ["/admin/", "/api/admin/", "/api/security/ingest/", "/_next/"];
/** Static asset types only (a dotted dynamic path such as /products/a.b stays blocked). */
const STATIC_FILE = /^[^/]+\.(?:js|mjs|css|map|png|jpe?g|webp|avif|gif|svg|ico|woff2?|ttf|otf|txt|xml|json|webmanifest)$/i;

export function isMaintenanceExempt(pathname: string): boolean {
  if (EXACT.has(pathname)) return true;
  if (PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  return STATIC_FILE.test(last);
}

// Colours are the public design tokens (app/globals.css): page #f7f8f6, deep teal #173a3a, primary #174746,
// text-secondary #566b65 (6.1:1 on the page), brand-50 #f1f6f4, brand-100 #e1ece8, border #e5eae6, gold #c79a52.
const STYLE = [
  `@font-face{font-family:"Fraunces";src:url(${MAINTENANCE_FONT_PATH}) format("woff2");font-weight:400 700;font-style:normal;font-display:optional}`,
  "*,*::before,*::after{box-sizing:border-box}",
  "html{-webkit-text-size-adjust:100%;text-size-adjust:100%}",
  "body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:3rem 1rem;background:#f7f8f6;color:#173a3a;font-family:ui-sans-serif,system-ui,-apple-system,\"Segoe UI\",Roboto,Arial,sans-serif;font-size:1rem;line-height:1.5}",
  "main{width:100%;max-width:30rem;text-align:center}",
  ".brand{display:inline-flex;align-items:center;gap:.625rem;color:#173a3a;font-family:Fraunces,Georgia,\"Times New Roman\",serif;font-size:1.375rem;font-weight:600;letter-spacing:.2em}",
  ".brand img{display:block;width:30px;height:42px}",
  ".card{margin-top:2rem;padding:2.5rem 1.5rem 2rem;border:1px solid #e5eae6;border-top:3px solid #c79a52;border-radius:1.25rem;background:#fff;box-shadow:0 24px 70px rgba(11,23,38,.08)}",
  ".icon{margin:0 auto;display:grid;place-items:center;width:4rem;height:4rem;border-radius:9999px;background:#f1f6f4;color:#174746;box-shadow:inset 0 0 0 1px #e1ece8}",
  ".icon svg{width:28px;height:28px}",
  "h1{margin:1.25rem 0 0;font-family:Fraunces,Georgia,\"Times New Roman\",serif;font-size:clamp(1.75rem,1.55rem + .8vw,2.125rem);font-weight:600;line-height:1.2;letter-spacing:-.015em;color:#173a3a;text-wrap:balance}",
  ".body{margin:.875rem 0 0;font-size:1rem;line-height:1.75;color:#566b65}",
  ".note{margin:1.75rem 0 0;padding-top:1.25rem;border-top:1px solid #e5eae6;font-size:.9375rem;line-height:1.6;color:#566b65}",
  "@media (min-width:640px){.card{padding:3rem 2.5rem 2.25rem}}",
  "@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}",
].join("");

// Wrench icon (lucide-react "Wrench", ISC licence; the same icon set as the rest of the site), decorative.
const WRENCH = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';

/**
 * The designed maintenance page (MAINTENANCE-PAGE). Static: the same bytes for every request, no database, no script,
 * no canonical, no Open Graph, no personal data. One <main> with one <h1>; the brand mark loads from /bagati-mark.svg
 * (a static file that skips the middleware) with fixed width and height, so nothing shifts.
 */
export function maintenanceHtml(): string {
  const { title, body, footnote } = MAINTENANCE_PAGE_TEXT;
  return `<!doctype html>
<html lang="az"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><meta name="color-scheme" content="light">
<title>${title} · BAGATI</title>
<link rel="preload" href="${MAINTENANCE_FONT_PATH}" as="font" type="font/woff2" crossorigin>
<style>${STYLE}</style>
</head><body><main data-maintenance-page=""><span class="brand"><img src="/bagati-mark.svg" width="30" height="42" alt="">BAGATI</span><div class="card"><span class="icon">${WRENCH}</span><h1>${title}</h1><p class="body">${body}</p><p class="note">${footnote}</p></div></main></body></html>`;
}

/**
 * 503 for a blocked request: JSON for /api/* (the existing shape { error, code: "MAINTENANCE" }, error = the admin's
 * maintenance message, which client code shows as it shows any API error), the designed HTML page otherwise.
 */
export function maintenanceResponse(pathname: string, message: string): Response {
  const headers = maintenanceHeaders();
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return Response.json({ error: message, code: "MAINTENANCE" }, { status: 503, headers });
  }
  return new Response(maintenanceHtml(), { status: 503, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}
