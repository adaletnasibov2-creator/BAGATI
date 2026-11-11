export type CatalogImportSourceRow = Record<string, string>;

export type CatalogImportValidationRow = {
  index: number;
  status: "VALID" | "INVALID" | "WARNING";
  errors: string[];
  warnings: string[];
  product: Record<string, unknown>;
};

export function chunkCatalogImportRows(
  rows: readonly CatalogImportSourceRow[],
  chunkSize: number,
): { rowNumber: number; data: CatalogImportSourceRow }[][] {
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 50) {
    throw new Error("INVALID_IMPORT_CHUNK_SIZE");
  }
  const chunks: { rowNumber: number; data: CatalogImportSourceRow }[][] = [];
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    chunks.push(rows.slice(offset, offset + chunkSize).map((data, index) => ({ rowNumber: offset + index + 1, data })));
  }
  return chunks;
}

export function offsetCatalogImportValidationRows(
  rows: readonly CatalogImportValidationRow[],
  offset: number,
): CatalogImportValidationRow[] {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("INVALID_IMPORT_ROW_OFFSET");
  return rows.map((row) => ({ ...row, index: row.index + offset }));
}
