import test from "node:test";
import assert from "node:assert/strict";
import { generateProductCode } from "../lib/product-code.ts";

test("creates a readable code from an identifier without exposing internal formatting", () => {
  assert.equal(generateProductCode("12345678-abcd-4ef0-9876-123456789abc"), "BGT-12345678ABCD4EF0");
});

test("generates a code when the seller provides no identifier", () => {
  const code = generateProductCode();
  assert.match(code, /^BGT-[A-F0-9]{16}$/);
});

test("rejects identifiers too short to form a useful code", () => {
  assert.throws(() => generateProductCode("abc"), /PRODUCT_CODE_ID_INVALID/);
});

test("existing products with short legacy ids still get a code instead of an error", async () => {
  const { productCodeFor } = await import("../lib/product-code.ts");
  assert.match(productCodeFor("legacy-1"), /^BGT-[A-F0-9]{16}$/);
  assert.equal(productCodeFor("12345678-abcd-4ef0-9876-123456789abc"), "BGT-12345678ABCD4EF0");
});
