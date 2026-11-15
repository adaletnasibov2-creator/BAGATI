import assert from "node:assert/strict";
import test from "node:test";
import { checkImportRows, resolveImportCategory, type ImportCategory } from "../lib/product-import";

const categories: ImportCategory[] = [
  { id: "el", name: "Elektronika", slug: "elektronika", parentId: null },
  { id: "tel", name: "Telefonlar", slug: "telefonlar", parentId: "el" },
  { id: "ak", name: "Aksesuarlar", slug: "aksesuarlar", parentId: null },
  { id: "saat", name: "Saatlar", slug: "saatlar", parentId: "ak" },
  { id: "gz", name: "Gözəllik", slug: "gozellik", parentId: null },
  { id: "dup1", name: "Dekor", slug: "dekor-el", parentId: "el" },
  { id: "dup2", name: "Dekor", slug: "dekor-2", parentId: "ak" },
];

test("subcategory by slug, by name, and by 'Üst > Alt' path (names or slugs)", () => {
  assert.equal(resolveImportCategory(categories, "telefonlar").category?.id, "tel");
  assert.equal(resolveImportCategory(categories, "Telefonlar").category?.id, "tel");
  assert.equal(resolveImportCategory(categories, "Elektronika > Telefonlar").category?.id, "tel");
  assert.equal(resolveImportCategory(categories, "elektronika>telefonlar").category?.id, "tel");
  assert.equal(resolveImportCategory(categories, "Aksesuarlar > Dekor").category?.id, "dup2");
});

test("old CSVs keep working: top-level names and slugs still map (as before)", () => {
  const plain = resolveImportCategory(categories, "Gözəllik");
  assert.equal(plain.category?.id, "gz");
  assert.ok("warning" in plain && plain.warning === null, "no subcategories, no warning");
  assert.equal(resolveImportCategory(categories, "GÖZƏLLİK").category?.id, "gz");
});

test("a top-level that has subcategories is accepted with a warning", () => {
  const result = resolveImportCategory(categories, "Elektronika");
  assert.equal(result.category?.id, "el");
  assert.ok("warning" in result && result.warning?.includes("Alt kateqoriya seçilməyib"));
});

test("unknown, wrong parent, ambiguous name and bad path are errors", () => {
  const error = (value: string) => { const r = resolveImportCategory(categories, value); return "error" in r ? r.error : null; };
  assert.equal(error("Mebel"), "Kateqoriya tapılmadı: Mebel");
  assert.equal(error("Aksesuarlar > Telefonlar"), "Kateqoriya tapılmadı: Aksesuarlar > Telefonlar");
  assert.match(error("Dekor") ?? "", /birmənalı deyil/);
  assert.match(error("a > b > c") ?? "", /yolu yanlışdır/);
});

test("checkImportRows: subcategory rows are valid, top-level-with-children rows warn, unknown rows fail", () => {
  const rows = [
    { Ad: "Telefon A", Qiymət: "100", Kateqoriya: "Elektronika > Telefonlar" },
    { Ad: "Telefon B", Qiymət: "100", Kateqoriya: "Elektronika" },
    { Ad: "Krem", Qiymət: "10", Kateqoriya: "Yox" },
  ];
  const checked = checkImportRows({ rows, mapping: { name: "Ad", price: "Qiymət", category: "Kateqoriya" }, mode: "create", categories, brands: [], existing: [] });
  // Other columns (stock, SKU) may add their own warnings; only the category outcome is checked here.
  assert.equal(checked[0].errors.length, 0);
  assert.ok(!checked[0].warnings.some((warning) => warning.includes("Alt kateqoriya")));
  assert.equal(checked[0].product.categoryId, "tel");
  assert.equal(checked[1].errors.length, 0);
  assert.equal(checked[1].status, "WARNING");
  assert.ok(checked[1].warnings.some((warning) => warning.includes("Alt kateqoriya seçilməyib: Elektronika")));
  assert.equal(checked[1].product.categoryId, "el");
  assert.equal(checked[2].status, "INVALID");
  assert.ok(checked[2].errors.includes("Kateqoriya tapılmadı: Yox"));
});
