/**
 * PERF-1: guest-only Cloudflare edge-cache header (pure tests + a loopback HTTP server for the status guard; no database).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, ServerResponse, type IncomingMessage } from "node:http";
import { join } from "node:path";
import test from "node:test";
import {
  EDGE_CACHE_HEADER, EDGE_CACHE_VALUE, hasBagatiCookie, isEdgeCacheablePath, isEdgeCacheEnabled, shouldAddEdgeCacheHeader,
} from "../lib/edge-cache";
import { installEdgeCacheStatusGuard, keepsEdgeCacheHeader, withoutEdgeCacheHeader } from "../lib/edge-cache-status-guard";
import { maintenanceHeaders } from "../lib/maintenance";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

function req(url: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  const parsed = new URL(url, "https://shopbagati.com");
  const headers = new Headers(init.headers ?? {});
  return { method: init.method ?? "GET", pathname: parsed.pathname, searchParams: parsed.searchParams, headers };
}
const on = {};
const decide = (url: string, init?: { method?: string; headers?: Record<string, string> }, env: { PUBLIC_EDGE_CACHE?: string } = on) => shouldAddEdgeCacheHeader(req(url, init), env);

// ---------------------------------------------------------------------------------------------------------------
// Header value

test("header: Cloudflare-only name and the approved 60 s + 60 s value", () => {
  assert.equal(EDGE_CACHE_HEADER, "Cloudflare-CDN-Cache-Control");
  assert.equal(EDGE_CACHE_VALUE, "public, max-age=60, stale-while-revalidate=60");
});

// ---------------------------------------------------------------------------------------------------------------
// Paths

test("paths: the approved allow list gets the header for a guest", () => {
  for (const path of [
    "/products/cmabc123xyz", "/stores/cmstore123", "/stores/aysel-butik", "/categories", "/new-products", "/deals",
    "/about", "/contact", "/help", "/terms", "/privacy", "/delivery-returns", "/seller-terms",
  ]) assert.equal(decide(path), true, path);
});

test("paths: home and the products list are left out (they stream 200 before the page is done; owner decision)", () => {
  for (const url of ["/", "/products", "/?city=baki", "/products?city=baki", "/products?cursor=abc&category=geyim"]) assert.equal(decide(url), false, url);
});

test("paths: everything else never gets it", () => {
  for (const path of [
    "/", "/products",
    "/stores", "/stores/map", "/stores/", "/products/", "/categories/", "/deals/",
    "/products/abc/anything", "/products/abc/", "/stores/abc/products", "/stores/abc/map",
    "/PRODUCTS", "/Products/abc", "/Deals", "/STORES/abc",
    "/products/%2e%2e", "/products/abc%2Fdef", "/products/a.b", "/products/..", "/products/ab%20c", "/stores/%C9%99",
    "/products/" + "a".repeat(101),
    "/admin", "/admin/products", "/vendor", "/vendor/abc", "/account", "/account/orders", "/orders", "/orders/abc",
    "/cart", "/checkout", "/checkout/success", "/favorites", "/login", "/register", "/auth/google/link",
    "/verify-email", "/forgot-password", "/reset-password", "/storefront-preview", "/storefront-preview/categories",
    "/api/products", "/api/products/abc", "/api/stores", "/api/health", "/api/maintenance-state",
    "/robots.txt", "/sitemap.xml", "/icon.svg", "/images/home/hero.webp", "/uploads/x.webp", "/_next/static/chunks/a.js",
    "/favicon.ico", "/manifest.webmanifest", "/does-not-exist", "//products", "/products//abc",
  ]) assert.equal(isEdgeCacheablePath(path), false, path);
});

// ---------------------------------------------------------------------------------------------------------------
// Query

test("query: ?q= (search, even empty) and ?_rsc= never; ?city= and other filters are allowed", () => {
  assert.equal(decide("/products?q=telefon"), false);
  assert.equal(decide("/products?q="), false);
  assert.equal(decide("/products?city=baki&q=x"), false);
  assert.equal(decide("/stores/abc?q=köynək"), false);
  assert.equal(decide("/categories?q=1"), false);
  assert.equal(decide("/products/abc?_rsc=1x2y"), false);
  assert.equal(decide("/categories?city=baki"), true);
  assert.equal(decide("/new-products?city=baki"), true);
  assert.equal(decide("/categories?city=baki&category=geyim"), true);
  assert.equal(decide("/products/abc?city=baki"), true);
  assert.equal(decide("/deals?campaign=x&city=gence"), true);
  assert.equal(decide("/stores/abc?category=geyim&page=2&sort=newest"), true);
  assert.equal(decide("/deals?Q=x"), true, "only the exact lowercase q is the search parameter, as in the pages");
});

// ---------------------------------------------------------------------------------------------------------------
// Method

test("method: GET and HEAD only", () => {
  assert.equal(decide("/deals", { method: "GET" }), true);
  assert.equal(decide("/deals", { method: "HEAD" }), true);
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "get"]) assert.equal(decide("/deals", { method }), false, method);
});

// ---------------------------------------------------------------------------------------------------------------
// Cookies

test("cookies: any cookie whose name starts with bagati_ blocks it (raw header, any position, any case)", () => {
  for (const cookie of [
    "bagati_session=abc", "bagati_google_oauth=x", "bagati_admin_2fa=1", "bagati_google_link=1", "bagati_google_link_next=/x",
    "bagati_email_verification=1", "bagati_future_cookie=1", "theme=dark; bagati_session=abc", "a=1;bagati_x=2", "  bagati_session=1",
    "BAGATI_SESSION=1", "Bagati_x=1", "bagati_=1", "bagati_session", "_ga=1; cf_clearance=2; bagati_google_oauth=3",
  ]) {
    assert.equal(hasBagatiCookie(cookie), true, cookie);
    assert.equal(decide("/deals", { headers: { cookie } }), false, cookie);
  }
});

test("cookies: other cookies (analytics, Cloudflare) do not block it; a value containing bagati_ is not a name", () => {
  for (const cookie of ["", "_ga=GA1.2.3", "cf_clearance=x; __cf_bm=y", "theme=bagati_dark", "x=1; y=bagati_session", "notbagati_session=1"]) {
    assert.equal(hasBagatiCookie(cookie), false, cookie);
  }
  assert.equal(hasBagatiCookie(null), false);
  assert.equal(hasBagatiCookie(undefined), false);
  assert.equal(decide("/products/abc", { headers: { cookie: "_ga=GA1.2.3; cf_clearance=x" } }), true);
});

// ---------------------------------------------------------------------------------------------------------------
// Client navigation (RSC) and other headers

test("headers: Next.js client navigation / prefetch (RSC) and Authorization never get it", () => {
  for (const name of ["RSC", "Next-Router-Prefetch", "Next-Router-State-Tree", "Next-Router-Segment-Prefetch", "Next-Action", "Authorization"]) {
    assert.equal(decide("/products/abc", { headers: { [name]: "1" } }), false, name);
  }
  assert.equal(decide("/products/abc", { headers: { accept: "text/html", "user-agent": "Mozilla/5.0", "accept-language": "az" } }), true);
});

// ---------------------------------------------------------------------------------------------------------------
// Off switch

test("off switch: PUBLIC_EDGE_CACHE=off (any case, spaces) disables it; anything else or unset = on", () => {
  for (const value of ["off", "OFF", " Off "]) {
    assert.equal(isEdgeCacheEnabled({ PUBLIC_EDGE_CACHE: value }), false, value);
    assert.equal(decide("/deals", undefined, { PUBLIC_EDGE_CACHE: value }), false, value);
  }
  for (const value of [undefined, "", "on", "1", "true", "false"]) assert.equal(isEdgeCacheEnabled({ PUBLIC_EDGE_CACHE: value }), true, String(value));
});

// ---------------------------------------------------------------------------------------------------------------
// Middleware wiring

test("middleware: header set after the private/no-store branch (unchanged), from the pure decision, never on the 503", () => {
  const source = read("middleware.ts").replace(/\r\n/g, "\n");
  assert.match(source, /import \{ EDGE_CACHE_HEADER, EDGE_CACHE_VALUE, shouldAddEdgeCacheHeader \} from "@\/lib\/edge-cache";/);
  const tail = source.slice(source.indexOf("const response = NextResponse.next("));
  assert.match(tail, /if \(personalizedDocument\(pathname, request\.cookies\.has\("bagati_session"\)\)\) \{\n\s+response\.headers\.set\("Cache-Control", "private, no-store"\);\n\s+response\.headers\.set\("Vary", "Cookie"\);\n\s+\}/, "signed-in behaviour unchanged");
  assert.match(tail, /if \(shouldAddEdgeCacheHeader\(\{ method: request\.method, pathname, searchParams: request\.nextUrl\.searchParams, headers: request\.headers \}, \{ PUBLIC_EDGE_CACHE: process\.env\.PUBLIC_EDGE_CACHE \}\)\) \{\n\s+response\.headers\.set\(EDGE_CACHE_HEADER, EDGE_CACHE_VALUE\);\n\s+\}\n\s+return response;/);
  assert.equal(source.match(/EDGE_CACHE_HEADER/g)?.length, 2, "set in exactly one place");
  // The maintenance 503 returns before the response is built, so it can never get the header.
  assert.ok(source.indexOf("return maintenanceResponse(") < source.indexOf("shouldAddEdgeCacheHeader({"));
  assert.doesNotMatch(source, /Cache-Control", "public/, "the browser's Cache-Control is never made public");
});

test("instrumentation: the status guard is installed in the Node runtime, outside the build, before the other start-up work", () => {
  const source = read("instrumentation.ts").replace(/\r\n/g, "\n");
  assert.match(source, /if \(process\.env\.NEXT_RUNTIME === "nodejs"\) \{\n\s+if \(process\.env\.NEXT_PHASE !== "phase-production-build"\) \{\n(?:\s+\/\/.*\n)+\s+try \{\n\s+const \{ installEdgeCacheStatusGuard \} = await import\("\.\/lib\/edge-cache-status-guard"\);\n\s+installEdgeCacheStatusGuard\(\);/);
  assert.doesNotMatch(source, /^import /m, "nothing at the top level (keeps node:http out of the Edge bundle)");
});

// ---------------------------------------------------------------------------------------------------------------
// Maintenance 503 unchanged

test("maintenance 503 headers are unchanged (no-store for browsers and for Cloudflare)", () => {
  assert.deepEqual(maintenanceHeaders(), {
    "Retry-After": "600",
    "Cache-Control": "no-store",
    "CDN-Cache-Control": "no-store",
    "Cloudflare-CDN-Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Status guard (real loopback HTTP server)

test("guard: removes the header from explicit writeHead header arguments (object, pairs, flat raw)", () => {
  const v = EDGE_CACHE_VALUE;
  assert.deepEqual(withoutEdgeCacheHeader({ "Cloudflare-CDN-Cache-Control": v, "Content-Type": "text/html" }), { "Content-Type": "text/html" });
  assert.deepEqual(withoutEdgeCacheHeader({ "cloudflare-cdn-cache-control": v }), {});
  assert.deepEqual(withoutEdgeCacheHeader([["Cloudflare-CDN-Cache-Control", v], ["A", "1"]]), [["A", "1"]]);
  assert.deepEqual(withoutEdgeCacheHeader(["CLOUDFLARE-CDN-CACHE-CONTROL", v, "A", "1"]), ["A", "1"]);
  // Any other value of the header (the maintenance 503's "no-store") is never touched.
  assert.deepEqual(withoutEdgeCacheHeader({ "Cloudflare-CDN-Cache-Control": "no-store" }), { "Cloudflare-CDN-Cache-Control": "no-store" });
  assert.deepEqual(withoutEdgeCacheHeader(["Cloudflare-CDN-Cache-Control", "no-store"]), ["Cloudflare-CDN-Cache-Control", "no-store"]);
  assert.equal(withoutEdgeCacheHeader(undefined), undefined);
});

test("guard: keeps the header only on a 200 HTML page that is not a client-navigation (RSC) request", () => {
  assert.equal(keepsEdgeCacheHeader(200, "text/html; charset=utf-8", { headers: {}, url: "/deals" }), true);
  assert.equal(keepsEdgeCacheHeader(200, "text/html", { headers: {}, url: "/deals?city=baki" }), true);
  assert.equal(keepsEdgeCacheHeader(200, "TEXT/HTML", undefined), true);
  for (const status of [201, 204, 206, 301, 302, 304, 307, 308, 404, 410, 500, 502, 503, "200"]) assert.equal(keepsEdgeCacheHeader(status, "text/html", { headers: {} }), false, String(status));
  for (const type of [undefined, "", "text/x-component", "application/json", "text/plain", "text/htmlx", "application/xhtml+xml"]) assert.equal(keepsEdgeCacheHeader(200, type, { headers: {} }), false, String(type));
  for (const name of ["rsc", "next-router-prefetch", "next-router-state-tree", "next-router-segment-prefetch"]) assert.equal(keepsEdgeCacheHeader(200, "text/html", { headers: { [name]: "1" } }), false, name);
  assert.equal(keepsEdgeCacheHeader(200, "text/html", { headers: {}, url: "/deals?_rsc=abc" }), false);
  assert.equal(keepsEdgeCacheHeader(200, "text/html", { headers: {}, url: "/deals?city=x&_rsc=abc" }), false);
});

test("guard: only a 200 HTML response keeps the header; 404, 500, 3xx, 503, RSC data and RSC requests lose it", async () => {
  // A private copy of the prototype chain, so the global ServerResponse of the test process stays untouched.
  class GuardedResponse extends ServerResponse {}
  assert.equal(installEdgeCacheStatusGuard(GuardedResponse.prototype), true);
  assert.equal(installEdgeCacheStatusGuard(GuardedResponse.prototype), false, "installs once");
  const server = createServer({ ServerResponse: GuardedResponse as typeof ServerResponse }, (request: IncomingMessage, response) => {
    const url = new URL(request.url ?? "/", "http://x");
    const status = Number(url.searchParams.get("status"));
    if (url.searchParams.get("mode") === "maintenance") {
      // Like lib/maintenance.ts: the 503's own no-store copies must survive the guard unchanged.
      for (const [name, value] of Object.entries(maintenanceHeaders())) response.setHeader(name, value);
      response.statusCode = 503;
    } else if (url.searchParams.get("mode") === "explicit") {
      response.writeHead(status, { [EDGE_CACHE_HEADER]: EDGE_CACHE_VALUE, "Content-Type": url.searchParams.get("type") ?? "text/html; charset=utf-8" });
    } else {
      response.setHeader(EDGE_CACHE_HEADER, EDGE_CACHE_VALUE);
      response.setHeader("Content-Type", url.searchParams.get("type") ?? "text/html; charset=utf-8");
      response.statusCode = status;
      if (status >= 300 && status < 400) response.setHeader("Location", "/elsewhere");
    }
    response.write("chunk ");
    response.end("done");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  try {
    for (const mode of ["implicit", "explicit"]) {
      for (const status of [200, 404, 500, 503, 301, 302, 307, 308, 204, 206, 410]) {
        const response = await fetch(`http://127.0.0.1:${port}/?mode=${mode}&status=${status}`, { redirect: "manual" });
        await response.arrayBuffer().catch(() => undefined);
        assert.equal(response.status, status);
        assert.equal(response.headers.get(EDGE_CACHE_HEADER), status === 200 ? EDGE_CACHE_VALUE : null, `${mode} ${status}`);
      }
    }
    for (const mode of ["implicit", "explicit"]) {
      // Next's client-navigation data (same URL, RSC payload) must never be stored as the page.
      const flight = await fetch(`http://127.0.0.1:${port}/?mode=${mode}&status=200&type=text%2Fx-component`);
      await flight.arrayBuffer();
      assert.equal(flight.headers.get(EDGE_CACHE_HEADER), null, `${mode} text/x-component`);
      const rscRequest = await fetch(`http://127.0.0.1:${port}/?mode=${mode}&status=200`, { headers: { RSC: "1" } });
      await rscRequest.arrayBuffer();
      assert.equal(rscRequest.headers.get(EDGE_CACHE_HEADER), null, `${mode} RSC request header`);
      const rscParam = await fetch(`http://127.0.0.1:${port}/?mode=${mode}&status=200&_rsc=abc`);
      await rscParam.arrayBuffer();
      assert.equal(rscParam.headers.get(EDGE_CACHE_HEADER), null, `${mode} _rsc parameter`);
    }
    const maintenance = await fetch(`http://127.0.0.1:${port}/?mode=maintenance&status=503`);
    await maintenance.arrayBuffer();
    assert.equal(maintenance.status, 503);
    assert.equal(maintenance.headers.get(EDGE_CACHE_HEADER), "no-store", "maintenance 503 keeps its own Cloudflare no-store");
    assert.equal(maintenance.headers.get("cdn-cache-control"), "no-store");
    assert.equal(maintenance.headers.get("cache-control"), "no-store");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
