import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { productCategoryChoiceError, readCategoryParentId } from "../lib/product-category-choice";
import { adminProductUpdateSchema } from "../lib/admin-product-management";

const db = {
  category: {
    findMany: async () => [
      { id: "el", parentId: null, isActive: true },
      { id: "tel", parentId: "el", isActive: true },
      { id: "dg", parentId: null, isActive: true },
      { id: "old", parentId: null, isActive: false },
    ],
  },
};

test("server rule: new product under a top-level with subcategories must pick one", async () => {
  assert.equal(await productCategoryChoiceError(db, { categoryId: "el" }), "Bu kateqoriyanın alt kateqoriyaları var: alt kateqoriya seçin.");
  assert.equal(await productCategoryChoiceError(db, { categoryId: "tel", expectedParentId: "el" }), null);
  assert.equal(await productCategoryChoiceError(db, { categoryId: "tel", expectedParentId: "dg" }), "Alt kateqoriya seçilmiş üst kateqoriyaya aid deyil.");
  assert.equal(await productCategoryChoiceError(db, { categoryId: "dg" }), null);
  assert.equal(await productCategoryChoiceError(db, { categoryId: null }), null);
  assert.equal(await productCategoryChoiceError(db, { categoryId: "nope" }), "Kateqoriya tapılmadı.");
  assert.equal(await productCategoryChoiceError(db, { categoryId: "old" }), "Aktiv kateqoriya tapılmadı.");
});

test("server rule: editing an old product without a subcategory is not blocked unless the category changes", async () => {
  assert.equal(await productCategoryChoiceError(db, { categoryId: "el", previousCategoryId: "el" }), null);
  assert.equal(await productCategoryChoiceError(db, { categoryId: "old", previousCategoryId: "old" }), null);
  assert.equal(await productCategoryChoiceError(db, { categoryId: "el", previousCategoryId: "dg" }), "Bu kateqoriyanın alt kateqoriyaları var: alt kateqoriya seçin.");
});

test("categoryParentId is read from the raw body and accepted by the strict admin schema", () => {
  assert.equal(readCategoryParentId({ categoryParentId: "el" }), "el");
  assert.equal(readCategoryParentId({ categoryParentId: "" }), null);
  assert.equal(readCategoryParentId({}), null);
  assert.equal(readCategoryParentId(null), null);
  const valid = { name: "Telefon", description: null, sku: null, categoryId: "tel", categoryParentId: "el", brandId: null, price: 10, discountPrice: null, images: [], quantity: 1, lowStockThreshold: 1, variants: [] };
  assert.equal(adminProductUpdateSchema.safeParse(valid).success, true);
});

test("every product write path runs the category choice check", () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
  for (const path of [
    "app/api/vendor/[storeId]/products/route.ts",
    "app/api/vendor/[storeId]/products/[productId]/route.ts",
    "app/api/admin/products/[productId]/route.ts",
  ]) assert.match(read(path), /productCategoryChoiceError\(/, path);
  assert.equal(read("app/api/vendor/[storeId]/[section]/route.ts").match(/productCategoryChoiceError\(/g)?.length, 2, "legacy create and patch");
  assert.match(read("app/api/vendor/[storeId]/products/[productId]/route.ts"), /previousCategoryId: existing \? existing\.categoryId : undefined/);
  assert.match(read("app/api/admin/products/[productId]/route.ts"), /previousCategoryId: product\.categoryId/);
});
