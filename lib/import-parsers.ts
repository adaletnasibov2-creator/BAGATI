// Server-side, dependency-free parsers for bulk product import.
//
// Supported here:
//   - CSV/TSV: UTF-8 with optional BOM, auto-detected comma/semicolon/tab delimiter.
//   - JSON: array of objects, or { products: [...] }.
//   - XML: repeated <product> blocks with <field>value</field> children (text catalogs).
//
// Not parsed here (by design):
//   - XLSX is parsed in the existing client wizard and submitted as rows.
//   - .xls (binary BIFF), PDF text extraction and scanned-PDF OCR are intentionally
//     unsupported: the project has no library for them, so we never silently guess.
//     PDFs/XLS must be converted to CSV/XLSX/JSON/XML before import.

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


function decodeXmlEntities(input: string): string {
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

// Azerbaijani-letter-aware XML tag charset (ə ö ğ ü ç ş ı and uppercase İ Ğ Ü Ç Ö Ş Ə).
const AZ_TAG = "[A-Za-z\\u0259\\u00f6\\u011f\\u00fc\\u00e7\\u015f\\u0131\\u0130\\u011e\\u00dc\\u00c7\\u015e\\u018f_][A-Za-z0-9\\u0259\\u00f6\\u011f\\u00fc\\u00e7\\u015f\\u0131\\u0130\\u011e\\u00dc\\u00c7\\u015e\\u018f_-]*";

/**
 * Text-based XML catalogs: repeated <product> (or <item>/<məhsul>) blocks whose
 * children are simple <field>value</field> pairs. This is a pragmatic extractor,
 * not a full XML parser; CDATA is unwrapped and values are entity-decoded. It
 * only does string processing (never eval), so it is safe against code injection.
 */
export function parseXmlImport(text: string): ParsedImport {
  const clean = stripBom(text);
  const blockPattern = new RegExp(`<(product|item|m\\u0259hsul|mehsul)\\b[^>]*>([\\s\\S]*?)</\\1>`, "gi");
  const fieldPattern = new RegExp(`<(${AZ_TAG})\\s*(?:/>|>([\\s\\S]*?)</\\1>)`, "gi");
  const rows: Record<string, string>[] = [];
  let block: RegExpExecArray | null;
  while ((block = blockPattern.exec(clean)) !== null) {
    const inner = block[2];
    const obj: Record<string, string> = {};
    let field: RegExpExecArray | null;
    fieldPattern.lastIndex = 0;
    while ((field = fieldPattern.exec(inner)) !== null) {
      const key = field[1].trim();
      const raw = field[2] ?? "";
      obj[key] = decodeXmlEntities(raw.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1").trim());
    }
    if (Object.keys(obj).length) rows.push(obj);
  }
  if (!rows.length) {
    throw new ImportParseError("XML-də <product> blokları tapılmadı.");
  }
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return { headers, rows };
}

/** Choose a parser from a file extension. CSV/TSV/JSON/XML are text; XLSX/XLS/PDF are not. */
export function parseImportByExtension(
  fileName: string,
  text: string,
): { format: "csv" | "tsv" | "json" | "xml"; parsed: ParsedImport } {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "json") return { format: "json", parsed: parseJsonImport(text) };
  if (ext === "xml") return { format: "xml", parsed: parseXmlImport(text) };
  if (ext === "tsv") return { format: "tsv", parsed: parseDelimited(text, "\t") };
  if (ext === "csv") return { format: "csv", parsed: parseDelimited(text) };
  throw new ImportParseError("Dəstəklənməyən fayl formatı. CSV, TSV, JSON və ya XML göndərin.");
}
