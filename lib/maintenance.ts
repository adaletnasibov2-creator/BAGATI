/**
 * Maintenance mode (settings maintenance.enabled / maintenance.message): which paths stay reachable, and the 503
 * responses for everything else. Pure and Edge-safe (used by middleware.ts); unit-tested.
 *
 * Reachable while maintenance is on:
 *  - /admin and /admin/* (includes the admin login page), /api/admin and /api/admin/* (admin login, 2FA, all admin APIs)
 *  - /api/payments/* (Epoint callback, initiate, reconcile)
 *  - /api/ready, /api/health (deployment and uptime checks)
 *  - /api/maintenance-state (middleware reads the state from it)
 *  - /api/auth/logout (so an admin can sign out; it only ends a session)
 *  - /api/security/ingest/* (Cloudflare security events keep arriving)
 *  - /_next/* and static files (anything whose last path segment has a file extension, e.g. /favicon.ico, /uploads/x.webp)
 * Everything else (customer and seller pages, their APIs, customer/seller login and registration) gets 503.
 */
export const MAINTENANCE_RETRY_AFTER_SECONDS = 600;

const EXACT = new Set(["/admin", "/api/admin", "/api/ready", "/api/health", "/api/maintenance-state", "/api/auth/logout"]);
const PREFIXES = ["/admin/", "/api/admin/", "/api/payments/", "/api/security/ingest/", "/_next/"];
/** Static asset types only (a dotted dynamic path such as /products/a.b stays blocked). */
const STATIC_FILE = /^[^/]+\.(?:js|mjs|css|map|png|jpe?g|webp|avif|gif|svg|ico|woff2?|ttf|otf|txt|xml|json|webmanifest)$/i;

export function isMaintenanceExempt(pathname: string): boolean {
  if (EXACT.has(pathname)) return true;
  if (PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  return STATIC_FILE.test(last);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Friendly Azerbaijani page; the message is escaped (it is an admin setting, still never trusted as HTML). */
export function maintenanceHtml(message: string): string {
  return `<!doctype html>
<html lang="az"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Texniki işlər · BAGATI</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f3ee;color:#0d1b2a;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:32rem;margin:1rem;padding:2rem;border:1px solid #e7e3d9;border-radius:1rem;background:#fff;text-align:center}h1{margin:.5rem 0 0;font-size:1.5rem}p{line-height:1.6;color:#475569}.mark{display:inline-grid;place-items:center;width:3rem;height:3rem;border-radius:.75rem;background:#173c40;color:#fff;font-weight:700}</style>
</head><body><main><span class="mark" aria-hidden="true">B</span><h1>Texniki işlər aparılır</h1><p>${escapeHtml(message)}</p><p>Bir azdan yenidən cəhd edin.</p></main></body></html>`;
}

/** 503 for a blocked request: JSON for /api/*, the HTML page otherwise. Retry-After and no caching. */
export function maintenanceResponse(pathname: string, message: string): Response {
  const headers = { "Retry-After": String(MAINTENANCE_RETRY_AFTER_SECONDS), "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return Response.json({ error: message, code: "MAINTENANCE" }, { status: 503, headers });
  }
  return new Response(maintenanceHtml(message), { status: 503, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}
