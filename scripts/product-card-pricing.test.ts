import assert from "node:assert/strict";
import test from "node:test";
import { getProductDiscount } from "../lib/product-card-pricing";

test("product card discount is calculated only from a lower current price", () => {
  assert.deepEqual(getProductDiscount("80.00", "100.00"), {
    discounted: true,
    percentOff: 20,
  });
  assert.deepEqual(getProductDiscount("100.00", "100.00"), {
    discounted: false,
    percentOff: null,
  });
  assert.deepEqual(getProductDiscount("120.00", "100.00"), {
    discounted: false,
    percentOff: null,
  });
});

test("invalid and sub-half-percent prices never produce a fabricated percentage", () => {
  assert.deepEqual(getProductDiscount("0", "100"), {
    discounted: false,
    percentOff: null,
  });
  assert.deepEqual(getProductDiscount("not-a-price", "100"), {
    discounted: false,
    percentOff: null,
  });
  assert.deepEqual(getProductDiscount("99.75", "100"), {
    discounted: true,
    percentOff: null,
  });
});
