import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { checkImportRows } from "../lib/product-import";
import { normalizeSku, sameJsonValue, optionalSkuSchema } from "../lib/sku-normalization";
import { isSkuUniqueViolation } from "../lib/catalog-import-persistence";
import { adminProductUpdateSchema } from "../lib/admin-product-management";
import { vendorProductPatchSchema } from "../lib/vendor-product-patch";
import { legacyVendorProductPatchSchema, legacyVendorProductSchema, vendorProductCreateSchema } from "../lib/vendor-product-schemas";

test("SKU normalization unifies case, compatibility forms, and edge whitespace", () => {
  assert.equal(normalizeSku("  ＳＫＵ-Ə1\t"), normalizeSku("sku-Ə1"));
  assert.equal(normalizeSku("\t \r"), null);
});

test("SKU casing is ASCII-only and deterministic for Azerbaijani and Turkish letters", () => {
  assert.equal(normalizeSku("I"), "i");
  assert.equal(normalizeSku("i"), "i");
  assert.equal(normalizeSku("İ"), "İ");
  assert.equal(normalizeSku("ı"), "ı");
  assert.notEqual(normalizeSku("İ"), normalizeSku("i"));
  assert.notEqual(normalizeSku("ı"), normalizeSku("i"));
  assert.equal(normalizeSku("Ə"), "Ə");
  assert.equal(normalizeSku("ə"), "ə");
  assert.notEqual(normalizeSku("Ə"), normalizeSku("ə"));
});

test("SKU normalization applies NFKC before ASCII folding", () => {
  assert.equal(normalizeSku("ＦＵＬＬ－ＷＩＤＴＨ"), "full-width");
  assert.equal(normalizeSku("Kelvin"), "kelvin");
  assert.equal(normalizeSku("ﬃ"), "ffi");
  assert.equal(optionalSkuSchema.safeParse("ﬃ".repeat(27)).success, false);
});

test("SKU edge whitespace is exactly ASCII HT through CR and space", () => {
  assert.equal(normalizeSku("\t\n SKU \r"), "sku");
  assert.equal(normalizeSku("\u00a0SKU\u00a0"), "sku");
  assert.equal(normalizeSku("\u2003SKU\u2003"), "sku");
  assert.equal(normalizeSku("\u200bSKU\u200b"), "\u200bsku\u200b");
  assert.equal(normalizeSku("A B"), "a b");
});

test("manual seller create and update schemas persist the shared canonical SKU", () => {
  const create = vendorProductCreateSchema.parse({
    name: "Bag", sku: " \tＳＫＵ-1\r", price: 10, variants: [{ name: "Small", sku: " Ｖ-1 " }],
  });
  assert.equal(create.sku, "sku-1");
  assert.equal(create.variants[0].sku, "v-1");

  const legacyCreate = legacyVendorProductSchema.parse({
    name: "Bag", price: 10, sku: " SKU-2 ", variants: [{ name: "Small", options: { size: "S" }, sku: " V-2 " }],
  });
  assert.equal(legacyCreate.sku, "sku-2");
  assert.equal(legacyCreate.variants[0].sku, "v-2");

  const patch = vendorProductPatchSchema.parse({
    name: "Bag", description: null, sku: " SKU-3 ", price: 10, discountPrice: null,
    categoryId: null, brandId: null, images: [], status: "DRAFT",
    variants: [{ name: "Small", sku: " V-3 ", options: { size: "S" }, quantity: 0, lowStockThreshold: 5 }],
  });
  assert.equal(patch.sku, "sku-3");
  assert.equal(patch.variants?.[0].sku, "v-3");
  assert.equal(legacyVendorProductPatchSchema.parse({ id: "p1" }).sku, undefined);
});

test("admin product and variant writes use the same canonical SKU contract", () => {
  const admin = adminProductUpdateSchema.parse({
    name: "Bag", description: null, sku: " ＳＫＵ-4 ", categoryId: null, brandId: null,
    price: 10, discountPrice: null, images: [], quantity: 0, lowStockThreshold: 5,
    variants: [{ id: "v1", name: "Small", sku: " Ｖ-4 ", isActive: true, price: null, discountPrice: null, quantity: 0, lowStockThreshold: 5 }],
  });
  assert.equal(admin.sku, "sku-4");
  assert.equal(admin.variants[0].sku, "v-4");
});

test("SKU schemas reject NUL and malformed UTF-16 while keeping product and variant namespaces separate", () => {
  assert.equal(vendorProductCreateSchema.safeParse({ name: "Bag", price: 10, sku: "A\u0000B" }).success, false);
  assert.equal(vendorProductCreateSchema.safeParse({ name: "Bag", price: 10, sku: "\ud800" }).success, false);
  const sameValueInSeparateNamespaces = vendorProductCreateSchema.parse({
    name: "Bag", price: 10, sku: "shared", variants: [{ name: "Small", sku: "SHARED" }],
  });
  assert.equal(sameValueInSeparateNamespaces.sku, "shared");
  assert.equal(sameValueInSeparateNamespaces.variants[0].sku, "shared");
});

test("duplicate SKU error classification only handles SKU unique constraints", () => {
  assert.equal(isSkuUniqueViolation({ code: "P2002", meta: { target: ["sku"] } }), true);
  assert.equal(isSkuUniqueViolation({ code: "P2002", meta: { target: "ProductVariant_sku_canonical_key" } }), true);
  assert.equal(isSkuUniqueViolation({ code: "P2002", meta: { target: ["slug"] } }), false);
  assert.equal(isSkuUniqueViolation({ code: "P2003", meta: { target: ["sku"] } }), false);
});

test("legacy import validation matches SKUs by the unified normalization policy", () => {
  const checked = checkImportRows({
    rows: [{ name: "Bag", sku: "  ＳＫＵ-1 ", price: "10", category: "bags" }],
    mapping: { name: "name", sku: "sku", price: "price", category: "category" },
    mode: "mixed",
    categories: [{ id: "category-a", name: "Bags", slug: "bags" }],
    brands: [],
    existing: [{ id: "product-1", sku: "sku-1" }],
  });
  assert.equal(checked[0].action, "update");
  assert.equal(checked[0].existingId, "product-1");
});

test("variant SKU collisions against existing catalog and within the source become row errors", () => {
  const checked = checkImportRows({
    rows: [
      { name: "First", sku: "P-1", price: "10", category: "bags", variants: JSON.stringify([{ name: "S", sku: "  Ｖ-1 ", options: { size: "S" } }]) },
      { name: "Second", sku: "P-2", price: "10", category: "bags", variants: JSON.stringify([{ name: "M", sku: "v-1", options: { size: "M" } }]) },
      { name: "Third", sku: "P-3", price: "10", category: "bags", variants: JSON.stringify([{ name: "L", sku: "existing-v", options: { size: "L" } }]) },
    ],
    mapping: { name: "name", sku: "sku", price: "price", category: "category", variants: "variants" },
    mode: "create",
    categories: [{ id: "category-a", name: "Bags", slug: "bags" }],
    brands: [],
    existing: [],
    existingVariantSkuKeys: new Set(["existing-v"]),
  });
  assert.equal(checked[0].status, "VALID");
  assert.match(checked[1].errors.join(" "), /Variant 1: SKU artıq mövcuddur/);
  assert.match(checked[2].errors.join(" "), /SKU artıq mövcuddur/);
});

test("staging replay comparison ignores object-key order but rejects changed values", () => {
  assert.equal(sameJsonValue({ b: 2, a: 1 }, { a: 1, b: 2 }), true);
  assert.equal(sameJsonValue({ sku: "A" }, { sku: "B" }), false);
});

test("product and variant SKU namespaces retain their existing separate scopes", async () => {
  const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = await readFile(new URL("../prisma/migrations/20261106030000_canonical_sku_uniqueness/migration.sql", import.meta.url), "utf8");
  assert.match(schema, /@@unique\(\[storeId, sku\]\)/);
  assert.match(schema, /sku\s+String\?\s+@unique/);
  assert.match(migration, /ON "Product"[\s\S]*?"storeId"[\s\S]*?WHERE/);
  assert.match(migration, /ON "ProductVariant"[\s\S]*?WHERE/);
  assert.doesNotMatch(migration, /lower\s*\(/i);
  assert.match(migration, /COLLATE "C"/);
});
