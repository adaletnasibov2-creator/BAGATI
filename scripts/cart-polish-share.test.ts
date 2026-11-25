/**
 * CART-POLISH + SHARE-PREVIEW: partial-stock note, the cart's "Pulsuz çatdırılmaya … AZN qaldı" line, and the
 * Open Graph / Twitter metadata of public store and product pages (no leak for non-public ones).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { calculateStoreDelivery } from "../lib/delivery";
import { centsToFixed, remainingForFreeDeliveryCents, storeDeliveryCents, toCents } from "../lib/delivery-cents";
import { cartItemAvailability, CART_UNAVAILABLE_REASONS } from "../lib/cart-item-availability";
import { absoluteImageUrl, DEFAULT_SHARE_IMAGE, shareImage, sharePreviewMetadata } from "../lib/share-preview";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const BASE = "https://shopbagati.com";

// ---------------------------------------------------------------------------------------------------------------
// ITEM 1: partial stock, cart card

test("partial stock: 'Mövcud stok: N' while some stock is left; 'Stokda yoxdur' only at 0; variant problems unchanged", () => {
  const inv = (quantity: number, reserved = 0, variantId: string | null = null) => ({ id: `i-${variantId}`, variantId, quantity, reserved });
  const base = { productId: "p", variantId: null, variants: [], eligible: true, priceValid: true };
  assert.equal(cartItemAvailability({ ...base, inventory: [inv(2)], quantity: 3 }).unavailableReason, "Mövcud stok: 2");
  assert.equal(cartItemAvailability({ ...base, inventory: [inv(5, 4)], quantity: 2 }).unavailableReason, "Mövcud stok: 1", "reserved counted");
  assert.equal(cartItemAvailability({ ...base, inventory: [inv(0)], quantity: 1 }).unavailableReason, "Stokda yoxdur");
  assert.equal(cartItemAvailability({ ...base, inventory: [inv(3, 3)], quantity: 1 }).unavailableReason, "Stokda yoxdur", "all reserved = 0 left");
  assert.equal(cartItemAvailability({ ...base, inventory: [inv(2)], quantity: 3 }).purchasable, false, "still not orderable");
  const variants = [{ id: "v1", productId: "p", isActive: true }, { id: "v2", productId: "p", isActive: false }];
  assert.equal(cartItemAvailability({ ...base, variantId: "v1", variants, inventory: [inv(1, 0, "v1")], quantity: 4 }).unavailableReason, "Mövcud stok: 1", "variant with some stock");
  assert.equal(cartItemAvailability({ ...base, variantId: "v2", variants, inventory: [inv(9, 0, "v2")], quantity: 1 }).unavailableReason, CART_UNAVAILABLE_REASONS.variant);
  assert.equal(cartItemAvailability({ ...base, eligible: false, inventory: [inv(2)], quantity: 3 }).unavailableReason, CART_UNAVAILABLE_REASONS.storeOrProduct, "store/product first");
});

test("cart card: the top 'Mağaza üzrə cəm' line is gone; 'Mağaza cəmi:' with delivery stays; checkout keeps both cart links", () => {
  const cart = read("components/cart-page-client.tsx");
  assert.doesNotMatch(cart, /Mağaza üzrə cəm/);
  assert.match(cart, /<span>Mağaza cəmi:<\/span><span>\{money\(group\.delivery\.storeTotalCents \/ 100\)\}<\/span>/);
  const form = read("components/checkout-form.tsx");
  assert.ok(form.includes(">Səbətə keç</Link>") && form.includes(">Səbətə qayıt</Link>"));
});

// ---------------------------------------------------------------------------------------------------------------
// ITEM 2: "Pulsuz çatdırılmaya {amount} AZN qaldı"

test("remaining to free delivery: threshold minus store subtotal in cents, hidden when free, fee 0 or nothing left", () => {
  const remaining = (subtotal: string, threshold: string | null, fee: string | null) => remainingForFreeDeliveryCents(storeDeliveryCents(toCents(subtotal)!, { freeDeliveryThreshold: threshold, deliveryFee: fee }));
  assert.equal(remaining("99.99", "100.00", "5.00"), 1, "one cent below");
  assert.equal(remaining("40.00", "100.00", "5.00"), 6000, "far below");
  assert.equal(remaining("0.00", "50.00", "4.00"), 5000, "empty store part");
  assert.equal(remaining("33.33", "50.00", "4.00"), 1667, "2-decimal prices, no float drift");
  assert.equal(remaining("29.99", null, "3.50"), 1, "default threshold 30.00");
  assert.equal(remaining("100.00", "100.00", "5.00"), null, "equal to the threshold = free = hidden");
  assert.equal(remaining("120.00", "100.00", "5.00"), null, "above = hidden");
  assert.equal(remaining("40.00", "100.00", "0.00"), null, "fee 0 = nothing to save = hidden");
  assert.equal(remaining("40.00", "100.00", null), null, "no fee set (0.00) = hidden");
  assert.equal(remaining("0.00", "0.00", "5.00"), null, "threshold 0 = always free");
  assert.equal(centsToFixed(remaining("40.00", "100.00", "5.00")!), "60.00");
});

test("remaining amount = threshold − subtotal from the same result the totals use (and the server agrees it is not free)", () => {
  let seed = 7;
  const next = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let run = 0; run < 1000; run++) {
    const subtotal = (Math.floor(next() * 30000) / 100).toFixed(2), threshold = (Math.floor(next() * 30000) / 100).toFixed(2), fee = next() < 0.2 ? "0.00" : (Math.floor(next() * 1500) / 100).toFixed(2);
    const delivery = storeDeliveryCents(toCents(subtotal)!, { freeDeliveryThreshold: threshold, deliveryFee: fee });
    const server = calculateStoreDelivery(subtotal, { freeDeliveryThreshold: threshold, deliveryFee: fee });
    const value = remainingForFreeDeliveryCents(delivery);
    if (value === null) {
      assert.ok(server.freeDelivery || server.deliveryFee.eq(0), `run ${run}: hidden only when free or fee 0`);
    } else {
      assert.equal(server.freeDelivery, false, `run ${run}`);
      assert.ok(server.deliveryFee.gt(0), `run ${run}`);
      assert.equal(centsToFixed(value), new Prisma.Decimal(threshold).sub(subtotal).toFixed(2), `run ${run}: ${threshold} − ${subtotal}`);
      assert.equal(value, delivery.freeDeliveryThresholdCents - delivery.subtotalCents);
    }
  }
});

test("cart shows the line only from the helper, in the site's '{amount} ₼' format (PRICE-SYMBOL-1); pulsuz count pinned", () => {
  const cart = read("components/cart-page-client.tsx");
  assert.match(cart, /\{remainingForFreeDeliveryCents\(group\.delivery\) !== null && <p data-cart-free-delivery-remaining=""[^>]*>Pulsuz çatdırılmaya \{centsToFixed\(remainingForFreeDeliveryCents\(group\.delivery\)!\)\} ₼ qaldı<\/p>\}/); // PRICE-SYMBOL-1: unit is ₼ (was AZN)
  assert.equal((cart.match(/pulsuz/gi) ?? []).length, 3, "PULSUZ, the threshold sentence and the remaining line; nothing else");
});

// ---------------------------------------------------------------------------------------------------------------
// ITEM 3: share preview

test("share preview: absolute https URLs from APP_BASE_URL, og:* and twitter:* for a store with its banner", () => {
  const meta = sharePreviewMetadata({ title: "Aysel Zərgərlik", description: "Əl işi zinət əşyaları.", path: "/stores/s1", siteName: "BAGATI", image: shareImage(["/uploads/vendors/v1/ab12.webp", "/uploads/vendors/v1/logo.png"], "Aysel Zərgərlik", BASE), base: BASE });
  assert.deepEqual(meta.openGraph, {
    title: "Aysel Zərgərlik", description: "Əl işi zinət əşyaları.", url: "https://shopbagati.com/stores/s1", type: "website", siteName: "BAGATI", locale: "az_AZ",
    images: [{ url: "https://shopbagati.com/uploads/vendors/v1/ab12.webp", alt: "Aysel Zərgərlik" }],
  });
  assert.deepEqual(meta.twitter, { card: "summary_large_image", title: "Aysel Zərgərlik", description: "Əl işi zinət əşyaları.", images: ["https://shopbagati.com/uploads/vendors/v1/ab12.webp"] });
});

test("share preview: a product image already on the CDN (https) stays as is", () => {
  const image = shareImage(["https://cdn.example.az/products/p1/1.jpg"], "Gümüş üzük", BASE);
  assert.deepEqual(image, { url: "https://cdn.example.az/products/p1/1.jpg", alt: "Gümüş üzük" });
});

test("share preview: no image (or an unusable one) falls back to the site image with its size", () => {
  const fallback = { url: `https://shopbagati.com${DEFAULT_SHARE_IMAGE.path}`, width: 1200, height: 630, alt: "Məhsul" }; // LAUNCH-TECH-1: dedicated 1200x630 image
  assert.deepEqual(shareImage([undefined, null, ""], "Məhsul", BASE), fallback);
  assert.deepEqual(shareImage(["http://insecure.example/x.jpg"], "Məhsul", BASE), fallback, "http is not used");
  assert.deepEqual(shareImage(["//evil.example/x.jpg"], "Məhsul", BASE), fallback, "protocol-relative is not used");
  assert.deepEqual(shareImage(["javascript:alert(1)"], "Məhsul", BASE), fallback);
  assert.deepEqual(shareImage(["https://user:pass@cdn.example/x.jpg"], "Məhsul", BASE), fallback, "no credentials in URLs");
  assert.equal(absoluteImageUrl("/x.jpg", undefined), null, "no base: left out instead of localhost");
  const noBase = sharePreviewMetadata({ title: "X", path: "/products/p", siteName: "BAGATI", image: shareImage([], "X", ""), base: "" });
  assert.equal((noBase.openGraph as { url?: string }).url, undefined);
  assert.equal((noBase.openGraph as { images?: unknown }).images, undefined);
  assert.equal(DEFAULT_SHARE_IMAGE.path, "/images/share/bagati-share-1200x630.png", "an existing file in public/");
  assert.ok(readFileSync(join(root, "public", DEFAULT_SHARE_IMAGE.path.slice(1))).length > 0);
});

test("non-public stores and products leak nothing: same eligibility as the pages, empty metadata otherwise", () => {
  const store = read("app/(customer)/stores/[storeId]/page.tsx");
  assert.match(store, /const store = await getPublicStore\(storeId\);\n\s*\/\/ Not public[^\n]*\n\s*if \(!store\) return \{\};/);
  assert.match(store, /return store && isPublicStoreEligible\(store\) \? store : null;/, "getPublicStore = the page's own check");
  assert.match(store, /const banner = branding\?\.bannerUrl && isOwnedStoreAssetUrl\(store\.id, branding\.bannerUrl\) \? branding\.bannerUrl : null;/);
  assert.match(store, /const logo = store\.logoUrl && isOwnedStoreAssetUrl\(store\.id, store\.logoUrl\) \? store\.logoUrl : null;/);
  const product = read("app/(customer)/products/[productId]/page.tsx");
  const meta = product.slice(product.indexOf("export async function generateMetadata"), product.indexOf("export default async function ProductPage"));
  // One cached query (React cache) shared by the page and its metadata: the same public visibility filter.
  assert.match(product, /const getPublicProductRecord = cache\(\(productId: string\) =>\n\s*prisma\.product\.findFirst\(\{\n\s*where: \{ id: productId, \.\.\.publicProductVisibilityWhere\(\) \},/);
  assert.match(meta, /const product = await getPublicProductRecord\(productId\) as ProductRecord \| null;\n\s*if \(!product\) return \{\};\n\s*const eligibleStoreIds = await resolvePublicStoreEligibility\(\[product\.store\.id\], prisma, new Date\(\)\);\n\s*if \(!eligibleStoreIds\.has\(product\.store\.id\)\) return \{\};/);
  assert.match(product, /getPublicProductRecord\(productId\),\n\s*getSiteSettings\(\),/, "the page reads the same cached record");
  // Only what the page shows: name, description, first image (and the store id for the eligibility check).
  assert.deepEqual([...new Set(meta.match(/product\.\w+/g))].sort(), ["product.description", "product.id", "product.images", "product.name", "product.store"]);
  // The page itself is unchanged: not public -> 404.
  assert.match(product, /if \(!product\) notFound\(\);\n\n\s*const eligibleStoreIds = await resolvePublicStoreEligibility\(\[product\.store\.id\], prisma, now\);\n\s*if \(!eligibleStoreIds\.has\(product\.store\.id\)\) notFound\(\);/);
});
