import { NextRequest, NextResponse } from "next/server";
import { csrfRejection, isCsrfExemptApiPath } from "@/lib/csrf";
import { canonicalHostRedirectUrl } from "@/lib/host-policy";
import { ADMIN_X_ROBOTS_TAG, isAdminSurface } from "@/lib/admin-surface";
import { isMaintenanceExempt, maintenanceResponse } from "@/lib/maintenance";
import { encodeMaintenanceCheck, lastMaintenanceCheck, MAINTENANCE_CHECK_HEADER, maintenanceState } from "@/lib/maintenance-state";
import { maintenanceStateOrigin } from "@/lib/maintenance-origin";
import { isAdminPreview } from "@/lib/maintenance-preview";
import { isStaticAssetPath } from "@/lib/static-asset-paths";
import { EDGE_CACHE_HEADER, EDGE_CACHE_VALUE, shouldAddEdgeCacheHeader } from "@/lib/edge-cache";
import { isPersonalApiPath, PERSONAL_API_CACHE_CONTROL } from "@/lib/personal-api-cache";

export async function middleware(request: NextRequest) {
  const canonical = canonicalHostRedirectUrl(request.url, request.headers.get("host"));
  if (canonical) return NextResponse.redirect(canonical, 308);
  const { pathname } = request.nextUrl;
  // Maintenance mode (lib/maintenance.ts): customer and seller pages and APIs get 503 (designed static page / JSON); the
  // admin panel, the Epoint callback and payment check, health/readiness and static files stay reachable. The state is
  // cached 10 s while open and 1 s while closed (lib/maintenance-state.ts), and fails open.
  if (!isMaintenanceExempt(pathname)) {
    // BAGATI_INTERNAL_ORIGIN (Node port, e.g. http://127.0.0.1:3000) when set and valid: behind the proxy the request
    // origin is "https://localhost:<port>", which cannot be fetched (lib/maintenance-origin.ts).
    const { origin, source } = maintenanceStateOrigin(request.nextUrl.origin, process.env.BAGATI_INTERNAL_ORIGIN);
    const maintenance = await maintenanceState(origin, undefined, undefined, { source });
    // A signed-in admin previews the public pages (never the APIs). Checked only when maintenance is on and a session
    // cookie is present; any failure shows the maintenance page.
    const isApi = pathname === "/api" || pathname.startsWith("/api/");
    const session = request.cookies.get("bagati_session")?.value;
    if (maintenance.enabled && (isApi || !(await isAdminPreview(session, origin)))) return maintenanceResponse(pathname, maintenance.message);
  }
  const adminSurface = isAdminSurface(pathname);
  if (pathname.startsWith("/api/") && !isCsrfExemptApiPath(pathname)) {
    const rejected = csrfRejection(request);
    if (rejected) {
      if (adminSurface) rejected.headers.set("X-Robots-Tag", ADMIN_X_ROBOTS_TAG);
      return rejected;
    }
  }
  // Pathname only (never the query string) for the not-found page's Security Center telemetry. Always overwritten,
  // so a client cannot supply its own value.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-bagati-pathname", pathname.slice(0, 300));
  // Admin pages get the result of the middleware's own maintenance check (shown in "Texniki iş"); never client-supplied.
  requestHeaders.delete(MAINTENANCE_CHECK_HEADER);
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const { origin, source } = maintenanceStateOrigin(request.nextUrl.origin, process.env.BAGATI_INTERNAL_ORIGIN);
    await maintenanceState(origin, undefined, undefined, { source });
    const check = lastMaintenanceCheck();
    if (check) requestHeaders.set(MAINTENANCE_CHECK_HEADER, encodeMaintenanceCheck(check));
  }
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  // Header (not robots.txt): noindex without advertising the admin path.
  if (adminSurface) response.headers.set("X-Robots-Tag", ADMIN_X_ROBOTS_TAG);
  if (personalizedDocument(pathname, request.cookies.has("bagati_session"))) {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Vary", "Cookie");
  }
  // SECURITY-AUDIT-1: personal JSON (cart, orders, account, seller panel APIs) is never stored by a shared cache.
  if (isPersonalApiPath(pathname)) response.headers.set("Cache-Control", PERSONAL_API_CACHE_CONTROL);
  // PERF-1: guest-only Cloudflare edge cache (60 s + 60 s stale) for allow-listed public pages; the browser's
  // Cache-Control is unchanged. Never reached by the maintenance 503 (returned above). A non-200 response loses the
  // header when its status is written (lib/edge-cache-status-guard.ts). Off: PUBLIC_EDGE_CACHE=off.
  if (shouldAddEdgeCacheHeader({ method: request.method, pathname, searchParams: request.nextUrl.searchParams, headers: request.headers }, { PUBLIC_EDGE_CACHE: process.env.PUBLIC_EDGE_CACHE })) {
    response.headers.set(EDGE_CACHE_HEADER, EDGE_CACHE_VALUE);
  }
  return response;
}

function personalizedDocument(pathname: string, hasSession: boolean) {
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next/") || isStaticAssetPath(pathname)) return false;
  if (hasSession) return true;
  return ["/account", "/orders", "/vendor", "/admin", "/checkout", "/cart", "/login", "/register", "/favorites", "/auth"].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

// Static files skip the middleware entirely (SCALE-FIX-1 A2; the same list as lib/static-asset-paths.ts, which
// scripts/static-asset-caching.test.ts keeps in sync). Next needs this matcher as a literal. robots.txt and sitemap.xml
// still pass through, so the www -> apex redirect keeps applying to them.
export const config = {
  matcher: ["/((?!_next/static/|_next/image|images/|uploads/|icon\\.svg$|bagati-mark\\.svg$|favicon\\.ico$|manifest\\.webmanifest$|apple-icon|.*\\.(?:woff2?|ttf|otf)$).*)"],
};
