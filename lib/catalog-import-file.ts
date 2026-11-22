/**
 * Reading a seller's bulk-import file in the browser (IMPORT-TEMPLATE-1). Pure: runs in Node unit tests too.
 *
 * CSV: comma, semicolon or tab (auto-detected from the header row, outside quotes), UTF-8 with or without BOM,
 * quoted fields with "" escapes and line breaks, CRLF / LF, and an optional first line `sep=;` (Excel's own hint),
 * which sets the delimiter and is not a data row. Prices with a decimal comma ("10,50") stay one cell in a
 * semicolon file; the server already reads them as 10.50 (lib/product-import.ts parseNumber).
 *
 * Files saved by Excel as "CSV (Comma delimited)" on an Azerbaijani / Turkish Windows are ANSI (Windows-1254):
 * "ə" is lost as "?" and ı ş ğ ö ü ç İ become U+FFFD when read as UTF-8. Such text is refused with a clear
 * message instead of importing broken names.
 */
import { detectDelimiter, ImportParseError, parseDelimited, stripBom } from "@/lib/import-parsers";
import { readXlsxTable, type SheetTable } from "@/lib/xlsx-lite";

export const LEGACY_ENCODING_MESSAGE = "Fayldakı hərflər düzgün oxunmadı (ə, ı, ş kimi hərflər pozulub). Excel-də faylı \"CSV UTF-8\" formatında saxlayın və ya Excel (.xlsx) şablonundan istifadə edin.";

/** Typical UTF-8 text that was read as Windows-1252/1254 and saved again ("É™" for ə, "Ä±" for ı, "ÅŸ" for ş …). */
const MOJIBAKE = /É™|Ä[±°Ÿž]|Å[Ÿž]|Ã[¶¼§‡–œ]/;

/** True when the text looks like it was not saved as UTF-8 (see the module comment). */
export function looksLikeLegacyEncoding(text: string, headers: readonly string[] = []): boolean {
  if (text.includes("�") || text.includes("\u0000")) return true;
  return headers.some((header) => MOJIBAKE.test(header) || /\p{L}\?\p{L}/u.test(header));
}

const SEP_LINE = /^"?sep=(.)"?[ \t]*(?:\r\n|\n|\r|$)/i;

/** Delimiter and text after an optional leading `sep=` line (BOM already removed). */
export function splitSepLine(text: string): { delimiter: string | null; body: string } {
  const match = SEP_LINE.exec(text);
  if (!match) return { delimiter: null, body: text };
  const delimiter = match[1];
  return { delimiter: [",", ";", "\t", "|"].includes(delimiter) ? delimiter : null, body: text.slice(match[0].length) };
}

/** CSV / TSV text -> table. Empty input gives an empty table (the wizard shows its own message). */
export function parseCatalogCsv(text: string): SheetTable {
  const { delimiter, body } = splitSepLine(stripBom(text));
  let table: SheetTable;
  try {
    table = parseDelimited(body, delimiter ?? detectDelimiter(body));
  } catch (error) {
    if (error instanceof ImportParseError) table = { headers: [], rows: [] };
    else throw error;
  }
  if (looksLikeLegacyEncoding(text, table.headers)) throw new Error(LEGACY_ENCODING_MESSAGE);
  return table;
}

/** The wizard's file reader: .xlsx through the XLSX reader, anything else as CSV text. */
export async function readCatalogImportFile(file: { name: string; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }): Promise<SheetTable & { format: "csv" | "xlsx" }> {
  if (file.name.toLowerCase().endsWith(".xlsx")) return { ...(await readXlsxTable(await file.arrayBuffer())), format: "xlsx" };
  return { ...parseCatalogCsv(await file.text()), format: "csv" };
}
