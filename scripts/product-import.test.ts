import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { checkImportRows, isSafeImportImageUrl } from "../lib/product-import";
import { ImportParseError, parseDelimited, parseImportByExtension } from "../lib/import-parsers";

test("CSV import parser strips BOM and preserves quoted delimiters", () => {
  const parsed = parseDelimited('\uFEFFname,sku,description\r\nBag,SKU-1,"leather, ""soft"""\r\n');
  assert.deepEqual(parsed.headers, ["name", "sku", "description"]);
  assert.deepEqual(parsed.rows, [{ name: "Bag", sku: "SKU-1", description: 'leather, "soft"' }]);
});

test("mixed import updates matching SKUs, creates new rows, and rejects invalid discounts", () => {
  const checked = checkImportRows({
    rows: [
      { name: "Updated", sku: " SKU-1 ", price: "31.00", discount: "28.00", category: "bags", quantity: "9" },
      { name: "New", sku: "SKU-2", price: "19.50", discount: "", category: "Bags", quantity: "6" },
      { name: "Invalid", sku: "SKU-3", price: "10", discount: "12", category: "bags", quantity: "3" },
    ],
    mapping: { name: "name", sku: "sku", price: "price", discountPrice: "discount", category: "category", quantity: "quantity" },
    mode: "mixed",
    categories: [{ id: "category-1", name: "Bags", slug: "bags" }],
    brands: [],
    existing: [{ id: "product-1", sku: "sku-1" }],
  });

  assert.equal(checked[0].status, "VALID");
  assert.equal(checked[0].action, "update");
  assert.equal(checked[0].existingId, "product-1");
  assert.equal(checked[1].status, "VALID");
  assert.equal(checked[1].action, "create");
  assert.equal(checked[1].product.categoryId, "category-1");
  assert.equal(checked[2].status, "INVALID");
  assert.ok(checked[2].errors.some((error) => error.includes("Endirimli qiymət")));
});

test("update mode rejects unknown SKUs and create mode rejects existing SKUs", () => {
  const common = {
    rows: [{ name: "Bag", sku: "SKU-1", price: "10", category: "bags" }],
    mapping: { name: "name", sku: "sku", price: "price", category: "category" },
    categories: [{ id: "category-1", name: "Bags", slug: "bags" }],
    brands: [],
    existing: [{ id: "product-1", sku: "SKU-1" }],
  };

  assert.match(checkImportRows({ ...common, mode: "create" })[0].errors.join(" "), /Məhsul kodu artıq mövcuddur/);
  assert.match(
    checkImportRows({ ...common, rows: [{ ...common.rows[0], sku: "UNKNOWN" }], mode: "update" })[0].errors.join(" "),
    /Yeniləmək üçün məhsul kodu tapılmadı/,
  );
});

test("imports validate image URLs, variant values, and reject unsupported variant updates", () => {
  assert.equal(isSafeImportImageUrl("https://cdn.example.test/product.webp"), true);
  assert.equal(isSafeImportImageUrl("javascript:alert(1)"), false);
  assert.equal(isSafeImportImageUrl("//cdn.example.test/product.webp"), false);

  const base = {
    mapping: { name: "name", sku: "sku", price: "price", category: "category", variants: "variants" },
    categories: [{ id: "category-1", name: "Bags", slug: "bags" }],
    brands: [],
    existing: [{ id: "product-1", sku: "SKU-1" }],
  };
  const variants = JSON.stringify([{ name: "Small", options: { size: "S" }, quantity: 3, price: 10, discountPrice: 11 }]);
  const create = checkImportRows({
    ...base,
    mode: "create",
    rows: [{ name: "Bag", sku: "SKU-2", price: "12", category: "bags", variants }],
  })[0];
  assert.equal(create.status, "INVALID");
  assert.ok(create.errors.some((error) => error.includes("Variant 1")));

  const update = checkImportRows({
    ...base,
    mode: "update",
    rows: [{ name: "Bag", sku: "SKU-1", price: "12", category: "bags", variants: JSON.stringify([{ name: "Small", options: { size: "S" }, quantity: 3 }]) }],
  })[0];
  assert.equal(update.status, "INVALID");
  assert.ok(update.errors.some((error) => error.includes("variantları idxalla yenilənmir")));
});

test("import validation rejects unsafe or non-store-owned images and quantities below reservations", () => {
  const base = {
    rows: [{ name: "Bag", sku: "SKU-1", price: "12", category: "bags", quantity: "3", images: "https://cdn.example.test/bag.webp" }],
    mapping: { name: "name", sku: "sku", price: "price", category: "category", quantity: "quantity", images: "images" },
    mode: "update" as const,
    categories: [{ id: "category-1", name: "Bags", slug: "bags" }],
    brands: [],
    existing: [{ id: "product-1", sku: "SKU-1", inventory: { quantity: 8, reserved: 4 } }],
  };
  const rejected = checkImportRows({ ...base, isImageUrlAllowed: () => false })[0];
  assert.equal(rejected.status, "INVALID");
  assert.ok(rejected.errors.some((error) => error.includes("mağazaya aid deyil")));
  assert.ok(rejected.errors.some((error) => error.includes("rezerv edilmiş stokdan az")));

  const accepted = checkImportRows({ ...base, rows: [{ ...base.rows[0], quantity: "4" }], isImageUrlAllowed: isSafeImportImageUrl })[0];
  assert.equal(accepted.status, "VALID");
});

test("vendor import POST enforces feature entitlement and locks/rechecks inventory before writes", async () => {
  const route = await readFile(new URL("../app/api/vendor/[storeId]/[section]/route.ts", import.meta.url), "utf8");
  const postStart = route.indexOf('if(section==="imports"){', route.indexOf("export async function POST"));
  const postEnd = route.indexOf('return NextResponse.json({error:"Bu əməliyyat', postStart);
  assert.ok(postStart >= 0);
  assert.ok(postEnd > postStart);
  const postImports = route.slice(postStart, postEnd);
  assert.match(postImports, /assertFeature\(entitlement,"BULK_IMPORT"\)/);
  assert.match(postImports, /FOR UPDATE/);
  assert.match(postImports, /typeof row\.product\.quantity==="number"&&row\.product\.quantity<inv\.reserved/);
  assert.match(postImports, /typeof value\.quantity==="number"/);
  assert.match(postImports, /isOwnedStoreAssetUrl\(storeId,url\)/);
});

test("unsupported server-side import extensions fail explicitly", () => {
  assert.throws(() => parseImportByExtension("catalog.xlsx", "not parsed server-side"), ImportParseError);
});
