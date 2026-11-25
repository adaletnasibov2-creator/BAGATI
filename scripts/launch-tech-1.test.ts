/**
 * LAUNCH-TECH-1: pre-launch SEO basics and the default share image.
 *  - Private customer / seller / sign-in pages answer `X-Robots-Tag: noindex, nofollow` (admin keeps its own value).
 *  - robots.txt keeps the private areas disallowed and points to the sitemap; the sitemap stays bounded.
 *  - Default share image: a real 1200x630 PNG in public/, used for og:image / twitter:image on pages without their
 *    own image (root metadata); Organization.logo keeps the brand logo.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { isPrivateNoindexPath, PRIVATE_NOINDEX_PREFIXES, PRIVATE_X_ROBOTS_TAG } from "../lib/private-noindex";
import { ADMIN_X_ROBOTS_TAG } from "../lib/admin-surface";
import { BRAND_LOGO_IMAGE, DEFAULT_SHARE_IMAGE, shareImage } from "../lib/share-preview";
import { rootMetadata } from "../lib/seo";
import { homeJsonLd, robotsConfig, ROBOTS_DISALLOW } from "../lib/structured-data";
import { SITEMAP_MAX_URLS } from "../lib/sitemap";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const BASE = "https://shopbagati.com";

test("private pages: the prefix list, exact matching, and the header value", () => {
  assert.equal(PRIVATE_X_ROBOTS_TAG, "noindex, nofollow");
  for (const path of ["/cart", "/checkout", "/account", "/account/messages/c1", "/orders/o1", "/favorites", "/vendor", "/vendor/s1/orders", "/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/auth/google/link"]) {
    assert.equal(isPrivateNoindexPath(path), true, path);
  }
  for (const path of ["/", "/products", "/products/p1", "/stores/s1", "/categories", "/about", "/terms", "/cartoon", "/vendors", "/support"]) {
    assert.equal(isPrivateNoindexPath(path), false, path);
  }
  // Every robots.txt private area (except /api, which serves no pages) is also a noindex page prefix.
  for (const prefix of ROBOTS_DISALLOW.filter((p) => p !== "/api")) assert.ok((PRIVATE_NOINDEX_PREFIXES as readonly string[]).includes(prefix), prefix);
});

test("middleware: private pages get noindex, admin keeps its value, public pages get none", async () => {
  const { middleware } = await import("../middleware");
  const { resetMaintenanceStateCache } = await import("../lib/maintenance-state");
  resetMaintenanceStateCache();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ enabled: false, message: "x" })) as typeof fetch;
  try {
    const header = async (url: string) => (await middleware(new NextRequest(url))).headers.get("x-robots-tag");
    for (const path of ["/cart", "/checkout", "/account", "/orders", "/vendor/s1", "/login", "/register"]) assert.equal(await header(`http://localhost:3000${path}`), PRIVATE_X_ROBOTS_TAG, path);
    assert.equal(await header("http://localhost:3000/admin"), ADMIN_X_ROBOTS_TAG);
    for (const path of ["/", "/products", "/stores", "/about"]) assert.equal(await header(`http://localhost:3000${path}`), null, path);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("robots.txt: private areas disallowed, sitemap absolute; /admin is still not named (SEO-1 decision)", () => {
  const robots = robotsConfig(BASE);
  const disallow = (robots.rules as { disallow: string[] }).disallow;
  for (const path of ["/api", "/vendor", "/cart", "/checkout", "/account", "/orders"]) assert.ok(disallow.includes(path), path);
  assert.equal(disallow.includes("/admin"), false);
  assert.equal(robots.sitemap, `${BASE}/sitemap.xml`);
});

test("sitemap stays bounded: the product query takes at most the 50,000-URL room", () => {
  assert.equal(SITEMAP_MAX_URLS, 50_000);
  assert.match(read("lib/sitemap.ts"), /orderBy: \[\{ updatedAt: "desc" \}, \{ id: "asc" \}\],\n\s*take: limit,/);
});

test("default share image: an existing 1200x630 PNG in public/", () => {
  assert.deepEqual(DEFAULT_SHARE_IMAGE, { path: "/images/share/bagati-share-1200x630.png", width: 1200, height: 630 });
  const png = readFileSync(join(root, "public", DEFAULT_SHARE_IMAGE.path.slice(1)));
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(png.readUInt32BE(16), 1200, "IHDR width");
  assert.equal(png.readUInt32BE(20), 630, "IHDR height");
  assert.deepEqual(shareImage([], "BAGATI", BASE), { url: `${BASE}${DEFAULT_SHARE_IMAGE.path}`, width: 1200, height: 630, alt: "BAGATI" });
});

test("root metadata: with the default image every page has og:image and a large Twitter card; without it nothing changes", () => {
  const image = shareImage([], "BAGATI", BASE)!;
  const withImage = rootMetadata({ siteName: "BAGATI", logoUrl: null, description: "Təsvir", ogTitle: null, ogDescription: null, shareImage: image });
  assert.deepEqual(withImage.openGraph, { siteName: "BAGATI", type: "website", images: [image] });
  assert.deepEqual(withImage.twitter, { card: "summary_large_image", images: [image.url] });
  const admin = rootMetadata({ siteName: "BAGATI", logoUrl: null, description: "Təsvir", ogTitle: "Başlıq", ogDescription: "OG", shareImage: image });
  assert.deepEqual(admin.openGraph, { title: "Başlıq", description: "OG", siteName: "BAGATI", type: "website", images: [image] });
  const without = rootMetadata({ siteName: "BAGATI", logoUrl: null, description: "Təsvir", ogTitle: null, ogDescription: null });
  assert.equal("openGraph" in without, false);
  assert.equal("twitter" in without, false);
  // Without APP_BASE_URL there is no absolute image, so nothing is added (never localhost).
  assert.equal(shareImage([], "BAGATI", ""), null);
});

test("Organization JSON-LD keeps the brand logo (not the share banner)", () => {
  const graph = (homeJsonLd(BASE)!["@graph"] as Array<Record<string, unknown>>);
  const organization = graph.find((node) => node["@type"] === "Organization")!;
  assert.equal(organization.logo, `${BASE}${BRAND_LOGO_IMAGE.path}`);
  assert.equal(BRAND_LOGO_IMAGE.path, "/bagati-logo-reference.png.png");
});
