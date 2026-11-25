/**
 * SMALL-FIXES-1: (A) the order response carries no seller data, (B) fee-0 stores hide the threshold sentence,
 * (C) rel=canonical on store/product pages = og:url, (D) share preview for the home and category pages.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { orderCreateResponse } from "../lib/order-create-response";
import { remainingForFreeDeliveryCents, showFreeDeliveryThresholdNote, storeDeliveryCents } from "../lib/delivery-cents";
import { canonicalMetadata, categorySharePreviewMetadata, DEFAULT_SHARE_IMAGE, homeSharePreviewMetadata, sharePreviewMetadata, shareImage } from "../lib/share-preview";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const BASE = "https://shopbagati.com";
const DEFAULT_IMAGE_URL = `${BASE}${DEFAULT_SHARE_IMAGE.path}`;

// ---------------------------------------------------------------------------------------------------------------
// A: order response

test("A: the order response is { order: { id } } only; no seller email, phone or legal data", () => {
  // The shape the transaction returns (include with the seller's account email, as before).
  const created = {
    id: "ord_1", status: "PENDING", subtotal: "40.00", deliveryFee: "5.00", total: "45.00", userId: "cust_1",
    storeOrders: [{ id: "so_1", storeId: "store_1", store: { id: "store_1", name: "Aysel Zərgərlik", vendor: { user: { id: "seller_1", email: "seller@example.az" }, phone: "+994501234567", voen: "1234567890", legalAddress: "Bakı" } }, items: [] }],
    payments: [{ id: "pay_1", amount: "45.00", currency: "AZN", status: "PENDING" }],
  };
  const response = orderCreateResponse(created);
  assert.deepEqual(response, { order: { id: "ord_1" } });
  const json = JSON.stringify(response);
  assert.doesNotMatch(json, /@|seller|email|phone|voen|994|legal|vendor/i);
});

test("A: the route returns orderCreateResponse(order); order creation, seller emails and messages unchanged", () => {
  const route = read("app/api/orders/route.ts");
  assert.match(route, /return NextResponse\.json\(orderCreateResponse\(order as SellerOrderEmailOrder\),\{status:201\}\);/);
  assert.doesNotMatch(route, /NextResponse\.json\(\{order\}/, "the created object is never sent as is");
  // The seller account email is still read server-side (seller emails after the commit, in-app notification).
  assert.match(route, /include:\{storeOrders:\{include:\{store:\{select:\{id:true,name:true,vendor:\{select:\{user:\{select:\{id:true,email:true\}\}\}\}\}\},items:true\}\},payments:true\}\}/);
  assert.match(route, /void queueSellerNewOrderEmails\(prisma,order as SellerOrderEmailOrder\)\.catch\(\(\)=>undefined\);/);
  // The checkout reads only the order id.
  const form = read("components/checkout-form.tsx");
  assert.deepEqual([...new Set(form.match(/data\.order\.\w+/g))], ["data.order.id"]);
});

// ---------------------------------------------------------------------------------------------------------------
// B: fee-0 stores

test("B: the threshold sentence needs a fee above 0 and delivery not free yet", () => {
  // fee 0, under the threshold: "Çatdırılma AZN 0.00" stays, the sentence is hidden, no remaining line.
  const feeZero = storeDeliveryCents(2000, { deliveryFee: "0.00", freeDeliveryThreshold: "100.00" });
  assert.equal(feeZero.freeDelivery, false);
  assert.equal(feeZero.deliveryFeeCents, 0);
  assert.equal(showFreeDeliveryThresholdNote(feeZero), false);
  assert.equal(remainingForFreeDeliveryCents(feeZero), null);
  // no fee set: the temporary 0.00 default behaves the same.
  assert.equal(showFreeDeliveryThresholdNote(storeDeliveryCents(1000, { deliveryFee: null, freeDeliveryThreshold: null })), false);
  // fee > 0, under the threshold: the sentence stays (and the remaining line).
  const paid = storeDeliveryCents(4000, { deliveryFee: "5.00", freeDeliveryThreshold: "100.00" });
  assert.equal(showFreeDeliveryThresholdNote(paid), true);
  assert.equal(remainingForFreeDeliveryCents(paid), 6000);
  // threshold reached: free delivery, no sentence (PULSUZ is shown instead, as before).
  const free = storeDeliveryCents(10000, { deliveryFee: "5.00", freeDeliveryThreshold: "100.00" });
  assert.equal(free.freeDelivery, true);
  assert.equal(showFreeDeliveryThresholdNote(free), false);
});

test("B: cart and checkout use the helper; fee 0 still shows the amount (no PULSUZ); no new text", () => {
  const cart = read("components/cart-page-client.tsx");
  assert.match(cart, /\{showFreeDeliveryThresholdNote\(group\.delivery\) && <p className="mt-1 text-xs text-fg-muted">\{centsToFixed\(group\.delivery\.freeDeliveryThresholdCents\)\} ₼ və yuxarı sifarişlərdə çatdırılma pulsuzdur\.<\/p>\}/); // PRICE-SYMBOL-1: unit is ₼ (was AZN)
  // PULSUZ only from freeDelivery (threshold reached), never from a 0 fee.
  assert.match(cart, /\{group\.delivery\.freeDelivery \? "PULSUZ" : money\(group\.delivery\.deliveryFeeCents \/ 100\)\}/);
  const form = read("components/checkout-form.tsx");
  assert.match(form, /\{showFreeDeliveryThresholdNote\(\{freeDelivery:store\.freeDelivery,deliveryFeeCents:Math\.round\(store\.deliveryFee\*100\)\}\)&&<p className="mt-1 text-xs text-fg-muted">\{store\.freeDeliveryThreshold\.toFixed\(2\)\} ₼ və yuxarı sifarişlərdə çatdırılma pulsuzdur\.<\/p>\}/);
  assert.match(form, /\{store\.freeDelivery\?"PULSUZ":formatPrice\(store\.deliveryFee\)\}/); // PRICE-SYMBOL-1: fee 0 still shows the amount ("0.00 ₼") via lib/price.ts
  // The "pulsuz" counts stay as pinned in design-t6 / cart-polish-share (no text added or removed).
  const count = (source: string) => (source.match(/pulsuz/gi) ?? []).length;
  assert.equal(count(cart), 3);
  assert.equal(count(form), 3);
  assert.equal(count(read("lib/delivery-cents.ts")), 0);
});

// ---------------------------------------------------------------------------------------------------------------
// C: rel=canonical

test("C: canonical is absolute from APP_BASE_URL and equals og:url; left out without a valid base", () => {
  const path = "/stores/store_1";
  const canonical = canonicalMetadata(path, BASE);
  assert.deepEqual(canonical, { alternates: { canonical: `${BASE}${path}` } });
  const og = sharePreviewMetadata({ title: "X", path, siteName: "BAGATI", image: null, base: BASE }).openGraph as { url?: string };
  assert.equal(og.url, canonical.alternates?.canonical);
  assert.deepEqual(canonicalMetadata(path, undefined), {});
  assert.deepEqual(canonicalMetadata(path, ""), {});
  assert.deepEqual(canonicalMetadata(path, "not a url"), {});
});

test("C: store and product pages: canonical uses the og:url path, only after the public checks", () => {
  const store = read("app/(customer)/stores/[storeId]/page.tsx");
  const storeMeta = store.slice(store.indexOf("export async function generateMetadata"), store.indexOf("export default async function StorefrontPage"));
  assert.match(storeMeta, /path: `\/stores\/\$\{store\.id\}`[\s\S]*\.\.\.canonicalMetadata\(`\/stores\/\$\{store\.id\}`\)/);
  assert.ok(storeMeta.indexOf("if (!store) return {};") < storeMeta.indexOf("canonicalMetadata("), "non-public store: {} before");
  const product = read("app/(customer)/products/[productId]/page.tsx");
  const productMeta = product.slice(product.indexOf("export async function generateMetadata"), product.indexOf("export default async function ProductPage"));
  assert.match(productMeta, /path: `\/products\/\$\{product\.id\}`[\s\S]*\.\.\.canonicalMetadata\(`\/products\/\$\{product\.id\}`\)/);
  assert.ok(productMeta.indexOf("if (!eligibleStoreIds.has(product.store.id)) return {};") < productMeta.indexOf("canonicalMetadata("), "non-public product: {} before");
});

// ---------------------------------------------------------------------------------------------------------------
// D: home and category share preview

test("D: home share preview from the settings, og:url = site root, default image", () => {
  const meta = homeSharePreviewMetadata({ siteName: "BAGATI", description: "Yerli mağazalar bir yerdə.", ogTitle: null, ogDescription: null, base: BASE });
  assert.deepEqual(meta.openGraph, {
    title: "BAGATI", description: "Yerli mağazalar bir yerdə.", url: `${BASE}/`, type: "website", siteName: "BAGATI", locale: "az_AZ",
    images: [{ url: DEFAULT_IMAGE_URL, width: 1200, height: 630, alt: "BAGATI" }], // LAUNCH-TECH-1: 1200x630 default
  });
  assert.deepEqual(meta.twitter, { card: "summary_large_image", title: "BAGATI", description: "Yerli mağazalar bir yerdə.", images: [DEFAULT_IMAGE_URL] });
  // The admin's Open Graph texts win when set.
  const custom = homeSharePreviewMetadata({ siteName: "BAGATI", description: "x", ogTitle: "BAGATI — mağazalar", ogDescription: "OG təsvir", base: BASE });
  assert.equal((custom.openGraph as { title: string }).title, "BAGATI — mağazalar");
  assert.equal((custom.openGraph as { description: string }).description, "OG təsvir");
  // Without a base: no og:url and no image (never localhost).
  const noBase = homeSharePreviewMetadata({ siteName: "BAGATI", description: "", ogTitle: null, ogDescription: null, base: "" });
  assert.equal("url" in (noBase.openGraph as object), false);
  assert.equal("images" in (noBase.openGraph as object), false);
  assert.equal("description" in (noBase.openGraph as object), false);
});

test("D: home page wires the helper without changing the visible page", () => {
  // SMALL-FIXES-2 (owner decision): the home page also gets canonicalMetadata("/") next to the share preview.
  const page = read("app/(customer)/(home)/page.tsx");
  assert.match(page, /export async function generateMetadata\(\): Promise<Metadata> \{[\s\S]*return \{ \.\.\.homeSharePreviewMetadata\(\{ siteName: settings\.siteName, description: description \?\? null, ogTitle: ogTitle \?\? null, ogDescription: ogDescription \?\? null \}\), \.\.\.canonicalMetadata\("\/"\) \};\n\}/);
  const meta = page.slice(page.indexOf("export async function generateMetadata"), page.indexOf("export default async function HomePage"));
  assert.doesNotMatch(meta, /title:/, "the <title> stays the root default");
});

test("D: public category: title/description/canonical as before + og:url = canonical, category photo or default image", () => {
  const category = { name: "Zərgərlik", slug: "zergerlik", isActive: true, imageUrl: "/uploads/categories/z.webp" };
  const meta = categorySharePreviewMetadata({ category, parent: null, visibleCount: 4, siteName: "BAGATI", base: BASE });
  const canonical = `${BASE}/products?category=zergerlik`;
  assert.equal(meta.title, "Zərgərlik");
  assert.deepEqual(meta.alternates, { canonical });
  assert.equal(meta.robots, undefined);
  const og = meta.openGraph as { url: string; siteName: string; locale: string; images: { url: string }[] };
  assert.equal(og.url, canonical);
  assert.equal(og.siteName, "BAGATI");
  assert.equal(og.locale, "az_AZ");
  assert.equal(og.images[0].url, `${BASE}/uploads/categories/z.webp`);
  assert.equal((meta.twitter as { card: string }).card, "summary_large_image");
  // No photo: the default image.
  const plain = categorySharePreviewMetadata({ category: { ...category, imageUrl: null }, parent: { name: "Aksesuar", isActive: true }, visibleCount: 1, siteName: "BAGATI", base: BASE });
  assert.equal((plain.openGraph as { images: { url: string }[] }).images[0].url, DEFAULT_IMAGE_URL);
  assert.equal(plain.title, "Zərgərlik — Aksesuar");
  assert.deepEqual(shareImage([null], "x", BASE)?.url, DEFAULT_IMAGE_URL);
});

test("D: unknown/inactive/hidden category: no name, no og, no twitter (nothing leaks)", () => {
  const meta = categorySharePreviewMetadata({ category: null, parent: null, visibleCount: 0, siteName: "BAGATI", base: BASE });
  assert.deepEqual(meta, { title: "Kateqoriya tapılmadı", robots: { index: false, follow: true } });
  for (const path of ["app/(customer)/products/(list)/page.tsx", "app/(customer)/categories/page.tsx"]) {
    const page = read(path);
    // The pages pass `found` only when isPublicCategory says so (same rule as before).
    assert.match(page, /const found = lookup && isPublicCategory\(data\.rows, lookup\.category\.id\) \? lookup : null;/, path);
    assert.match(page, /return categorySharePreviewMetadata\(\{ category: found\?\.category \?\? null, parent: found\?\.parent \?\? null, visibleCount, siteName: settings\.siteName \}\);/, path);
  }
});
