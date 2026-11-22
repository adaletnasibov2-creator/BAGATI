/**
 * IMPORT-TEMPLATE-1: Excel-safe bulk-import templates and a tolerant file reader (client side, no server change).
 * Unit tests only (Node): the app's own XLSX reader, CSV reader and template builders are called directly.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { crc32 as zlibCrc32, deflateRawSync } from "node:zlib";
import { buildXlsxWorkbook, crc32, readSharedStrings, readSheetMatrix, readXlsxTable, unzipEntry, XlsxReadError, zipStore } from "../lib/xlsx-lite";
import { LEGACY_ENCODING_MESSAGE, looksLikeLegacyEncoding, parseCatalogCsv, readCatalogImportFile, splitSepLine } from "../lib/catalog-import-file";
import { buildCatalogTemplateCsv, buildCatalogTemplateXlsx, CATALOG_TEMPLATE_HEADERS, CATALOG_TEMPLATE_SAMPLE, catalogTemplateXlsxDataUrl, XLSX_MIME } from "../lib/catalog-import-template";
import { checkImportRows } from "../lib/product-import";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
const bufferOf = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const sampleAsText = CATALOG_TEMPLATE_SAMPLE.map((value) => (value === null ? "" : String(value)));
const expectedSampleRow = Object.fromEntries(CATALOG_TEMPLATE_HEADERS.map((header, index) => [header, sampleAsText[index]]));
const encoder = new TextEncoder();

/** ZIP central-directory listing (name, method, crc, sizes) for structure checks. */
function listZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50, "end of central directory at the end");
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const entries: { name: string; method: number; crc: number; size: number; data: Uint8Array }[] = [];
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(cursor, true), 0x02014b50);
    const nameLen = view.getUint16(cursor + 28, true), local = view.getUint32(cursor + 42, true), size = view.getUint32(cursor + 20, true);
    const name = new TextDecoder().decode(bytes.slice(cursor + 46, cursor + 46 + nameLen));
    assert.equal(view.getUint32(local, true), 0x04034b50, `${name}: local header`);
    const dataAt = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    entries.push({ name, method: view.getUint16(cursor + 10, true), crc: view.getUint32(cursor + 16, true), size, data: bytes.slice(dataAt, dataAt + size) });
    cursor += 46 + nameLen + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
  }
  return entries;
}

/** A ZIP whose entries are DEFLATE-compressed (as Excel writes them), built with Node's zlib for the test only. */
function zipDeflate(files: { name: string; text: string }[]): Uint8Array {
  const parts: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const raw = Buffer.from(file.text, "utf8"), data = deflateRawSync(raw), name = Buffer.from(file.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(zlibCrc32(raw), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(zlibCrc32(raw), 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(raw.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    parts.push(local, name, data); central.push(entry, name);
    offset += 30 + name.length + data.length;
  }
  const centralBytes = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, centralBytes, end]));
}

// ---------------------------------------------------------------- ZIP / CRC32

test("crc32 matches the standard check value and Node's zlib", () => {
  assert.equal(crc32(encoder.encode("123456789")), 0xcbf43926);
  const text = encoder.encode("Məhsulun adı — ə ı ş ğ ö ü ç İ");
  assert.equal(crc32(text), zlibCrc32(text));
  assert.equal(crc32(new Uint8Array()), 0);
});

test("the .xlsx template is a valid STORE zip: every entry's CRC and size match its data", () => {
  const entries = listZip(buildCatalogTemplateXlsx());
  assert.deepEqual(entries.map((entry) => entry.name), ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"]);
  for (const entry of entries) {
    assert.equal(entry.method, 0, `${entry.name}: STORE`);
    assert.equal(entry.crc, zlibCrc32(entry.data), `${entry.name}: CRC`);
    assert.equal(entry.data.length, entry.size);
  }
});

// ---------------------------------------------------------------- template round trip

test("template .xlsx round-trips through the app's own XLSX reader: 10 headers and the sample row", async () => {
  const table = await readXlsxTable(bufferOf(buildCatalogTemplateXlsx()));
  assert.deepEqual(table.headers, [...CATALOG_TEMPLATE_HEADERS]);
  assert.equal(table.headers.length, 10);
  assert.deepEqual(table.rows, [expectedSampleRow]);
  assert.equal(table.rows[0]["Məhsulun adı"], "Nümunə məhsul", "Azerbaijani letters intact");
});

test("template .csv: UTF-8 BOM, semicolons, CRLF, and it reads back to the same table as the .xlsx", async () => {
  const csv = buildCatalogTemplateCsv();
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const [headerLine, sampleLine] = csv.slice(1).split("\r\n");
  assert.equal(headerLine, CATALOG_TEMPLATE_HEADERS.join(";"));
  assert.equal(headerLine.split(";").length, 10);
  assert.equal(sampleLine, "Nümunə məhsul;;Məhsul haqqında qısa məlumat;10;;;;0;5;");
  assert.ok(!headerLine.includes(","), "no comma in the header row");
  const fromCsv = parseCatalogCsv(csv);
  const fromXlsx = await readXlsxTable(bufferOf(buildCatalogTemplateXlsx()));
  assert.deepEqual(fromCsv, fromXlsx);
});

test("template .xlsx content: bold frozen header, column widths, text-formatted product code, sheet name, data URL", () => {
  const parts = Object.fromEntries(listZip(buildCatalogTemplateXlsx()).map((entry) => [entry.name, new TextDecoder().decode(entry.data)]));
  const sheet = parts["xl/worksheets/sheet1.xml"];
  assert.equal((sheet.match(/<c r="[A-J]1" t="inlineStr" s="1">/g) || []).length, 10, "10 bold header cells");
  assert.equal((sheet.match(/<col /g) || []).length, 10);
  assert.match(sheet, /<col min="2" max="2" width="24" customWidth="1" style="2"\/>/);
  assert.match(sheet, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
  assert.match(sheet, /<dimension ref="A1:J2"\/>/);
  assert.match(sheet, /<c r="D2"><v>10<\/v><\/c>/, "price is a number cell");
  assert.match(parts["xl/styles.xml"], /<font><b\/>/);
  assert.match(parts["xl/styles.xml"], /numFmtId="49"/);
  assert.match(parts["xl/workbook.xml"], /<sheet name="Məhsullar" sheetId="1" r:id="rId1"\/>/);
  assert.match(parts["[Content_Types].xml"], /PartName="\/xl\/worksheets\/sheet1\.xml"/);
  for (const [name, xml] of Object.entries(parts)) assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8" standalone="yes"\?>/, name);
  const url = catalogTemplateXlsxDataUrl();
  assert.ok(url.startsWith(`data:${XLSX_MIME};base64,`));
  assert.deepEqual(new Uint8Array(Buffer.from(url.split(",")[1], "base64")), buildCatalogTemplateXlsx());
});

test("writer escapes XML special characters and the reader decodes them back", async () => {
  const bytes = buildXlsxWorkbook({ sheetName: "A&B", columns: [{ header: "Ad <1>", width: 10 }, { header: "Qiymət", width: 10 }], rows: [['Köynək "Lux" & Co', 10.5]] });
  const table = await readXlsxTable(bufferOf(bytes));
  assert.deepEqual(table, { headers: ["Ad <1>", "Qiymət"], rows: [{ "Ad <1>": 'Köynək "Lux" & Co', "Qiymət": "10.5" }] });
});

// ---------------------------------------------------------------- XLSX reader on Excel-style files

test("XLSX reader: DEFLATE entries, shared strings with rich text, phonetic runs skipped, gaps, entities, prefixes", async () => {
  const sharedStrings = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="x" count="4"><si><t>Məhsulun adı</t></si><si><r><rPr><b/></rPr><t>Qiymət </t></r><r><t xml:space="preserve">(AZN)</t></r></si><si><t>Köynək &amp; şalvar</t><rPh sb="0" eb="1"><t>IGNORED</t></rPh></si><si><t/></si></sst>`;
  const sheet = `<?xml version="1.0"?><x:worksheet xmlns:x="m"><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="C1" t="s"><x:v>1</x:v></x:c></x:row>`
    + `<x:row r="2"><x:c r="A2" t="s"><x:v>2</x:v></x:c><x:c r="B2"/><x:c r="C2"><x:v>10.5</x:v></x:c></x:row>`
    + `<x:row r="3"/><x:row r="4"><x:c r="A4" t="str"><x:f>CONCAT("a","b")</x:f><x:v>ab</x:v></x:c><x:c r="C4" t="inlineStr"><x:is><x:t>12</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>`;
  const zip = zipDeflate([{ name: "xl/sharedStrings.xml", text: sharedStrings }, { name: "xl/worksheets/sheet1.xml", text: sheet }]);
  assert.equal(listZip(zip)[0].method, 8);
  const table = await readXlsxTable(bufferOf(zip));
  assert.deepEqual(table.headers, ["Məhsulun adı", "", "Qiymət (AZN)"]);
  assert.deepEqual(table.rows, [
    { "Məhsulun adı": "Köynək & şalvar", "": "", "Qiymət (AZN)": "10.5" },
    { "Məhsulun adı": "ab", "": "", "Qiymət (AZN)": "12" },
  ]);
});

test("XLSX reader: cells without r= are placed in the next column; CDATA and comments are handled", () => {
  const matrix = readSheetMatrix(`<worksheet><sheetData><!-- c --><row><c t="inlineStr"><is><t><![CDATA[a<b]]></t></is></c><c><v>2</v></c></row></sheetData></worksheet>`, []);
  assert.deepEqual(matrix, [["a<b", "2"]]);
  assert.deepEqual(readSharedStrings(`<sst><si><t>&#601;&#x131;</t></si></sst>`), ["əı"]);
});

test("XLSX reader refuses broken or hostile input quickly (no DOCTYPE, no unbounded scan)", async () => {
  assert.throws(() => readSheetMatrix(`<!DOCTYPE x [<!ENTITY a "b">]><worksheet/>`, []), XlsxReadError);
  assert.throws(() => readSheetMatrix(`<worksheet><sheetData><row><c r="ZZZZ1"><v>1</v></c></row></sheetData></worksheet>`, []), XlsxReadError);
  const started = performance.now();
  assert.throws(() => readSheetMatrix(`<worksheet><sheetData>${"<row a='".repeat(200_000)}`, []), XlsxReadError);
  assert.throws(() => readSheetMatrix("<c".repeat(500_000), []), XlsxReadError);
  assert.ok(performance.now() - started < 2_000, "linear scan");
  await assert.rejects(readXlsxTable(bufferOf(zipStore([{ name: "xl/workbook.xml", data: encoder.encode("<workbook/>") }]))), /Excel faylında ilk vərəq tapılmadı\./);
  await assert.rejects(readXlsxTable(new ArrayBuffer(10)), /Excel faylının arxivi oxunmadı\./);
  assert.equal(await unzipEntry(bufferOf(buildCatalogTemplateXlsx()), "missing.xml"), null);
});

// ---------------------------------------------------------------- CSV variants

const expectedCsv = { headers: ["Məhsulun adı", "Qiymət (AZN)", "Təsvir"], rows: [{ "Məhsulun adı": "Köynək", "Qiymət (AZN)": "10,50", "Təsvir": "Pambıq, yay üçün" }, { "Məhsulun adı": "Şalvar", "Qiymət (AZN)": "20", "Təsvir": 'Ölçü "M"' }] };

test("CSV: comma, semicolon and tab files with BOM / no BOM, CRLF / LF, quoted delimiters and quotes", () => {
  const variants: Record<string, string> = {
    "comma, quoted decimal comma, CRLF, BOM": '﻿Məhsulun adı,Qiymət (AZN),Təsvir\r\nKöynək,"10,50","Pambıq, yay üçün"\r\nŞalvar,20,"Ölçü ""M"""\r\n',
    "semicolon (Azerbaijani Excel), LF, no BOM": 'Məhsulun adı;Qiymət (AZN);Təsvir\nKöynək;10,50;Pambıq, yay üçün\nŞalvar;20;"Ölçü ""M"""\n',
    "tab": 'Məhsulun adı\tQiymət (AZN)\tTəsvir\nKöynək\t10,50\tPambıq, yay üçün\nŞalvar\t20\tÖlçü "M"',
    "sep=; line + BOM": '﻿sep=;\r\nMəhsulun adı;Qiymət (AZN);Təsvir\r\nKöynək;10,50;Pambıq, yay üçün\r\nŞalvar;20;"Ölçü ""M"""\r\n',
    "sep=, line, quoted header cells": 'sep=,\n"Məhsulun adı","Qiymət (AZN)","Təsvir"\nKöynək,"10,50","Pambıq, yay üçün"\nŞalvar,20,"Ölçü ""M"""\n',
    "quoted \"sep=;\" (as Excel may write it)": '"sep=;"\nMəhsulun adı;Qiymət (AZN);Təsvir\nKöynək;10,50;Pambıq, yay üçün\nŞalvar;20;"Ölçü ""M"""\n',
  };
  for (const [label, text] of Object.entries(variants)) {
    const parsed = parseCatalogCsv(text);
    if (label === "tab") assert.deepEqual(parsed.rows[1]["Təsvir"], 'Ölçü "M"', label);
    assert.deepEqual(parsed, expectedCsv, label);
  }
});

test("CSV: quoted line breaks, blank lines and surrounding spaces are handled; empty files give an empty table", () => {
  const parsed = parseCatalogCsv('Ad;Təsvir\r\n\r\n Köynək ;"Sətir 1\r\nSətir 2"\r\n;;\r\n');
  assert.deepEqual(parsed, { headers: ["Ad", "Təsvir"], rows: [{ Ad: "Köynək", Təsvir: "Sətir 1\r\nSətir 2" }] });
  assert.deepEqual(parseCatalogCsv(""), { headers: [], rows: [] });
  assert.deepEqual(parseCatalogCsv("﻿sep=;\r\n"), { headers: [], rows: [] });
  assert.deepEqual(splitSepLine("sep=|\nA|B"), { delimiter: "|", body: "A|B" });
  assert.deepEqual(splitSepLine("separator,x\n"), { delimiter: null, body: "separator,x\n" });
});

test("decimal comma prices from a semicolon file are read as 10.50 by the existing import rules (no server change)", () => {
  const parsed = parseCatalogCsv("﻿Məhsulun adı;Qiymət (AZN);Endirimli qiymət (AZN);Kateqoriya;Anbar qalığı\r\nKöynək;10,50;9,99;Geyim;3\r\n");
  assert.equal(parsed.rows[0]["Qiymət (AZN)"], "10,50");
  const [checked] = checkImportRows({
    rows: parsed.rows,
    mapping: { name: "Məhsulun adı", price: "Qiymət (AZN)", discountPrice: "Endirimli qiymət (AZN)", category: "Kateqoriya", quantity: "Anbar qalığı" },
    mode: "create",
    categories: [{ id: "c1", name: "Geyim", slug: "geyim" }],
    brands: [],
    existing: [],
  });
  assert.deepEqual(checked.errors, []);
  assert.equal(checked.product.price, 10.5);
  assert.equal(checked.product.discountPrice, 9.99);
});

// ---------------------------------------------------------------- ANSI / mojibake

function windows1254(text: string): Uint8Array {
  // The Windows-1254 bytes Excel writes for an Azerbaijani file; "ə" has no byte there and is saved as "?".
  const map: Record<string, number> = { ı: 0xfd, İ: 0xdd, ş: 0xfe, Ş: 0xde, ğ: 0xf0, Ğ: 0xd0, ö: 0xf6, Ö: 0xd6, ü: 0xfc, Ü: 0xdc, ç: 0xe7, Ç: 0xc7, ə: 0x3f, Ə: 0x3f };
  return Uint8Array.from([...text].map((ch) => map[ch] ?? ch.charCodeAt(0)));
}

test("an ANSI (Windows-1254) CSV saved by Azerbaijani Excel is refused with the clear message", () => {
  const ansi = windows1254("Məhsulun adı;Qiymət (AZN)\r\nKöynək;10\r\n");
  const asBrowserReadsIt = new TextDecoder().decode(ansi); // File.text() decodes as UTF-8
  assert.ok(asBrowserReadsIt.includes("�"));
  assert.throws(() => parseCatalogCsv(asBrowserReadsIt), { message: LEGACY_ENCODING_MESSAGE });
  // Only "ə" in the file: no U+FFFD, but "M?hsul" in a header is still caught.
  assert.throws(() => parseCatalogCsv(new TextDecoder().decode(windows1254("Məhsul kodu;Qiymət\nA1;10\n"))), { message: LEGACY_ENCODING_MESSAGE });
});

test("mojibake headers (UTF-8 read as Windows-1252/1254 and saved again) are refused; normal files are not", () => {
  const mojibake = new TextDecoder("windows-1252").decode(encoder.encode("Məhsulun adı;Qiymət (AZN);Şəkil ünvanları"));
  assert.match(mojibake, /É™|Ä±/);
  assert.throws(() => parseCatalogCsv(`${mojibake}\nA;1;\n`), { message: LEGACY_ENCODING_MESSAGE });
  assert.equal(looksLikeLegacyEncoding("Ad;Qiymət?\nA;1", ["Ad", "Qiymət?"]), false, "a question mark at the end is fine");
  assert.equal(looksLikeLegacyEncoding("x\u0000y"), true, "UTF-16 read as UTF-8");
  assert.doesNotThrow(() => parseCatalogCsv(buildCatalogTemplateCsv()));
  assert.match(LEGACY_ENCODING_MESSAGE, /CSV UTF-8/);
  assert.match(LEGACY_ENCODING_MESSAGE, /\.xlsx/);
});

// ---------------------------------------------------------------- wizard wiring

test("readCatalogImportFile picks the reader by extension and reports the format", async () => {
  const xlsxBytes = buildCatalogTemplateXlsx();
  const xlsx = await readCatalogImportFile({ name: "Şablon.XLSX", text: async () => { throw new Error("not text"); }, arrayBuffer: async () => bufferOf(xlsxBytes) });
  assert.equal(xlsx.format, "xlsx");
  assert.deepEqual(xlsx.rows, [expectedSampleRow]);
  const csv = await readCatalogImportFile({ name: "mehsullar.csv", text: async () => buildCatalogTemplateCsv(), arrayBuffer: async () => { throw new Error("not binary"); } });
  assert.equal(csv.format, "csv");
  assert.deepEqual(csv.rows, [expectedSampleRow]);
});

test("the wizard uses the shared reader and offers both templates; import rules and limits are unchanged", () => {
  const wizard = read("components/vendor-import.tsx");
  assert.match(wizard, /const parsed = await readCatalogImportFile\(file\);/);
  assert.match(wizard, /setSourceFormat\(parsed\.format\)/);
  assert.doesNotMatch(wizard, /DOMParser|function parseCsv|function unzipEntry|function parseXlsx/);
  assert.match(wizard, /href=\{xlsxTemplateHref\} download=\{CATALOG_TEMPLATE_XLSX_FILENAME\}>Excel şablonunu yüklə<\/a>/);
  assert.match(wizard, /href=\{`data:text\/csv;charset=utf-8,\$\{encodeURIComponent\(csvTemplate\)\}`\} download=\{CATALOG_TEMPLATE_CSV_FILENAME\}>CSV şablonunu yüklə<\/a>/);
  for (const rule of ["Faylda maksimum 50 sütun qəbul edilir.", "Bir idxalda maksimum 100 000 sətir qəbul edilir.", "Fayl 10 MB-dan böyük olmamalıdır.", "Hər sətir 8 KB-dan kiçik olmalıdır."]) assert.ok(wizard.includes(rule), rule);
});

test("template headers are exactly the previous CSV template's headers (the wizard's column guesses are unchanged)", () => {
  const previous = "Məhsulun adı,Məhsul kodu (istəyə bağlı),Məhsulun təsviri,Qiymət (AZN),Endirimli qiymət (AZN),Kateqoriya,Brend,Anbar qalığı,Az stok xəbərdarlığı,Şəkil ünvanları";
  assert.deepEqual([...CATALOG_TEMPLATE_HEADERS], previous.split(","));
  assert.deepEqual(sampleAsText, "Nümunə məhsul,,Məhsul haqqında qısa məlumat,10,,,,0,5,".split(","));
});
