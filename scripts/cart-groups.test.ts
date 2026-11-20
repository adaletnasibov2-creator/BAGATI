/**
 * CART-GROUPS (audit, 2026-11-20): the cart and the checkout already group a multi-store cart by store, and the
 * checkout shows the same per-store subtotal / delivery / total that order creation stores. These tests pin that, so
 * a later change cannot silently make the page and the order disagree. The browser check (3 stores, one scratch
 * order) is in release-output/cart-groups/.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { calculateStoreDelivery } from "../lib/delivery";
import { calculateEffectivePrice } from "../lib/promotion-pricing";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");

test("cart page: one card per store (store link, its items, the store's item subtotal), grand total in the summary", () => {
  const cart = read("components/cart-page-client.tsx");
  assert.match(cart, /const group = map\.get\(item\.product\.store\.id\) \?\? \{ store: item\.product\.store, items: \[\] \}/, "grouped by store id");
  assert.match(cart, /<section key=\{group\.store\.id\} data-cart-store=""/);
  assert.match(cart, /<Link href=\{`\/stores\/\$\{group\.store\.id\}`\}[^>]*>\{group\.store\.name\}<\/Link>/);
  // CART-POLISH (owner decision): the top "Mağaza üzrə cəm" line is removed; each card ends with "Mağaza cəmi:".
  assert.doesNotMatch(cart, /Mağaza üzrə cəm/);
  assert.match(cart, /<span>Mağaza cəmi:<\/span><span>\{money\(group\.delivery\.storeTotalCents \/ 100\)\}<\/span>/);
  assert.match(cart, /\{groups\.length\} mağazadan məhsullar<\/p>/);
  // Updated consciously by CART-DELIVERY (owner decision 2026-11-20): the cart now shows each store's delivery and a
  // total including delivery, /api/cart returns the two delivery settings, and the misleading note
  // "Çatdırılma xərci ünvan və sifariş təsdiqi mərhələsində dəqiqləşdiriləcək." is gone (scripts/cart-delivery.test.ts).
  assert.doesNotMatch(cart, /Çatdırılma xərci ünvan və sifariş təsdiqi mərhələsində dəqiqləşdiriləcək\./);
  assert.match(read("app/api/cart/route.ts"), /store: \{ select: \{ id: true, name: true, cityId: true, deliveryFee: true, freeDeliveryThreshold: true \} \}/);
});

test("checkout page and order creation use the same price and delivery helpers, grouped by store", () => {
  const page = read("app/(customer)/checkout/page.tsx");
  const route = read("app/api/orders/route.ts");
  for (const [name, source] of [["checkout page", page], ["POST /api/orders", route]] as const) {
    assert.match(source, /calculateVariantEffectivePrice\(\{productPrice:/, `${name}: effective unit price`);
    assert.match(source, /calculateStoreDelivery\([a-zA-Z.]*ubtotal,\{freeDeliveryThreshold:[a-z.]*\.freeDeliveryThreshold[^,]*,deliveryFee:[a-z.]*\.deliveryFee/, `${name}: per-store delivery`);
  }
  assert.match(page, /storeTotal:group\.subtotal\.add\(delivery\.deliveryFee\)\.toNumber\(\)/);
  assert.match(route, /return \{storeId,subtotal:storeSubtotal,deliveryFee:delivery\.deliveryFee,storeTotal:storeSubtotal\.add\(delivery\.deliveryFee\),lines\};/);
  const form = read("components/checkout-form.tsx");
  assert.match(form, /Mağaza cəmi: \{store\.storeTotal\.toFixed\(2\)\} AZN/);
  assert.match(form, /<CartSummary subtotal=\{subtotal\.toFixed\(2\)\} deliveryFee=\{deliveryTotal\.toFixed\(2\)\} total=\{total\.toFixed\(2\)\} totalLabel="Sifarişin cəmi"\/>/);
});

test("the numbers of the browser check: 3 stores, fee / free threshold per store, grand total", () => {
  const stores = [
    { subtotal: "520.00", deliveryFee: "5.00", freeDeliveryThreshold: "100.00" },
    { subtotal: "35.00", deliveryFee: "4.00", freeDeliveryThreshold: "50.00" },
    { subtotal: "18.00", deliveryFee: "3.00", freeDeliveryThreshold: "200.00" },
  ].map((store) => calculateStoreDelivery(store.subtotal, store));
  assert.deepEqual(stores.map((store) => [store.deliveryFee.toFixed(2), store.freeDelivery]), [["0.00", true], ["4.00", false], ["3.00", false]]);
  const total = stores.reduce((sum, store) => sum.add(store.subtotal).add(store.deliveryFee), new Prisma.Decimal(0));
  assert.equal(total.toFixed(2), "580.00", "what the page showed and the server stored (573 + 7)");
  assert.equal(calculateStoreDelivery("100.00", { freeDeliveryThreshold: "100.00", deliveryFee: "5.00" }).deliveryFee.toFixed(2), "0.00", "free from the threshold itself");
});

test("campaign prices are rounded to 2 decimals, so the cart's 2-decimal price equals the unit price the order stores", () => {
  // 33.33 − 15 % = 28.3305 → stored and shown as 28.33 (ROUND_HALF_UP in lib/promotion-pricing.ts).
  const promotion = { id: "p", name: "Kampaniya", isActive: true, startsAt: new Date(0), endsAt: new Date(8.64e15), discountType: "PERCENT", discountValue: new Prisma.Decimal("15"), storeId: null };
  const effective = calculateEffectivePrice(new Prisma.Decimal("33.33"), null, [promotion as never], new Date());
  assert.equal(effective.promotion?.name, "Kampaniya", "the campaign applies");
  assert.equal(effective.unitPrice.toString(), "28.33");
  assert.equal(effective.unitPrice.toFixed(2), "28.33", "the cart API's effectivePrice string is the same value");
});

test("no Epoint 500 AZN warning exists in the cart or checkout today (audit fact, CART-GROUPS c)", () => {
  // Kept unchanged by CART-DELIVERY: the owner waits for Epoint's documentation before any 500 AZN warning or limit.
  for (const path of ["components/cart-page-client.tsx", "components/checkout-form.tsx", "app/(customer)/checkout/page.tsx", "components/cart-summary.tsx", "lib/delivery-cents.ts", "lib/cart-item-availability.ts", "app/api/cart/route.ts"]) {
    assert.doesNotMatch(read(path), /\b500\b/, path);
  }
});
