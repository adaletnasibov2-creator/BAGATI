/**
 * SEO-1: robots.txt, sitemap.xml, Product JSON-LD and home WebSite/Organization JSON-LD.
 * Pure tests (fake loaders, no database).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { homeJsonLd, productJsonLd, robotsConfig, ROBOTS_DISALLOW, serializeJsonLd, type ProductJsonLdInput } from "../lib/structured-data";
import {
  buildSitemapEntries, categorySitemapEntries, createSitemapLoader, prismaSitemapDeps, SITEMAP_MAX_URLS, SITEMAP_RETRY_AFTER_MS,
  SITEMAP_STATIC_PATHS, SITEMAP_TTL_MS, staticSitemapEntries, toSitemapXmlEntries, type SitemapDeps, type SitemapProductRow, type SitemapStoreRow,
} from "../lib/sitemap";
import { publicStoreEligibilityBaseWhere } from "../lib/seller-legal-policy";
import { publicProductVisibilityWhere } from "../lib/store-visibility";
import { canonicalMetadata } from "../lib/share-preview";
import { categoryPageMetadata } from "../lib/category-seo";
import { isMaintenanceExempt } from "../lib/maintenance";
import type { PublicCategoryNode } from "../lib/public-category-tree";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const BASE = "https://shopbagati.com";
const NOW = new Date("2026-11-21T12:00:00Z");

// ---------------------------------------------------------------------------------------------------------------
// robots.txt

test("robots: allow /, the private areas disallowed, sitemap line from APP_BASE_URL", () => {
  const robots = robotsConfig(BASE);
  const rules = Array.isArray(robots.rules) ? robots.rules[0] : robots.rules;
  assert.equal(rules.userAgent, "*");
  assert.equal(rules.allow, "/");
  assert.deepEqual(rules.disallow, ["/api", "/vendor", "/account", "/cart", "/checkout", "/orders", "/favorites", "/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/auth"]);
  assert.equal(robots.sitemap, "https://shopbagati.com/sitemap.xml");
  // Rendering assets stay crawlable; the admin path is never named (X-Robots-Tag covers it; /api covers /api/admin).
  for (const path of ROBOTS_DISALLOW) {
    assert.ok(!"/_next/static/x.js".startsWith(path) && !"/_next/image".startsWith(path) && !"/uploads/a.webp".startsWith(path) && !"/images/a.webp".startsWith(path), path);
    assert.doesNotMatch(path, /admin/i);
  }
  for (const page of ["/", "/products/abc", "/stores/abc", "/products?category=geyim", "/about", "/terms"]) {
    assert.ok(!ROBOTS_DISALLOW.some((path) => page.startsWith(path)), `${page} stays allowed`);
  }
  assert.ok(ROBOTS_DISALLOW.some((path) => "/api/admin/login".startsWith(path)));
  assert.doesNotMatch(read("app/robots.ts") + read("lib/structured-data.ts").match(/ROBOTS_DISALLOW = \[[\s\S]*?\]/)![0], /"\/admin/);
});

test("robots: no sitemap line without a valid base; read at request time, no database", () => {
  assert.equal(robotsConfig(undefined).sitemap, undefined);
  assert.equal(robotsConfig("not a url").sitemap, undefined);
  const source = read("app/robots.ts");
  assert.match(source, /export const dynamic = "force-dynamic";/);
  assert.doesNotMatch(source, /prisma|shopbagati/);
});

test("maintenance: /robots.txt and /sitemap.xml skip the maintenance check (no 503, no state fetch)", () => {
  assert.equal(isMaintenanceExempt("/robots.txt"), true);
  assert.equal(isMaintenanceExempt("/sitemap.xml"), true);
});

// ---------------------------------------------------------------------------------------------------------------
// sitemap.xml

function store(id: string, overrides: Partial<SitemapStoreRow> = {}): SitemapStoreRow {
  return {
    id, updatedAt: new Date("2026-11-10T00:00:00Z"), status: "ACTIVE", isActive: true, legalInfoApproved: true, adminManaged: false,
    city: { isActive: true },
    vendor: { sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: "Satıcı", voen: "1234567890", legalAddress: "Bakı", user: { isActive: true } },
    subscription: { status: "ACTIVE", currentPeriodStart: null, currentPeriodEnd: null, plan: { isActive: true, slug: "basic" } },
    complimentaryEntitlements: [],
    ...overrides,
  } as SitemapStoreRow;
}
const node = (slug: string, count: number, children: PublicCategoryNode[] = []): PublicCategoryNode & { children: PublicCategoryNode[] } =>
  ({ id: slug, name: slug, slug, parentId: null, iconKey: null, imageUrl: null, parentIconKey: null, count, children });

function fixture(products: SitemapProductRow[] = []) {
  const calls = { stores: 0, products: 0, categories: 0, productStoreIds: [] as string[][], limit: 0 };
  const deps: SitemapDeps = {
    now: () => NOW,
    loadStores: async () => {
      calls.stores += 1;
      return [
        store("store-a"),
        store("store-b", { adminManaged: true, subscription: null }),
        // Ineligible: legal information not approved (the base where lets it through only in this fake; isPublicStoreEligible must drop it).
        store("store-c", { legalInfoApproved: false }),
        // Ineligible: subscription ended.
        store("store-d", { subscription: { status: "ACTIVE", currentPeriodStart: null, currentPeriodEnd: new Date("2026-11-01T00:00:00Z"), plan: { isActive: true, slug: "basic" } } }),
      ];
    },
    loadProducts: async (storeIds, _now, limit) => {
      calls.products += 1;
      calls.productStoreIds.push(storeIds);
      calls.limit = limit;
      return products;
    },
    loadCategories: async () => {
      calls.categories += 1;
      return [node("geyim", 3, [node("koynek", 3), node("bos-alt", 0)]), node("bos", 0)];
    },
  };
  return { deps, calls };
}

const productRows: SitemapProductRow[] = [
  { id: "p-active", storeId: "store-a", status: "ACTIVE", updatedAt: new Date("2026-11-20T08:00:00Z") },
  { id: "p-out-of-stock", storeId: "store-b", status: "ACTIVE", updatedAt: new Date("2026-11-19T08:00:00Z") },
  { id: "p-draft", storeId: "store-a", status: "DRAFT", updatedAt: new Date("2026-11-18T08:00:00Z") },
  { id: "p-ineligible-store", storeId: "store-c", status: "ACTIVE", updatedAt: new Date("2026-11-18T08:00:00Z") },
];

test("sitemap: only eligible stores and products, public non-empty categories, static pages", async () => {
  const { deps, calls } = fixture(productRows);
  const entries = await buildSitemapEntries(deps);
  const paths = entries.map((entry) => entry.path);
  assert.deepEqual(paths, [
    "/", "/about", "/contact", "/terms", "/privacy", "/seller-terms",
    "/products?category=geyim", "/products?category=koynek",
    "/stores/store-a", "/stores/store-b",
    "/products/p-active", "/products/p-out-of-stock",
  ]);
  // Products are asked only for eligible stores; the ineligible store and the draft never appear.
  assert.deepEqual(calls.productStoreIds, [["store-a", "store-b"]]);
  for (const hidden of ["store-c", "store-d", "p-draft", "p-ineligible-store", "bos"]) assert.ok(!paths.some((path) => path.endsWith(hidden) || path.endsWith(`=${hidden}`)), hidden);
  // lastModified = updatedAt where it exists.
  assert.deepEqual(entries.find((entry) => entry.path === "/products/p-active")?.lastModified, new Date("2026-11-20T08:00:00Z"));
  assert.deepEqual(entries.find((entry) => entry.path === "/stores/store-a")?.lastModified, new Date("2026-11-10T00:00:00Z"));
  assert.equal(entries.find((entry) => entry.path === "/")?.lastModified, undefined);
});

test("sitemap: URLs are absolute and identical to each page's canonical", async () => {
  const { deps } = fixture(productRows);
  const xml = toSitemapXmlEntries(await buildSitemapEntries(deps), BASE);
  const urls = xml.map((entry) => entry.url);
  assert.ok(urls.every((url) => url.startsWith("https://shopbagati.com/")));
  assert.equal(urls[0], "https://shopbagati.com/");
  assert.ok(urls.includes(canonicalMetadata("/stores/store-a", BASE).alternates!.canonical as string));
  assert.ok(urls.includes(canonicalMetadata("/products/p-active", BASE).alternates!.canonical as string));
  const categoryCanonical = categoryPageMetadata({ category: { name: "Köynək", slug: "koynek", isActive: true }, parent: null, visibleCount: 3, base: BASE }).alternates!.canonical;
  assert.ok(urls.includes(categoryCanonical as string));
  for (const path of SITEMAP_STATIC_PATHS) {
    if (path === "/") continue;
    // Each static page sets this exact canonical in its own generateMetadata.
    assert.match(read(`app/(customer)${path}/page.tsx`), new RegExp(`absoluteSiteUrl\\("${path}"\\)`));
    assert.match(read(`app/(customer)${path}/page.tsx`), /robots: \{ index: true, follow: true \}/);
  }
  assert.deepEqual(toSitemapXmlEntries(staticSitemapEntries(), undefined), [], "no base: nothing absolute to list");
});

test("sitemap: empty categories (also subcategories) are left out, like their noindex", () => {
  assert.deepEqual(categorySitemapEntries([node("a", 0, [node("a1", 0)]), node("b", 2, [node("b1", 2), node("b2", 0)])]).map((entry) => entry.path), ["/products?category=b", "/products?category=b1"]);
});

test("sitemap: the database reads use the pages' own where helpers and only the needed columns", async () => {
  const captured: { store?: Record<string, unknown>; product?: Record<string, unknown> } = {};
  const db = {
    store: { findMany: async (args: Record<string, unknown>) => { captured.store = args; return []; } },
    product: { findMany: async (args: Record<string, unknown>) => { captured.product = args; return []; } },
  };
  const deps = prismaSitemapDeps(db as never);
  await deps.loadStores(NOW);
  await deps.loadProducts(["store-a"], NOW, 100);
  assert.deepEqual(captured.store!.where, publicStoreEligibilityBaseWhere(NOW));
  assert.deepEqual(captured.product!.where, { AND: [publicProductVisibilityWhere(undefined, NOW), { storeId: { in: ["store-a"] } }] });
  assert.deepEqual(captured.product!.select, { id: true, storeId: true, status: true, updatedAt: true });
  assert.equal(captured.product!.take, 100);
  const storeSelect = captured.store!.select as Record<string, unknown>;
  for (const heavy of ["description", "name", "contactEmail", "contactPhone", "logoUrl", "address"]) assert.equal(storeSelect[heavy], undefined, heavy);
});

test("sitemap: at most 50,000 URLs (the product read gets the remaining room)", async () => {
  const { deps, calls } = fixture([]);
  await buildSitemapEntries(deps);
  assert.equal(calls.limit, SITEMAP_MAX_URLS - SITEMAP_STATIC_PATHS.length - 2 - 2);
  const many = Array.from({ length: SITEMAP_MAX_URLS + 10 }, (_, i) => ({ id: `p${i}`, storeId: "store-a", status: "ACTIVE", updatedAt: NOW }));
  const big = fixture(many);
  assert.equal((await buildSitemapEntries(big.deps)).length, SITEMAP_MAX_URLS);
});

test("sitemap cache: one hour in memory (0 reads on repeat), last good list or static pages on a failure, never throws", async () => {
  let clock = 1_000_000;
  const { deps, calls } = fixture(productRows);
  const logs: string[] = [];
  const loader = createSitemapLoader(deps, { clock: () => clock, log: (line) => logs.push(line) });
  const first = await loader.get();
  assert.equal(calls.stores, 1);
  clock += SITEMAP_TTL_MS - 1;
  assert.deepEqual(await loader.get(), first);
  assert.equal(calls.stores, 1, "repeat within the hour: no database read");
  assert.equal(calls.products, 1);

  // After the hour a failing read serves the last good list.
  clock += 2;
  deps.loadStores = async () => { throw Object.assign(new Error("db down"), { code: "P1001" }); };
  assert.deepEqual(await loader.get(), first);
  assert.match(logs[0], /"event":"cached_read.failed","label":"sitemap"/);

  // A fresh process with the database down: static pages only, retried after 60 s.
  const cold = fixture();
  let failures = 0;
  cold.deps.loadCategories = async () => { failures += 1; throw new Error("db down"); };
  const coldLoader = createSitemapLoader(cold.deps, { clock: () => clock, log: () => {} });
  assert.deepEqual(await coldLoader.get(), staticSitemapEntries());
  await coldLoader.get();
  assert.equal(failures, 1, "the failure is cached briefly");
  clock += SITEMAP_RETRY_AFTER_MS + 1;
  await coldLoader.get();
  assert.equal(failures, 2);
});

test("sitemap route: request-time, from the cached loader", () => {
  const source = read("app/sitemap.ts");
  assert.match(source, /export const dynamic = "force-dynamic";/);
  assert.match(source, /toSitemapXmlEntries\(await getSitemapEntries\(\)\)/);
  assert.doesNotMatch(source, /prisma/);
});

// ---------------------------------------------------------------------------------------------------------------
// Product JSON-LD

const baseProduct: ProductJsonLdInput = {
  id: "p1", name: "Gümüş üzük", description: "  Əl işi\n\n gümüş   üzük.  ", images: ["/uploads/vendors/s1/a.webp", "http://insecure.example/x.png", "/uploads/vendors/s1/a.webp"],
  sku: "SKU-1", storeName: "Aysel Zərgərlik", unitPrice: "40.00", stock: 3, variants: [], base: BASE,
};

function deepKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => deepKeys(item, keys));
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) { keys.add(key); deepKeys(item, keys); }
  return keys;
}

test("product JSON-LD: name, absolute https images, plain description, sku, Offer in AZN with stock and the store as seller", () => {
  const data = productJsonLd(baseProduct);
  assert.deepEqual(data, {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Gümüş üzük",
    image: ["https://shopbagati.com/uploads/vendors/s1/a.webp"],
    description: "Əl işi gümüş üzük.",
    sku: "SKU-1",
    url: "https://shopbagati.com/products/p1",
    offers: { "@type": "Offer", price: "40.00", availability: "https://schema.org/InStock", priceCurrency: "AZN", url: "https://shopbagati.com/products/p1", seller: { "@type": "Organization", name: "Aysel Zərgərlik" } },
  });
  const out = productJsonLd({ ...baseProduct, stock: 0, sku: null, description: "   ", images: [] });
  assert.equal((out.offers as Record<string, unknown>).availability, "https://schema.org/OutOfStock");
  for (const key of ["sku", "description", "image"]) assert.equal(key in out, false, key);
});

test("product JSON-LD: variants with different prices -> AggregateOffer; same price -> Offer; inactive variants ignored", () => {
  const aggregate = productJsonLd({ ...baseProduct, variants: [
    { isActive: true, available: 0, unitPrice: "35.00" },
    { isActive: true, available: 2, unitPrice: "45.50" },
    { isActive: false, available: 9, unitPrice: "5.00" },
  ] }).offers as Record<string, unknown>;
  assert.equal(aggregate["@type"], "AggregateOffer");
  assert.equal(aggregate.lowPrice, "35.00");
  assert.equal(aggregate.highPrice, "45.50");
  assert.equal(aggregate.offerCount, 2);
  assert.equal(aggregate.priceCurrency, "AZN");
  assert.equal(aggregate.availability, "https://schema.org/InStock");
  assert.equal("price" in aggregate, false);

  const same = productJsonLd({ ...baseProduct, variants: [{ isActive: true, available: 0, unitPrice: "20.00" }, { isActive: true, available: 0, unitPrice: "20.00" }] }).offers as Record<string, unknown>;
  assert.equal(same["@type"], "Offer");
  assert.equal(same.price, "20.00");
  assert.equal(same.availability, "https://schema.org/OutOfStock", "no active variant in stock");

  const noneActive = productJsonLd({ ...baseProduct, stock: 7, variants: [{ isActive: false, available: 5, unitPrice: "9.00" }] }).offers as Record<string, unknown>;
  assert.equal(noneActive.price, "40.00");
  assert.equal(noneActive.availability, "https://schema.org/OutOfStock", "a variant product with no active variant cannot be bought");
});

test("product JSON-LD: no rating, review, brand, shipping, return or delivery claims", () => {
  const keys = deepKeys(productJsonLd({ ...baseProduct, variants: [{ isActive: true, available: 1, unitPrice: "1.00" }, { isActive: true, available: 1, unitPrice: "2.00" }] }));
  for (const forbidden of ["aggregateRating", "review", "reviews", "brand", "shippingDetails", "hasMerchantReturnPolicy", "deliveryLeadTime", "itemCondition", "priceValidUntil"]) {
    assert.equal(keys.has(forbidden), false, forbidden);
  }
  assert.doesNotMatch(read("lib/structured-data.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, ""), /aggregateRating|shippingDetails|MerchantReturn|Pulsuz|pulsuz/);
});

test("JSON-LD escaping: seller text cannot close the script tag and parses back unchanged", () => {
  const name = "</script><script>alert(1)</script> & <!-- \u2028";
  const json = serializeJsonLd(productJsonLd({ ...baseProduct, name, description: name }));
  assert.doesNotMatch(json, /[<>&\u2028\u2029]/);
  assert.equal((JSON.parse(json) as { name: string }).name, name);
  const html = renderToStaticMarkup(createElement("script", { type: "application/ld+json", dangerouslySetInnerHTML: { __html: json } }));
  assert.equal(html.match(/<\/script>/gi)?.length, 1, "exactly one closing tag: the real one");
  assert.equal(html.match(/<script/gi)?.length, 1);
  assert.match(html, /\\u003c\/script\\u003e\\u003cscript\\u003ealert\(1\)/);
});

test("product page: JSON-LD only after the 404 checks, escaped, from the page's own numbers", () => {
  const page = read("app/(customer)/products/[productId]/page.tsx");
  const body = page.slice(page.indexOf("export default async function ProductPage"));
  const lastNotFound = body.lastIndexOf("notFound();");
  const built = body.indexOf("const structuredData = serializeJsonLd(productJsonLd({");
  assert.ok(lastNotFound > 0 && built > lastNotFound, "built after every notFound()");
  assert.ok(body.indexOf("const variants = product.variants.map") < built);
  // \r?\n: the working copy may be CRLF on Windows (core.autocrlf); the committed file is LF.
  assert.match(body, /unitPrice: effective\.unitPrice\.toFixed\(2\),\r?\n    stock,\r?\n    variants,/);
  assert.match(body, /<script type="application\/ld\+json" dangerouslySetInnerHTML=\{\{ __html: structuredData \}\}\/>/);
  assert.equal(page.match(/application\/ld\+json/g)?.length, 1);
  const metadataBody = page.slice(page.indexOf("export async function generateMetadata"), page.indexOf("export default async function ProductPage"));
  assert.doesNotMatch(metadataBody, /ld\+json|productJsonLd/, "never in generateMetadata (which also runs for 404s)");
});

// ---------------------------------------------------------------------------------------------------------------
// Home JSON-LD

test("home JSON-LD: WebSite + Organization named BAGATI with url and logo, no SearchAction; none without a base", () => {
  const data = homeJsonLd(BASE)!;
  const json = serializeJsonLd(data);
  const parsed = JSON.parse(json) as { "@graph": Record<string, unknown>[] };
  const [site, org] = parsed["@graph"];
  assert.equal(site["@type"], "WebSite");
  assert.equal(site.name, "BAGATI");
  assert.equal(site.url, "https://shopbagati.com/");
  assert.equal(org["@type"], "Organization");
  assert.equal(org.name, "BAGATI");
  assert.equal(org.url, "https://shopbagati.com/");
  assert.equal(org.logo, "https://shopbagati.com/bagati-logo-reference.png.png");
  assert.equal(deepKeys(data).has("potentialAction"), false);
  assert.equal(homeJsonLd(undefined), null);
  const page = read("app/(customer)/(home)/page.tsx");
  assert.match(page, /\{siteJsonLd && <script type="application\/ld\+json" dangerouslySetInnerHTML=\{\{ __html: serializeJsonLd\(siteJsonLd\) \}\}\/>\}/);
});
