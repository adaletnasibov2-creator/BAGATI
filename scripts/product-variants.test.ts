import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import {
  assertUniqueVariantCombinations,
  calculateVariantEffectivePrice,
  cartVariantKey,
  isVariantForProduct,
  isVariantOwnedByStore,
  orderVariantSnapshot,
  quantityAfterSale,
  resolveVariantInventory,
} from "../lib/product-variants";

const variants = [
  { id: "red", productId: "p1", isActive: true },
  { id: "blue", productId: "p1", isActive: true },
];
const inventory = [
  { id: "stock-red", variantId: "red", quantity: 5, reserved: 1 },
  { id: "stock-blue", variantId: "blue", quantity: 2, reserved: 2 },
];

test("variant ownership checks are scoped to the product and store", () => {
  assert.equal(isVariantForProduct(variants[0], "p1"), true);
  assert.equal(isVariantForProduct(variants[0], "p2"), false);
  assert.equal(isVariantOwnedByStore({ product: { storeId: "s1" } }, "s1"), true);
  assert.equal(isVariantOwnedByStore({ product: { storeId: "s1" } }, "s2"), false);
});

test("duplicate option combinations are rejected after normalization", () => {
  assert.throws(() => assertUniqueVariantCombinations([
    { name: "Qırmızı", options: { Rəng: "Qırmızı", Ölçü: "M" } },
    { name: "red medium", options: { ölçü: "m", rəng: "qırmızı" } },
  ]), /DUPLICATE_VARIANT_COMBINATION/);
  assert.doesNotThrow(() => assertUniqueVariantCombinations([
    { name: "Qırmızı", options: { Rəng: "Qırmızı" } },
    { name: "Mavi", options: { Rəng: "Mavi" } },
  ]));
});

test("selection requires a variant for variant products and rejects cross-product IDs", () => {
  assert.throws(() => resolveVariantInventory("p1", null, variants, inventory, 1), /VARIANT_REQUIRED/);
  assert.throws(() => resolveVariantInventory("p2", "red", variants, inventory, 1), /VARIANT_INVALID/);
  assert.throws(() => resolveVariantInventory("p1", "missing", variants, inventory, 1), /VARIANT_INVALID/);
});

test("inactive and unavailable variants cannot be purchased", () => {
  assert.throws(() => resolveVariantInventory("p1", "red", [{ ...variants[0], isActive: false }], inventory, 1), /VARIANT_INACTIVE/);
  assert.throws(() => resolveVariantInventory("p1", "blue", variants, inventory, 1), /VARIANT_OUT_OF_STOCK/);
  assert.throws(() => resolveVariantInventory("p1", "red", variants, inventory, 5), /VARIANT_OUT_OF_STOCK/);
});

test("selection returns only the selected variant inventory and sale quantity is exact", () => {
  const selected = resolveVariantInventory("p1", "red", variants, inventory, 3);
  assert.equal(selected.inventory.id, "stock-red");
  assert.equal(selected.available, 4);
  assert.equal(quantityAfterSale(selected.inventory.quantity, selected.inventory.reserved, 3), 2);
  assert.throws(() => quantityAfterSale(2, 1, 2), /VARIANT_OUT_OF_STOCK/);
});

test("cart keys keep products and each variant as separate lines", () => {
  assert.notEqual(cartVariantKey("p1", "red"), cartVariantKey("p1", "blue"));
  assert.notEqual(cartVariantKey("p1", null), cartVariantKey("p1", "red"));
  assert.notEqual(cartVariantKey("p1", "red"), cartVariantKey("p2", "red"));
});

test("order snapshots preserve name and option values independently of later edits", () => {
  const options = { Rəng: "Qırmızı", Ölçü: "M" };
  const snapshot = orderVariantSnapshot({ name: "Qırmızı / M", options: options as Prisma.JsonValue });
  options.Rəng = "Mavi";
  assert.equal(snapshot.variantName, "Qırmızı / M");
  assert.deepEqual(snapshot.variantOptions, { Rəng: "Qırmızı", Ölçü: "M" });
});

test("standard products keep null variant snapshots", () => {
  const snapshot = orderVariantSnapshot(null);
  assert.equal(snapshot.variantName, null);
  assert.equal(snapshot.variantOptions, Prisma.DbNull);
});

test("variant pricing uses its override, campaign dates and one discount only", () => {
  const now = new Date("2026-10-07T12:00:00.000Z");
  const promotion = { id: "promo", storeId: "s1", name: "Endirim", startsAt: new Date("2026-10-01"), endsAt: new Date("2026-10-31"), isActive: true, discountType: "PERCENT", discountValue: 10 };
  const result = calculateVariantEffectivePrice({ productPrice: 100, productDiscountPrice: 80, variant: { price: 50, discountPrice: 40 }, promotions: [{ promotion }], storeId: "s1", now });
  assert.equal(result.basePrice.toFixed(2), "50.00");
  assert.equal(result.unitPrice.toFixed(2), "45.00");
  assert.equal(result.discountAmount.toFixed(2), "5.00");
  assert.equal(result.promotion?.id, "promo");
});

test("expired promotions do not affect variant price", () => {
  const promotion = { id: "old", storeId: "s1", name: "Köhnə", startsAt: new Date("2026-09-01"), endsAt: new Date("2026-10-01"), isActive: true, discountType: "PERCENT", discountValue: 50 };
  const result = calculateVariantEffectivePrice({ productPrice: 100, productDiscountPrice: null, variant: { price: 80, discountPrice: null }, promotions: [{ promotion }], storeId: "s1", now: new Date("2026-10-07") });
  assert.equal(result.unitPrice.toFixed(2), "80.00");
  assert.equal(result.promotion, null);
});
