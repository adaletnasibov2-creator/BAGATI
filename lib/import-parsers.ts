// Server-side, dependency-free parsers for bulk product import.
//
// Supported here:
//   - CSV/TSV: UTF-8 with optional BOM, auto-detected comma/semicolon/tab delimiter.
//   - JSON: array of objects, or { products: [...] }.
//
// Not parsed here (by design):
//   - XML: removed in SEC-FIX-1 (M4); convert XML catalogs to CSV/XLSX.
//   - XLSX is parsed in the existing client wizard and submitted as rows.
//   - .xls (binary BIFF), PDF text extraction and scanned-PDF OCR are intentionally
//     unsupported: the project has no library for them, so we never silently guess.
//     PDFs/XLS must be converted to CSV/XLSX/JSON before import.

export type ParsedImport = { headers: string[]; rows: Record<string, string>[] };

export class ImportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportParseError";
  }
}

/** Remove a leading UTF-8 BOM so the first header is not polluted with \uFEFF. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === delimiter) count++;
  }
  return count;
}

/** Pick the delimiter that appears most in the header line among , ; and tab. */
export function detectDelimiter(text: string): string {
  const headerLine = text.split(/\r?\n/, 1)[0] ?? "";
  let best = ",";
  let bestCount = -1;
  for (const candidate of [",", ";", "\t"]) {
    const count = countOutsideQuotes(headerLine, candidate);
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** RFC-4180-ish parser: quoted fields, escaped quotes, BOM, configurable delimiter. */
export function parseDelimited(text: string, forcedDelimiter?: string): ParsedImport {
  const clean = stripBom(text);
  const delimiter = forcedDelimiter ?? detectDelimiter(clean);
  const matrix: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '"' && clean[i + 1] === '"' && quoted) {
      value += '"';
      i++;
    } else if (c === '"') {
      quoted = !quoted;
    } else if (!quoted && c === delimiter) {
      row.push(value);
      value = "";
    } else if (!quoted && (c === "\n" || c === "\r")) {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(value);
      matrix.push(row);
      row = [];
      value = "";
    } else {
      value += c;
    }
  }
  if (value.length || row.length) {
    row.push(value);
    matrix.push(row);
  }

  const headers = (matrix.shift() ?? []).map((header) => header.trim());
  const rows = matrix
    .filter((values) => values.some((cell) => cell.trim()))
    .map((values) => {
      const obj: Record<string, string> = {};
      headers.forEach((header, index) => {
        obj[header] = (values[index] ?? "").trim();
      });
      return obj;
    });

  if (!headers.length || !rows.length) {
    throw new ImportParseError("Faylda başlıq və ən azı bir məhsul sətri tapılmadı.");
  }
  return { headers, rows };
}

/** JSON: accept a bare array or { products: [...] }; coerce scalar cells to strings. */
export function parseJsonImport(text: string): ParsedImport {
  let data: unknown;
  try {
    data = JSON.parse(stripBom(text));
  } catch {
    throw new ImportParseError("JSON məzmunu oxunmadı.");
  }
  const array = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).products)
      ? ((data as Record<string, unknown>).products as unknown[])
      : null;
  if (!Array.isArray(array) || !array.length) {
    throw new ImportParseError("JSON massiv boşdur və ya məhsul siyahısı tapılmadı.");
  }
  const rows = array.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ImportParseError(`JSON sətri ${index + 1} obyekt deyil.`);
    }
    const obj: Record<string, string> = {};
    for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
      obj[key] = value === null || value === undefined ? "" : String(value);
    }
    return obj;
  });
  return { headers: Object.keys(rows[0]), rows };
}

/**
 * Choose a parser from a file extension. CSV/TSV/JSON are text; XLSX/XLS/PDF are not.
 * XML is no longer parsed (SEC-FIX-1 M4: the regex extractor was quadratic on unclosed tags and only the removed
 * server-side fileText path used it), so .xml is rejected at once like any other unsupported format.
 */
export function parseImportByExtension(
  fileName: string,
  text: string,
): { format: "csv" | "tsv" | "json"; parsed: ParsedImport } {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "json") return { format: "json", parsed: parseJsonImport(text) };
  if (ext === "tsv") return { format: "tsv", parsed: parseDelimited(text, "\t") };
  if (ext === "csv") return { format: "csv", parsed: parseDelimited(text) };
  throw new ImportParseError("Dəstəklənməyən fayl formatı. CSV, TSV və ya JSON göndərin.");
}
