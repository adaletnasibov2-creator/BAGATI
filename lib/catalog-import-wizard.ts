/**
 * Small, pure pieces of the seller bulk-import wizard (IMPORT-FIX-1), kept here so they can be unit-tested in Node:
 * why the import button is disabled, the result summary, and the Azerbaijani .xlsx error report.
 */
import { buildXlsxWorkbook, type XlsxColumn } from "@/lib/xlsx-lite";

/** Reasons reuse the texts the wizard already shows when the import is started anyway (components/vendor-import.tsx). */
export function importBlockReason(input: { validCount: number; archiveCount: number; unmatched: number; duplicates: number; skuOrNameMapped: boolean }): string | null {
  if (input.validCount === 0) return "İdxal üçün uyğun sətir yoxdur.";
  if (input.archiveCount > 0) {
    if (input.duplicates > 0) return "Təkrar məhsul kodu və ya adı var; şəkil uyğunluğu qeyri-müəyyəndir.";
    if (input.unmatched > 0) return `${input.unmatched} ZIP şəkli cədvəldəki məhsul kodu və ya adı ilə uyğunlaşmır.`;
    if (!input.skuOrNameMapped) return "ZIP şəkillərini uyğunlaşdırmaq üçün məhsul kodu və ya məhsul adı sütununu seçin.";
  }
  return null;
}

export type ImportResultCounts = { created: number; updated: number; skipped: number; failed: number };

/** The result step's summary: new products are drafts; updated products keep their status. */
export function importResultLines(result: ImportResultCounts): string[] {
  return [
    `${result.created} məhsul qaralama kimi əlavə olundu.`,
    ...(result.updated ? [`${result.updated} məhsul yeniləndi; onların statusu dəyişmədi.`] : []),
    ...(result.skipped ? [`${result.skipped} sətir keçildi.`] : []),
    ...(result.failed ? [`${result.failed} sətir xətalıdır və əlavə olunmayıb.`] : []),
  ];
}

export const IMPORT_PUBLISH_HINT = "Qaralamalar saytda görünmür. Satışa çıxarmaq üçün “Məhsullarım” bölməsində məhsulun “Redaktə” düyməsini basın və statusu “Aktiv” edin.";

const NO_REASON = "Nəticə məlumatı mövcud deyil.";

/** Row errors as plain text (the job stores a JSON list of messages). */
export function importErrorText(errors: unknown): string {
  const list = Array.isArray(errors) ? errors : errors === null || errors === undefined ? [] : [errors];
  const parts = list
    .map((item) => typeof item === "string" ? item : item && typeof item === "object" && typeof (item as { message?: unknown }).message === "string" ? (item as { message: string }).message : "")
    .map((text) => text.trim())
    .filter(Boolean);
  return parts.length ? parts.join("; ") : NO_REASON;
}

export type ImportFailure = { rowNumber: number; errors: unknown };
export type ImportSource = { headers: readonly string[]; rows: readonly Record<string, string>[] };

export const ERROR_REPORT_FILENAME = "bagati-idxal-xetalari.xlsx";
export const ERROR_REPORT_SHEET = "Xətalı sətirlər";
export const ERROR_REPORT_COLUMN = "Xəta";
export const ERROR_REPORT_ROW_COLUMN = "Sətir";

function uniqueHeader(wanted: string, taken: readonly string[]) {
  const lower = new Set(taken.map((header) => header.toLocaleLowerCase("az")));
  if (!lower.has(wanted.toLocaleLowerCase("az"))) return wanted;
  for (let n = 2; ; n++) if (!lower.has(`${wanted} (${n})`.toLocaleLowerCase("az"))) return `${wanted} (${n})`;
}

/**
 * The error report as .xlsx.
 *
 * - With the seller's loaded file (`source`): the failed rows with ALL their original columns, in the original order,
 *   plus a last column "Xəta". The seller fixes the cells, deletes the "Xəta" column or leaves it (the wizard ignores
 *   unmapped columns), and uploads the same file again.
 * - Without it (an older job, or the page was reloaded), or when a row number does not fit the loaded file:
 *   "Sətir" (the line number in the original file, header = line 1) and "Xəta".
 *
 * `rowNumber` is the job's 1-based data-row number (lib/catalog-import-client.ts chunkCatalogImportRows).
 */
export function buildImportErrorReport(failures: readonly ImportFailure[], source: ImportSource | null): { bytes: Uint8Array; withSourceColumns: boolean } {
  const fits = Boolean(source && source.headers.length && failures.every((failure) => Number.isInteger(failure.rowNumber) && failure.rowNumber >= 1 && failure.rowNumber <= source.rows.length));
  const ordered = [...failures].sort((left, right) => left.rowNumber - right.rowNumber);
  if (fits && source) {
    const errorHeader = uniqueHeader(ERROR_REPORT_COLUMN, source.headers);
    const columns: XlsxColumn[] = [
      ...source.headers.map((header) => ({ header, width: Math.min(40, Math.max(12, header.length + 4)), text: true })),
      { header: errorHeader, width: 60 },
    ];
    const rows = ordered.map((failure) => {
      const row = source.rows[failure.rowNumber - 1];
      return [...source.headers.map((header) => row[header] ?? ""), importErrorText(failure.errors)];
    });
    return { bytes: buildXlsxWorkbook({ sheetName: ERROR_REPORT_SHEET, columns, rows }), withSourceColumns: true };
  }
  const columns: XlsxColumn[] = [{ header: ERROR_REPORT_ROW_COLUMN, width: 10 }, { header: ERROR_REPORT_COLUMN, width: 80 }];
  const rows = ordered.map((failure) => [failure.rowNumber + 1, importErrorText(failure.errors)]);
  return { bytes: buildXlsxWorkbook({ sheetName: ERROR_REPORT_SHEET, columns, rows }), withSourceColumns: false };
}
