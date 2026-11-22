/**
 * Minimal, dependency-free XLSX reading and writing for the bulk product import (IMPORT-TEMPLATE-1).
 *
 * Runs in the browser and in Node (unit tests): no DOMParser, only DataView / TextDecoder / Blob /
 * DecompressionStream. Reading covers what Excel, LibreOffice and Google Sheets write for a plain table:
 * the first sheet (xl/worksheets/sheet1.xml), shared strings (incl. rich-text runs; phonetic <rPh> text is
 * skipped), inline strings, numbers and formula results. The XML scanner is linear (indexOf loops, no
 * backtracking regex) and never expands entity declarations.
 *
 * Writing produces a minimal workbook (one sheet, inline strings, bold header, column widths, frozen header
 * row) zipped with the STORE method, so it needs no compression library.
 */

export type SheetTable = { headers: string[]; rows: Record<string, string>[] };

export class XlsxReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XlsxReadError";
  }
}

const MAX_PART_BYTES = 10 * 1024 * 1024;
const MAX_COLUMN = 16_384; // XFD, Excel's last column

// ---------------------------------------------------------------- CRC32 + ZIP (STORE)

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** Standard ZIP / PNG CRC-32 (polynomial 0xEDB88320). */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A ZIP archive with every entry STORED (no compression). Names must be ASCII. */
export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const DOS_DATE_1980_01_01 = 0x0021;
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    if (!/^[\x20-\x7e]+$/.test(file.name)) throw new Error("ZIP entry names must be ASCII.");
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + name.length + file.data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, 0, true); // method: STORE
    lv.setUint16(10, 0, true); // time
    lv.setUint16(12, DOS_DATE_1980_01_01, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, file.data.length, true);
    lv.setUint32(22, file.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    local.set(file.data, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, DOS_DATE_1980_01_01, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, file.data.length, true);
    cv.setUint32(24, file.data.length, true);
    cv.setUint16(28, name.length, true);
    // extra, comment, disk start, internal and external attributes stay 0
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + end.length);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) { out.set(part, at); at += part.length; }
  return out;
}

/** One entry of a ZIP archive as UTF-8 text (STORE or DEFLATE), or null when the entry is absent. */
export async function unzipEntry(buffer: ArrayBuffer, target: string): Promise<string | null> {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer); let at = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) if (view.getUint32(i, true) === 0x06054b50) { at = i; break; }
  if (at < 0) throw new XlsxReadError("Excel faylının arxivi oxunmadı.");
  const count = view.getUint16(at + 10, true); let cursor = view.getUint32(at + 16, true);
  if (count > 1024) throw new XlsxReadError("Excel faylında çox sayda arxiv elementi var.");
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) break;
    const method = view.getUint16(cursor + 10, true), size = view.getUint32(cursor + 20, true), uncompressedSize = view.getUint32(cursor + 24, true), nameLen = view.getUint16(cursor + 28, true), extraLen = view.getUint16(cursor + 30, true), commentLen = view.getUint16(cursor + 32, true), local = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(bytes.slice(cursor + 46, cursor + 46 + nameLen));
    if (name === target) {
      if (uncompressedSize > MAX_PART_BYTES) throw new XlsxReadError("Excel vərəqi 10 MB-dan böyük açıla bilməz.");
      const dataAt = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true), raw = bytes.slice(dataAt, dataAt + size);
      if (method === 0) return new TextDecoder().decode(raw);
      if (method !== 8) throw new XlsxReadError("Excel faylının sıxılma formatı dəstəklənmir.");
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw" as CompressionFormat));
      const reader = stream.getReader(), chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_PART_BYTES) {
          await reader.cancel();
          throw new XlsxReadError("Excel vərəqi 10 MB-dan böyük açıla bilməz.");
        }
        chunks.push(value);
      }
      const expanded = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { expanded.set(chunk, offset); offset += chunk.byteLength; }
      return new TextDecoder().decode(expanded);
    }
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

// ---------------------------------------------------------------- XML scanning (linear)

type XmlToken =
  | { kind: "open"; name: string; attrs: string }
  | { kind: "self"; name: string; attrs: string }
  | { kind: "close"; name: string }
  | { kind: "text"; text: string };

const XML_INVALID = "Excel vərəqinin XML məlumatı yanlışdır.";

export function decodeXmlText(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|lt|gt|amp|quot|apos);/g, (_match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ({ lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" } as Record<string, string>)[entity];
  });
}

/** Element names without a namespace prefix ("x:row" -> "row"), as some generators write prefixed SpreadsheetML. */
function localName(name: string) {
  const colon = name.indexOf(":");
  return colon >= 0 ? name.slice(colon + 1) : name;
}

function* xmlTokens(xml: string): Generator<XmlToken> {
  let i = 0;
  const length = xml.length;
  while (i < length) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) { yield { kind: "text", text: decodeXmlText(xml.slice(i)) }; return; }
    if (lt > i) yield { kind: "text", text: decodeXmlText(xml.slice(i, lt)) };
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      if (end < 0) throw new XlsxReadError(XML_INVALID);
      yield { kind: "text", text: xml.slice(lt + 9, end) };
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      if (end < 0) throw new XlsxReadError(XML_INVALID);
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<?", lt)) {
      const end = xml.indexOf("?>", lt + 2);
      if (end < 0) throw new XlsxReadError(XML_INVALID);
      i = end + 2;
      continue;
    }
    if (xml.startsWith("<!", lt)) throw new XlsxReadError(XML_INVALID); // DOCTYPE / entity declarations are never used by spreadsheets
    // Find the closing '>' outside quoted attribute values.
    let j = lt + 1, quote = "";
    for (; j < length; j++) {
      const c = xml[j];
      if (quote) { if (c === quote) quote = ""; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
    }
    if (j >= length) throw new XlsxReadError(XML_INVALID);
    const body = xml.slice(lt + 1, j);
    i = j + 1;
    if (body[0] === "/") { yield { kind: "close", name: localName(body.slice(1).trim()) }; continue; }
    const selfClosing = body.endsWith("/");
    const inner = selfClosing ? body.slice(0, -1) : body;
    let nameEnd = 0;
    while (nameEnd < inner.length && !/\s/.test(inner[nameEnd])) nameEnd++;
    const name = inner.slice(0, nameEnd);
    if (!name) throw new XlsxReadError(XML_INVALID);
    yield { kind: selfClosing ? "self" : "open", name: localName(name), attrs: inner.slice(nameEnd) };
  }
}

function attribute(attrs: string, wanted: string): string | null {
  const pattern = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(attrs)) !== null) {
    if (localName(match[1]) === wanted) return decodeXmlText(match[3] ?? match[4] ?? "");
  }
  return null;
}

/** "B12" -> 2 (1-based). Null for a missing or invalid reference. */
function columnIndex(reference: string | null): number | null {
  const letters = reference?.match(/^([A-Za-z]{1,3})[0-9]*$/)?.[1];
  if (!letters) return null;
  let index = 0;
  for (const ch of letters.toUpperCase()) index = index * 26 + ch.charCodeAt(0) - 64;
  return index >= 1 && index <= MAX_COLUMN ? index : null;
}

/** Shared strings: the text of each <si> (plain <t> or rich-text runs), without phonetic <rPh> text. */
export function readSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  let current: string | null = null, inText = 0, inPhonetic = 0;
  for (const token of xmlTokens(xml)) {
    if (token.kind === "open" || token.kind === "self") {
      if (token.name === "si") { if (token.kind === "self") strings.push(""); else current = ""; }
      else if (token.kind === "open" && token.name === "t") inText++;
      else if (token.kind === "open" && token.name === "rPh") inPhonetic++;
    } else if (token.kind === "close") {
      if (token.name === "si" && current !== null) { strings.push(current); current = null; }
      else if (token.name === "t" && inText) inText--;
      else if (token.name === "rPh" && inPhonetic) inPhonetic--;
    } else if (current !== null && inText && !inPhonetic) {
      current += token.text;
    }
  }
  return strings;
}

/** Cell matrix of a worksheet (sheetData rows; cells placed by their r="A1" column). */
export function readSheetMatrix(xml: string, strings: readonly string[]): string[][] {
  const matrix: string[][] = [];
  let inSheetData = false, row: string[] | null = null, nextColumn = 1;
  let cell: { index: number; type: string | null } | null = null;
  let valueText = "", inlineText = "", inValue = 0, inInline = 0, inPhonetic = 0, inInlineText = 0;
  for (const token of xmlTokens(xml)) {
    if (token.kind === "open" || token.kind === "self") {
      const name = token.name;
      if (name === "sheetData") { inSheetData = token.kind === "open"; continue; }
      if (!inSheetData) continue;
      if (name === "row") {
        if (token.kind === "self") { matrix.push([]); continue; }
        row = []; nextColumn = 1;
      } else if (name === "c" && row) {
        const reference = attribute(token.attrs, "r");
        const index = reference === null ? nextColumn : columnIndex(reference);
        if (index === null) throw new XlsxReadError(XML_INVALID);
        nextColumn = index + 1;
        if (token.kind === "self") { row[index - 1] = ""; continue; }
        cell = { index, type: attribute(token.attrs, "t") };
        valueText = ""; inlineText = "";
      } else if (cell && token.kind === "open") {
        if (name === "v") inValue++;
        else if (name === "is") inInline++;
        else if (name === "rPh") inPhonetic++;
        else if (name === "t" && inInline) inInlineText++;
      }
    } else if (token.kind === "close") {
      const name = token.name;
      if (name === "sheetData") { inSheetData = false; continue; }
      if (!inSheetData) continue;
      if (name === "row" && row) { matrix.push(row); row = null; }
      else if (name === "c" && cell && row) {
        row[cell.index - 1] = cell.type === "s" ? strings[Number(valueText.trim())] ?? "" : cell.type === "inlineStr" ? inlineText : valueText;
        cell = null; inValue = inInline = inPhonetic = inInlineText = 0;
      } else if (cell) {
        if (name === "v" && inValue) inValue--;
        else if (name === "is" && inInline) inInline--;
        else if (name === "rPh" && inPhonetic) inPhonetic--;
        else if (name === "t" && inInlineText) inInlineText--;
      }
    } else if (cell) {
      if (inValue) valueText += token.text;
      else if (inInline && inInlineText && !inPhonetic) inlineText += token.text;
    }
  }
  return matrix;
}

/** The first sheet as a table: the first row is the header row (trimmed); empty rows are skipped. */
export async function readXlsxTable(buffer: ArrayBuffer): Promise<SheetTable> {
  const stringsXml = await unzipEntry(buffer, "xl/sharedStrings.xml");
  const sheetXml = await unzipEntry(buffer, "xl/worksheets/sheet1.xml");
  if (!sheetXml) throw new XlsxReadError("Excel faylında ilk vərəq tapılmadı.");
  const strings = stringsXml ? readSharedStrings(stringsXml) : [];
  const matrix = readSheetMatrix(sheetXml, strings);
  const headers = Array.from(matrix.shift() || [], (header) => (header || "").trim());
  return { headers, rows: matrix.filter((values) => values.some(Boolean)).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]))) };
}

// ---------------------------------------------------------------- writing

export function escapeXml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

function columnName(index: number): string {
  let name = "";
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

export type XlsxColumn = { header: string; width: number; text?: boolean };
/** A sample cell: text, a number, or null for an empty cell. */
export type XlsxCell = string | number | null;

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/**
 * One-sheet workbook: bold header row (frozen), column widths, optional text-format columns (so codes like
 * "00123" stay text when typed in Excel), and the given data rows. Strings are inline, numbers are numeric.
 */
export function buildXlsxWorkbook(input: { sheetName: string; columns: XlsxColumn[]; rows: XlsxCell[][] }): Uint8Array {
  const { sheetName, columns, rows } = input;
  // The import wizard accepts up to 50 columns; the error report adds one ("Xəta") (IMPORT-FIX-1).
  if (!columns.length || columns.length > 64) throw new Error("1..64 columns");
  const lastColumn = columnName(columns.length);
  const textCell = (ref: string, value: string, style: number) => `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  const header = columns.map((column, index) => textCell(`${columnName(index + 1)}1`, column.header, 1)).join("");
  const body = rows.map((values, rowIndex) => {
    const r = rowIndex + 2;
    const cells = values.map((value, index) => {
      const ref = `${columnName(index + 1)}${r}`;
      const style = columns[index]?.text ? 2 : 0;
      if (value === null || value === "") return "";
      if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new Error("finite numbers only");
        return `<c r="${ref}"${style ? ` s="${style}"` : ""}><v>${value}</v></c>`;
      }
      return textCell(ref, value, style);
    }).join("");
    return `<row r="${r}">${cells}</row>`;
  }).join("");
  const cols = columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"${column.text ? ' style="2"' : ""}/>`).join("");
  const sheet = `${XML_HEAD}<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><dimension ref="A1:${lastColumn}${rows.length + 1}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData><row r="1">${header}</row>${body}</sheetData></worksheet>`;
  const styles = `${XML_HEAD}<styleSheet xmlns="${MAIN_NS}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const workbook = `${XML_HEAD}<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRels = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`;
  const rootRels = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const contentTypes = `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
  const encoder = new TextEncoder();
  return zipStore([
    { name: "[Content_Types].xml", data: encoder.encode(contentTypes) },
    { name: "_rels/.rels", data: encoder.encode(rootRels) },
    { name: "xl/workbook.xml", data: encoder.encode(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(workbookRels) },
    { name: "xl/styles.xml", data: encoder.encode(styles) },
    { name: "xl/worksheets/sheet1.xml", data: encoder.encode(sheet) },
  ]);
}
