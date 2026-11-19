/**
 * Static files and the middleware (SCALE-FIX-1 A2): a matcher skips static files, personalizedDocument() never marks
 * them private/no-store (before: every static file of a signed-in visitor was `private, no-store` + `Vary: Cookie`),
 * and /images/*, /icon.svg and /bagati-mark.svg get a 1-day cache with stale-while-revalidate (before: max-age=0).
 * Every other path keeps the middleware: host redirect, maintenance, CSRF, pathname header, personalised headers.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { isStaticAssetPath, STATIC_ASSET_CACHE_CONTROL } from "../lib/static-asset-paths";

const skipped = [
  "/_next/static/chunks/main-abc123.js", "/_next/static/media/inter.woff2", "/_next/image",
  "/images/home/hero-home-desktop.webp", "/images/categories/geyim.webp", "/uploads/vendors/s1/logo.webp",
  "/icon.svg", "/bagati-mark.svg", "/favicon.ico", "/manifest.webmanifest", "/apple-icon.png", "/fonts/extra.woff2",
];
const kept = [
  "/", "/products", "/products/sp1", "/stores/scale-store-1", "/checkout", "/cart", "/account", "/admin", "/admin/login",
  "/vendor", "/login", "/api/products", "/api/orders", "/api/auth/login", "/api/payments/epoint/callback",
  "/robots.txt", "/sitemap.xml", "/imagesx", "/uploads-list", "/products/icon.svg-like",
];

async function matcherRegex() {
  const { config } = await import("../middleware");
  assert.equal(config.matcher.length, 1);
  return new RegExp(`^${config.matcher[0]}$`);
}

test("the middleware matcher skips static files and keeps every page and API", async () => {
  const matcher = await matcherRegex();
  for (const path of skipped) assert.equal(matcher.test(path), false, `skipped: ${path}`);
  for (const path of kept) assert.equal(matcher.test(path), true, `kept: ${path}`);
});

test("the matcher and isStaticAssetPath agree", async () => {
  const matcher = await matcherRegex();
  for (const path of [...skipped, ...kept]) assert.equal(isStaticAssetPath(path), !matcher.test(path), path);
});

test("a signed-in visitor's static file is not marked private/no-store; a signed-in page still is", async () => {
  const { middleware } = await import("../middleware");
  const withSession = (path: string) => new NextRequest(`https://shopbagati.com${path}`, { headers: { cookie: "bagati_session=test-only" } });
  for (const path of ["/images/home/hero-home-desktop.webp", "/bagati-mark.svg", "/uploads/vendors/s1/logo.webp"]) {
    const response = await middleware(withSession(path));
    assert.notEqual(response.headers.get("cache-control"), "private, no-store", path);
    assert.equal(response.headers.get("vary"), null, path);
  }
  // A page needs the maintenance state; with the state fetch failing it fails open (maintenance off).
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("offline in test"); }) as typeof fetch;
  try {
    const page = await middleware(withSession("/products"));
    assert.equal(page.headers.get("cache-control"), "private, no-store");
    assert.equal(page.headers.get("vary"), "Cookie");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("next.config: 1-day cache with stale-while-revalidate for /images, the icon and the logo; security headers kept", async () => {
  assert.equal(STATIC_ASSET_CACHE_CONTROL, "public, max-age=86400, stale-while-revalidate=604800");
  const { default: nextConfig } = await import("../next.config");
  const rules = await nextConfig.headers!();
  const rule = (source: string) => rules.find((entry) => entry.source === source);
  for (const source of ["/images/:path*", "/bagati-mark.svg", "/icon.svg"]) {
    const headers = rule(source)?.headers ?? [];
    assert.equal(headers.find((h) => h.key === "Cache-Control")?.value, STATIC_ASSET_CACHE_CONTROL, source);
    assert.ok(headers.some((h) => h.key === "X-Content-Type-Options"), `${source} keeps the security headers`);
  }
  assert.equal(rule("/uploads/:path*")?.headers.find((h) => h.key === "Cache-Control")?.value, "public, max-age=31536000, immutable");
  assert.ok(!rule("/:path*")?.headers.some((h) => h.key === "Cache-Control"), "pages get no static cache header");
});
