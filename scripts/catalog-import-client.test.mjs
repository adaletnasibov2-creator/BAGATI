import assert from "node:assert/strict";
import test from "node:test";
import {
  chunkCatalogImportRows,
  offsetCatalogImportValidationRows,
} from "../lib/catalog-import-client.ts";

test("catalog rows are staged in bounded, contiguous batches", () => {
  const rows = Array.from({ length: 123 }, (_, index) => ({ sku: `sku-${index + 1}` }));
  const chunks = chunkCatalogImportRows(rows, 50);

  assert.deepEqual(chunks.map((chunk) => chunk.length), [50, 50, 23]);
  assert.deepEqual(chunks.flat().map((row) => row.rowNumber), Array.from({ length: 123 }, (_, index) => index + 1));
  assert.deepEqual(chunks.flat().map((row) => row.data), rows);
});

test("catalog staging refuses invalid chunk sizes", () => {
  for (const size of [0, -1, 51, 1.5, Number.NaN]) {
    assert.throws(() => chunkCatalogImportRows([{ sku: "sku-1" }], size), /INVALID_IMPORT_CHUNK_SIZE/);
  }
});

test("validation row indexes remain aligned when preview requests are batched", () => {
  const batch = [
    { index: 2, status: "VALID", errors: [], warnings: [], product: { sku: "a" } },
    { index: 3, status: "INVALID", errors: ["bad"], warnings: [], product: { sku: "b" } },
  ];
  assert.deepEqual(offsetCatalogImportValidationRows(batch, 100).map((row) => row.index), [102, 103]);
  assert.throws(() => offsetCatalogImportValidationRows(batch, -1), /INVALID_IMPORT_ROW_OFFSET/);
});
