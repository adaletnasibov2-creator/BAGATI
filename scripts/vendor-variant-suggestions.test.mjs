import assert from "node:assert/strict";
import test from "node:test";
import { categorySuggestionKey, suggestedVariantAttributes, suggestedVariantValues } from "../lib/vendor-variant-suggestions.ts";

test("category-specific product choices follow Azerbaijani category names", () => {
  assert.equal(categorySuggestionKey("Geyim"), "clothing");
  assert.equal(categorySuggestionKey("Ayaqqabı"), "shoes");
  assert.equal(categorySuggestionKey("Aksesuarlar"), "accessories");
  assert.equal(categorySuggestionKey("Gözəllik və qulluq"), "beauty");
  assert.equal(categorySuggestionKey("Ev və yaşayış"), "home");
  assert.equal(categorySuggestionKey("Uşaq məhsulları"), "kids");
  assert.deepEqual(suggestedVariantAttributes("Ayaqqabı"), ["Rəng", "Ayaqqabı ölçüsü", "Material"]);
});

test("known seller choice fields offer relevant values", () => {
  assert.deepEqual(suggestedVariantValues("Rəng"), ["Qara", "Ağ", "Mavi", "Qırmızı", "Yaşıl", "Sarı", "Boz", "Qəhvəyi", "Bej", "Narıncı", "Bənövşəyi", "Çəhrayı"]);
  assert.equal(suggestedVariantValues("Material").length, 0);
});
