/**
 * CART-DELIVERY: the cart shows the same per-store delivery and totals as the checkout and the order; "Stokda yoxdur"
 * for too little stock; the checkout shows the cart's item notes. The parity test proves the browser helper
 * (lib/delivery-cents.ts, whole cents) gives exactly what the server helper (lib/delivery.ts, Prisma.Decimal) gives.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { calculateStoreDelivery, DEFAULT_FREE_DELIVERY_THRESHOLD, TEMPORARY_DEFAULT_DELIVERY_FEE } from "../lib/delivery";
import { centsToFixed, DEFAULT_DELIVERY_FEE_CENTS, DEFAULT_FREE_DELIVERY_THRESHOLD_CENTS, lineTotalCents, storeDeliveryCents, toCents } from "../lib/delivery-cents";
import { calculateEffectivePrice } from "../lib/promotion-pricing";
import { CART_UNAVAILABLE_REASONS, cartItemAvailability } from "../lib/cart-item-availability";
import { resolveVariantInventory } from "../lib/product-variants";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");

type Config = { freeDeliveryThreshold: string | null; deliveryFee: string | null };
function compare(subtotal: string, config: Config, label: string) {
  const server = calculateStoreDelivery(subtotal, config);
  const client = storeDeliveryCents(toCents(subtotal)!, config);
  const where = `${label}: subtotal ${subtotal}, threshold ${config.freeDeliveryThreshold}, fee ${config.deliveryFee}`;
  assert.equal(centsToFixed(client.deliveryFeeCents), server.deliveryFee.toFixed(2), `${where} (fee)`);
  assert.equal(client.freeDelivery, server.freeDelivery, `${where} (free)`);
  assert.equal(centsToFixed(client.freeDeliveryThresholdCents), server.freeDeliveryThreshold.toFixed(2), `${where} (threshold)`);
  assert.equal(centsToFixed(client.storeTotalCents), server.subtotal.add(server.deliveryFee).toFixed(2), `${where} (store total)`);
}

// ---------------------------------------------------------------------------------------------------------------
// Parity: browser cents helper == server calculateStoreDelivery

test("parity: defaults are the same (threshold 30.00, fee 0.00)", () => {
  assert.equal(centsToFixed(DEFAULT_FREE_DELIVERY_THRESHOLD_CENTS), DEFAULT_FREE_DELIVERY_THRESHOLD.toFixed(2));
  assert.equal(centsToFixed(DEFAULT_DELIVERY_FEE_CENTS), TEMPORARY_DEFAULT_DELIVERY_FEE.toFixed(2));
});

test("parity: edge cases (equal to the threshold, one cent below/above, fee 0, null settings, zero subtotal)", () => {
  const cases: [string, Config, string][] = [
    ["100.00", { freeDeliveryThreshold: "100.00", deliveryFee: "5.00" }, "equal to threshold = free"],
    ["99.99", { freeDeliveryThreshold: "100.00", deliveryFee: "5.00" }, "one cent below"],
    ["100.01", { freeDeliveryThreshold: "100.00", deliveryFee: "5.00" }, "one cent above"],
    ["40.00", { freeDeliveryThreshold: "100.00", deliveryFee: "0.00" }, "fee 0 below threshold"],
    ["40.00", { freeDeliveryThreshold: null, deliveryFee: null }, "null settings, above default 30"],
    ["29.99", { freeDeliveryThreshold: null, deliveryFee: "3.50" }, "null threshold, one cent below default"],
    ["30.00", { freeDeliveryThreshold: null, deliveryFee: "3.50" }, "null threshold, equal to default"],
    ["12.00", { freeDeliveryThreshold: "50.00", deliveryFee: null }, "null fee"],
    ["0.00", { freeDeliveryThreshold: "0.00", deliveryFee: "5.00" }, "threshold 0: always free"],
    ["0.00", { freeDeliveryThreshold: "10.00", deliveryFee: "5.00" }, "empty subtotal"],
    ["520.00", { freeDeliveryThreshold: "100.00", deliveryFee: "5.00" }, "browser check store A"],
    ["35.00", { freeDeliveryThreshold: "50.00", deliveryFee: "4.00" }, "browser check store B"],
    ["18.00", { freeDeliveryThreshold: "200.00", deliveryFee: "3.00" }, "browser check store C"],
    ["9999999.99", { freeDeliveryThreshold: "9999999999.99", deliveryFee: "9999.99" }, "large amounts"],
  ];
  for (const [subtotal, config, label] of cases) compare(subtotal, config, label);
});

test("parity: 2,000 generated stores with 2-decimal prices, quantities and campaign prices", () => {
  let seed = 20261120;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const amount = (max: number) => (Math.floor(next() * max * 100) / 100).toFixed(2);
  for (let run = 0; run < 2000; run++) {
    // A store's items: plain 2-decimal prices and campaign prices (percent or fixed, rounded by the server helper).
    const lines = Array.from({ length: 1 + Math.floor(next() * 4) }, () => {
      const base = new Prisma.Decimal(amount(300)).add("0.01");
      const kind = next();
      const promotions = kind < 0.35 ? [{ promotion: { id: "p", name: "K", isActive: true, startsAt: new Date(0), endsAt: new Date(8.64e15), discountType: kind < 0.2 ? "PERCENT" : "FIXED", discountValue: kind < 0.2 ? String(1 + Math.floor(next() * 60)) : amount(20), storeId: null } }] : [];
      const unit = calculateEffectivePrice(base, null, promotions.map((p) => p.promotion) as never, new Date()).unitPrice;
      return { unit, quantity: 1 + Math.floor(next() * 5) };
    });
    // Server: Decimal sum of unitPrice × quantity (as POST /api/orders). Browser: the cart's 2-decimal strings in cents.
    const serverSubtotal = lines.reduce((sum, line) => sum.add(line.unit.mul(line.quantity)), new Prisma.Decimal(0));
    const clientSubtotalCents = lines.reduce((sum, line) => sum + lineTotalCents(line.unit.toFixed(2), line.quantity), 0);
    assert.equal(centsToFixed(clientSubtotalCents), serverSubtotal.toFixed(2), `run ${run}: subtotal`);
    const config: Config = {
      freeDeliveryThreshold: next() < 0.1 ? null : next() < 0.3 ? serverSubtotal.toFixed(2) : amount(400),
      deliveryFee: next() < 0.1 ? null : next() < 0.2 ? "0.00" : amount(15),
    };
    compare(serverSubtotal.toFixed(2), config, `run ${run}`);
  }
});

test("toCents: exact 2-decimal parsing; invalid input is null", () => {
  assert.equal(toCents("12.5"), 1250);
  assert.equal(toCents("12.05"), 1205);
  assert.equal(toCents("0.1"), 10);
  assert.equal(toCents(19.99), 1999);
  assert.equal(toCents("1999.99"), 199999);
  for (const bad of ["", "abc", "-1.00", "1.234", "1,50", null, undefined]) assert.equal(toCents(bad as never), null, String(bad));
  assert.equal(lineTotalCents("19.99", 3), 5997, "no float drift (19.99 × 3 = 59.97)");
  assert.equal(lineTotalCents("0.10", 3), 30, "0.1 × 3 is exactly 0.30");
});

// ---------------------------------------------------------------------------------------------------------------
// "Stokda yoxdur" vs. real variant problems

const inv = (variantId: string | null, quantity: number, reserved = 0) => ({ id: `inv-${variantId ?? "base"}`, variantId, quantity, reserved });

test("availability: too little stock is 'Stokda yoxdur' (simple product and variant); real variant problems keep the variant text", () => {
  const base = { productId: "p1", eligible: true, priceValid: true };
  const simple = cartItemAvailability({ ...base, variantId: null, variants: [], inventory: [inv(null, 0)], quantity: 1 });
  assert.deepEqual(simple, { available: 0, purchasable: false, unavailableReason: "Stokda yoxdur" });
  // CART-POLISH (owner decision): some stock left but less than the quantity -> the existing "Mövcud stok: N" pattern.
  assert.equal(cartItemAvailability({ ...base, variantId: null, variants: [], inventory: [inv(null, 2)], quantity: 3 }).unavailableReason, "Mövcud stok: 2", "less than the quantity");
  assert.equal(cartItemAvailability({ ...base, variantId: null, variants: [], inventory: [inv(null, 5, 5)], quantity: 1 }).unavailableReason, "Stokda yoxdur", "all reserved");
  const variants = [{ id: "v1", productId: "p1", isActive: true }, { id: "v2", productId: "p1", isActive: false }];
  assert.equal(cartItemAvailability({ ...base, variantId: "v1", variants, inventory: [inv("v1", 0)], quantity: 1 }).unavailableReason, "Stokda yoxdur", "active variant, no stock");
  assert.equal(cartItemAvailability({ ...base, variantId: "v2", variants, inventory: [inv("v2", 9)], quantity: 1 }).unavailableReason, CART_UNAVAILABLE_REASONS.variant, "inactive variant");
  assert.equal(cartItemAvailability({ ...base, variantId: "gone", variants, inventory: [], quantity: 1 }).unavailableReason, CART_UNAVAILABLE_REASONS.variant, "missing variant");
  assert.equal(cartItemAvailability({ ...base, variantId: null, variants, inventory: [inv(null, 9)], quantity: 1 }).unavailableReason, CART_UNAVAILABLE_REASONS.variant, "variant required");
  assert.equal(cartItemAvailability({ ...base, variantId: "v1", variants, inventory: [], quantity: 1 }).unavailableReason, CART_UNAVAILABLE_REASONS.variant, "no inventory row");
  assert.equal(cartItemAvailability({ ...base, eligible: false, variantId: null, variants: [], inventory: [inv(null, 0)], quantity: 1 }).unavailableReason, "Mağaza və ya məhsul əlçatan deyil", "store/product first");
  assert.equal(cartItemAvailability({ ...base, priceValid: false, variantId: null, variants: [], inventory: [inv(null, 3)], quantity: 1 }).unavailableReason, "Məhsul qiymətini yoxlamaq lazımdır");
  assert.deepEqual(cartItemAvailability({ ...base, variantId: null, variants: [], inventory: [inv(null, 3)], quantity: 2 }), { available: 3, purchasable: true, unavailableReason: null });
  // Order creation is unchanged: resolveVariantInventory still throws the same codes.
  assert.throws(() => resolveVariantInventory("p1", null, [], [inv(null, 0)], 1), /VARIANT_OUT_OF_STOCK/);
  assert.throws(() => resolveVariantInventory("p1", "v2", variants, [inv("v2", 9)], 1), /VARIANT_INACTIVE/);
  assert.match(read("app/api/orders/route.ts"), /const resolved=resolveVariantInventory\(product\.id,item\.variantId,product\.variants,product\.inventory,item\.quantity\);/);
});

// ---------------------------------------------------------------------------------------------------------------
// Cart, /api/cart and checkout wiring

test("/api/cart: adds only the two delivery settings (2-decimal strings) and uses the shared availability helper", () => {
  const api = read("app/api/cart/route.ts");
  assert.match(api, /store: \{ select: \{ id: true, name: true, cityId: true, deliveryFee: true, freeDeliveryThreshold: true \} \}/);
  assert.match(api, /store: \{ \.\.\.item\.product\.store, deliveryFee: item\.product\.store\.deliveryFee\.toFixed\(2\), freeDeliveryThreshold: item\.product\.store\.freeDeliveryThreshold\.toFixed\(2\) \}/);
  assert.match(api, /cartItemAvailability\(\{ productId: item\.productId, variantId: item\.variantId,/);
  assert.doesNotMatch(api, /Seçilən variant artıq əlçatan deyil/, "texts live in lib/cart-item-availability.ts");
});

test("cart page: per-store delivery block with the checkout's texts; summary Ara cəm / Çatdırılma / Cəmi; old note removed", () => {
  const cart = read("components/cart-page-client.tsx");
  assert.match(cart, /delivery: storeDeliveryCents\(group\.items\.reduce\(\(sum, item\) => sum \+ lineTotalCents\(item\.effectivePrice, item\.quantity\), 0\), \{ deliveryFee: group\.store\.deliveryFee, freeDeliveryThreshold: group\.store\.freeDeliveryThreshold \}\)/);
  assert.match(cart, /<span>Çatdırılma<\/span><b className="text-fg">\{group\.delivery\.freeDelivery \? "PULSUZ" : money\(group\.delivery\.deliveryFeeCents \/ 100\)\}<\/b>/);
  assert.match(cart, /\{centsToFixed\(group\.delivery\.freeDeliveryThresholdCents\)\} AZN və yuxarı sifarişlərdə çatdırılma pulsuzdur\./);
  assert.match(cart, /<span>Mağaza cəmi:<\/span><span>\{money\(group\.delivery\.storeTotalCents \/ 100\)\}<\/span>/);
  assert.match(cart, /<dt>Ara cəm<\/dt>[\s\S]*<dt>Çatdırılma<\/dt>[\s\S]*<dt>Cəmi<\/dt><dd>\{money\(totalCents \/ 100\)\}<\/dd>/);
  assert.match(cart, /const totalCents = subtotalCents \+ deliveryCents;/);
  assert.doesNotMatch(cart, /Çatdırılma xərci ünvan və sifariş təsdiqi mərhələsində dəqiqləşdiriləcək/);
  // The same texts already exist on the checkout (no new text besides "Stokda yoxdur").
  const form = read("components/checkout-form.tsx");
  for (const text of ['"PULSUZ"', "AZN və yuxarı sifarişlərdə çatdırılma pulsuzdur.", "Mağaza cəmi:", "Çatdırılma"]) assert.ok(form.includes(text), text);
  assert.match(read("components/cart-summary.tsx"), /<dt>Ara cəm<\/dt>[\s\S]*<dt>Çatdırılma<\/dt>/);
  // Ordering stays blocked by unavailable items.
  assert.match(cart, /const canCheckout = \(cart\?\.items \?\? \[\]\)\.every\(item => item\.purchasable && item\.available >= item\.quantity\);/);
});

test("checkout: the cart's item notes, confirm disabled while any item is unavailable, 'Səbətə keç' also for STORE_UNAVAILABLE", () => {
  const page = read("app/(customer)/checkout/page.tsx");
  assert.match(page, /const availability=cartItemAvailability\(\{productId:item\.product\.id,variantId:item\.variantId,/);
  assert.match(page, /hasUnavailable=\{stores\.some\(store=>store\.items\.some\(item=>item\.unavailableReason!==null\)\)\}/);
  const form = read("components/checkout-form.tsx");
  assert.match(form, /const CART_PROBLEM_CODES=\[\.\.\.ORDER_STOCK_ERROR_CODES,"STORE_UNAVAILABLE","PRODUCT_UNAVAILABLE","VARIANT_INVALID"\];/);
  assert.match(form, /if\(CART_PROBLEM_CODES\.includes\(data\.code\)\)\{setStockProblem\(true\);router\.refresh\(\)\}/);
  assert.match(form, /\{item\.unavailableReason&&<small data-checkout-item-unavailable="" className="block text-xs font-medium text-danger">\{item\.unavailableReason\}<\/small>\}/);
  assert.match(form, /disabled=\{busy\|\|!stores\.length\|\|!selected\|\|hasUnavailable\}/);
  assert.match(form, /\{hasUnavailable&&<div className="mt-3"><p role="alert"[^>]*>Mövcud olmayan və ya stoku dəyişmiş məhsulları silin və ya miqdarını yeniləyin\.<\/p><Link href="\/cart"[^>]*>Səbətə keç<\/Link><\/div>\}/);
  // Order creation, its codes and messages are untouched.
  const route = read("app/api/orders/route.ts");
  assert.match(route, /STORE_UNAVAILABLE:"Səbətdəki mağazalardan biri hazırda sifariş qəbul etmir\. Səbəti yeniləyin\."/);
});
