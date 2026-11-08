import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProductCatalogSort, productCatalogOrderBy } from "../lib/catalog-sort";

test("catalog sort accepts the supported alphabetical option", () => {
  assert.equal(normalizeProductCatalogSort("name"), "name");
  assert.deepEqual(productCatalogOrderBy("name"), [{ name: "asc" }, { id: "asc" }]);
});

test("catalog sort defaults invalid and missing values to newest with stable ordering", () => {
  for (const value of [undefined, "", "price", "unexpected"]) {
    assert.equal(normalizeProductCatalogSort(value), "newest");
  }
  assert.deepEqual(productCatalogOrderBy("newest"), [{ createdAt: "desc" }, { id: "desc" }]);
});
