/**
 * The bulk-import templates offered in the seller import wizard (IMPORT-TEMPLATE-1).
 *
 * One header list and one sample row feed both files, so they always match the wizard's column guesses:
 *  - .xlsx (recommended): opens in Excel with separate columns and correct Azerbaijani letters in every locale.
 *  - .csv: UTF-8 with BOM, semicolon-separated. Excel on Azerbaijani / Turkish / most European Windows uses ";" as
 *    the list separator, so the columns split on opening there (a comma file opened as ONE column). The importer
 *    accepts comma, semicolon and tab files alike.
 */
import { buildXlsxWorkbook, type XlsxCell, type XlsxColumn } from "@/lib/xlsx-lite";

export const CATALOG_TEMPLATE_HEADERS = [
  "Məhsulun adı",
  "Məhsul kodu (istəyə bağlı)",
  "Məhsulun təsviri",
  "Qiymət (AZN)",
  "Endirimli qiymət (AZN)",
  "Kateqoriya",
  "Brend",
  "Anbar qalığı",
  "Az stok xəbərdarlığı",
  "Şəkil ünvanları",
] as const;

/** Sample row (same values as the earlier CSV template). Numbers are numeric cells in the .xlsx file. */
export const CATALOG_TEMPLATE_SAMPLE: readonly XlsxCell[] = ["Nümunə məhsul", null, "Məhsul haqqında qısa məlumat", 10, null, null, null, 0, 5, null];

export const CATALOG_TEMPLATE_SHEET_NAME = "Məhsullar";
export const CATALOG_TEMPLATE_XLSX_FILENAME = "bagati-product-import-template.xlsx";
export const CATALOG_TEMPLATE_CSV_FILENAME = "bagati-product-import-template.csv";
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const WIDTHS = [28, 24, 40, 14, 22, 22, 16, 14, 22, 40];

function csvCell(value: XlsxCell, delimiter: string): string {
  const text = value === null ? "" : String(value);
  return /["\r\n]/.test(text) || text.includes(delimiter) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** UTF-8 BOM + semicolon-separated header and sample row, CRLF line ends. */
export function buildCatalogTemplateCsv(): string {
  const line = (values: readonly XlsxCell[]) => values.map((value) => csvCell(value, ";")).join(";");
  return `﻿${line(CATALOG_TEMPLATE_HEADERS)}\r\n${line(CATALOG_TEMPLATE_SAMPLE)}\r\n`;
}

/** The .xlsx template; the product code column is text-formatted so codes like 00123 keep their zeros. */
export function buildCatalogTemplateXlsx(): Uint8Array {
  const columns: XlsxColumn[] = CATALOG_TEMPLATE_HEADERS.map((header, index) => ({ header, width: WIDTHS[index], text: index === 1 }));
  return buildXlsxWorkbook({ sheetName: CATALOG_TEMPLATE_SHEET_NAME, columns, rows: [[...CATALOG_TEMPLATE_SAMPLE]] });
}

/** A data: URL for a download link (the file is about 3 KB). */
export function catalogTemplateXlsxDataUrl(): string {
  const bytes = buildCatalogTemplateXlsx();
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return `data:${XLSX_MIME};base64,${btoa(binary)}`;
}
