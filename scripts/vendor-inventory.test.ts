import assert from "node:assert/strict";
import { test } from "node:test";
import { countProductsWithLowStock, matchesProductStockFilter } from "@/lib/vendor-inventory";

test("low stock is checked per purchasable variant, not against aggregate variant quantity", () => {
  assert.equal(countProductsWithLowStock([
    {
      inventory: [{ quantity: 100, reserved: 0, lowStockThreshold: 5 }],
      variants: [
        { inventory: [{ quantity: 8, reserved: 4, lowStockThreshold: 5 }] },
        { inventory: [{ quantity: 9, reserved: 5, lowStockThreshold: 5 }] },
      ],
    },
  ]), 1);
});

test("standard inventory, reservations, and zero stock retain product-level counting", () => {
  assert.equal(countProductsWithLowStock([
    { inventory: [{ quantity: 10, reserved: 6, lowStockThreshold: 5 }], variants: [] },
    { inventory: [{ quantity: 10, reserved: 2, lowStockThreshold: 5 }], variants: [] },
    { inventory: [{ quantity: 0, reserved: 0, lowStockThreshold: 5 }], variants: [] },
  ]), 2);
});

test("variant stock supersedes standard inventory and product is counted only once", () => {
  assert.equal(countProductsWithLowStock([
    {
      inventory: [{ quantity: 0, reserved: 0, lowStockThreshold: 5 }],
      variants: [
        { inventory: [{ quantity: 0, reserved: 0, lowStockThreshold: 5 }] },
        { inventory: [{ quantity: 20, reserved: 0, lowStockThreshold: 5 }] },
      ],
    },
  ]), 1);
});

test("product stock filters evaluate each active variant using its own threshold", () => {
  const product = {
    inventory: [],
    variants: [
      { inventory: [{ quantity: 8, reserved: 4, lowStockThreshold: 5 }] },
      { inventory: [{ quantity: 40, reserved: 0, lowStockThreshold: 2 }] },
    ],
  };
  assert.equal(matchesProductStockFilter(product, "low"), true);
  assert.equal(matchesProductStockFilter(product, "out"), false);
  assert.equal(matchesProductStockFilter({ inventory: [], variants: [] }, "out"), true);
});
