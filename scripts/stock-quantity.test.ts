import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { checkImportRows } from "../lib/product-import";
import { optionalStockQuantitySchema, parseStockQuantity, requiredStockQuantitySchema } from "../lib/stock-quantity";

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("missing, empty, invalid, and explicit zero stock stay distinct", () => {
  assert.deepEqual(parseStockQuantity(undefined), { ok: true, omitted: true });
  assert.deepEqual(parseStockQuantity(""), { ok: false });
  assert.deepEqual(parseStockQuantity("   "), { ok: false });
  assert.deepEqual(parseStockQuantity(null), { ok: false });
  assert.deepEqual(parseStockQuantity("abc"), { ok: false });
  assert.deepEqual(parseStockQuantity("1.5"), { ok: false });
  assert.deepEqual(parseStockQuantity("-1"), { ok: false });
  assert.deepEqual(parseStockQuantity(1.5), { ok: false });
  assert.deepEqual(parseStockQuantity(0), { ok: true, omitted: false, value: 0 });
  assert.deepEqual(parseStockQuantity("0"), { ok: true, omitted: false, value: 0 });
  assert.deepEqual(parseStockQuantity(" 18 "), { ok: true, omitted: false, value: 18 });

  assert.equal(requiredStockQuantitySchema.safeParse(undefined).success, false);
  assert.equal(requiredStockQuantitySchema.safeParse("").success, false);
  assert.equal(requiredStockQuantitySchema.safeParse(null).success, false);
  assert.equal(requiredStockQuantitySchema.safeParse("nope").success, false);
  assert.equal(requiredStockQuantitySchema.parse(0), 0);
  assert.equal(requiredStockQuantitySchema.parse("0"), 0);
  assert.equal(optionalStockQuantitySchema.parse(undefined), undefined);
  assert.equal(optionalStockQuantitySchema.default(0).parse(undefined), 0);
  assert.equal(optionalStockQuantitySchema.default(0).safeParse("").success, false);
  assert.equal(optionalStockQuantitySchema.default(0).parse("7"), 7);
});

test("seller stock writers no longer coerce an empty field to zero", async () => {
  const [products, section, editor, variants, createForm, inventory, productSchemas] = await Promise.all([
    source("app/api/vendor/[storeId]/products/route.ts"),
    source("app/api/vendor/[storeId]/[section]/route.ts"),
    source("components/vendor-product-editor.tsx"),
    source("components/vendor-variant-editor.tsx"),
    source("components/vendor-product-create-form.tsx"),
    source("components/vendor-section.tsx"),
    source("lib/vendor-product-schemas.ts"),
  ]);
  for (const file of [products, section]) {
    assert.doesNotMatch(file, /quantity:z\.coerce|quantity: z\.coerce/);
  }
  assert.match(products, /vendorProductCreateSchema/);
  assert.match(productSchemas, /quantity: optionalStockQuantitySchema\.default\(0\)/);
  assert.match(section, /quantity:requiredStockQuantitySchema/);
  assert.match(editor, /presentStockQuantity\(form\.quantity\)/);
  assert.match(variants, /presentStockQuantity\(row\.quantity\)/);
  assert.match(inventory, /presentStockQuantity\(body\.quantity\)/);
  assert.doesNotMatch(variants, /quantity: Number\(row\.quantity\)/);
  assert.doesNotMatch(createForm, /Number\(form\.get\("quantity"\) \|\| 0\)/);
  assert.match(inventory, /if\(!fd\.has\("quantity"\)\)e\.currentTarget\.reset\(\)/);
});

test("a blank import stock cell does not plan a zero overwrite, while explicit zero does", () => {
  const common = {
    mapping: { name: "name", sku: "sku", price: "price", category: "category", quantity: "quantity" },
    categories: [{ id: "category-1", name: "Bags", slug: "bags" }],
    brands: [],
    existing: [{ id: "product-1", sku: "SKU-1", inventory: { quantity: 8, reserved: 2 } }],
  };
  const blankUpdate = checkImportRows({
    ...common,
    mode: "update",
    rows: [{ name: "Bag", sku: "SKU-1", price: "10", category: "bags", quantity: "" }],
  })[0];
  assert.equal(blankUpdate.status, "VALID");
  assert.equal(blankUpdate.action, "update");
  assert.equal(blankUpdate.product.quantity, null);

  const explicitZero = checkImportRows({
    ...common,
    mode: "update",
    existing: [{ id: "product-1", sku: "SKU-1", inventory: { quantity: 8, reserved: 0 } }],
    rows: [{ name: "Bag", sku: "SKU-1", price: "10", category: "bags", quantity: "0" }],
  })[0];
  assert.equal(explicitZero.status, "VALID");
  assert.equal(explicitZero.product.quantity, 0);
  const belowReserved = checkImportRows({
    ...common,
    mode: "update",
    rows: [{ name: "Bag", sku: "SKU-1", price: "10", category: "bags", quantity: "0" }],
  })[0];
  assert.equal(belowReserved.status, "INVALID");

  const created = checkImportRows({
    ...common,
    mode: "create",
    existing: [],
    rows: [{ name: "Bag", sku: "SKU-2", price: "10", category: "bags", quantity: "" }],
  })[0];
  assert.equal(created.action, "create");
  assert.equal(created.product.quantity, 0);

  const invalid = checkImportRows({
    ...common,
    mode: "update",
    rows: [{ name: "Bag", sku: "SKU-1", price: "10", category: "bags", quantity: "1.5" }],
  })[0];
  assert.equal(invalid.status, "INVALID");
});
