/**
 * IMPORT-FIX-1: client-side clarity fixes for the seller bulk import (no server change).
 * Pure helpers are called directly; the wizard wiring is checked in the source. No database.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  buildImportErrorReport, ERROR_REPORT_COLUMN, ERROR_REPORT_FILENAME, ERROR_REPORT_ROW_COLUMN, ERROR_REPORT_SHEET, IMPORT_PUBLISH_HINT,
  importBlockReason, importErrorText, importResultLines,
} from "../lib/catalog-import-wizard";
import { readXlsxTable, unzipEntry } from "../lib/xlsx-lite";
import { readCatalogImportFile } from "../lib/catalog-import-file";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
const bufferOf = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const wizard = () => read("components/vendor-import.tsx");

const headers = ["Məhsulun adı", "Məhsul kodu (istəyə bağlı)", "Qiymət (AZN)", "Kateqoriya"];
const rows = [
  { "Məhsulun adı": "Köynək", "Məhsul kodu (istəyə bağlı)": "00123", "Qiymət (AZN)": "10,50", "Kateqoriya": "Geyim" },
  { "Məhsulun adı": "Şalvar", "Məhsul kodu (istəyə bağlı)": "A-2", "Qiymət (AZN)": "20", "Kateqoriya": "Yoxdur" },
  { "Məhsulun adı": "Papaq", "Məhsul kodu (istəyə bağlı)": "", "Qiymət (AZN)": "0", "Kateqoriya": "Aksesuarlar" },
];

// ---------------------------------------------------------------- 1. image sentence

test("1: sellers are told images come from the ZIP archive or this store's uploads; the admin import keeps its sentence", () => {
  const source = wizard();
  assert.match(source, /\{jobUrl \? "Şəkilləri aşağıdakı ZIP arxivi ilə əlavə edin\. Cədvəldəki şəkil sütununa yalnız bu mağazaya artıq yüklənmiş şəkillərin ünvanlarını yazmaq olar; başqa saytlardakı şəkil linkləri qəbul edilmir\." : "Şəkil ünvanları HTTPS ilə başlamalıdır\."\}/);
  // The seller flow (jobUrl) accepts only store-owned image URLs; the admin route accepts any https URL.
  assert.match(read("app/api/vendor/[storeId]/imports/jobs/[jobId]/process/route.ts"), /isImageUrlAllowed: \(url\) => isSafeImportImageUrl\(url\) && isOwnedStoreAssetUrl\(access\.storeId, url\)/);
  assert.match(read("app/api/admin/stores/[storeId]/imports/route.ts"), /return isSafeImportImageUrl\(value\) && \(!value\.startsWith\("\/"\) \|\| isOwnedStoreAssetUrl\(storeId, value\)\);/);
});

// ---------------------------------------------------------------- 2. warnings amber, errors red

test("2: preview shows errors in red and warnings in amber, separately", () => {
  const source = wizard();
  assert.match(source, /\{row\.errors\.length > 0 && <span className="block text-red-800">\{row\.errors\.join\(" · "\)\}<\/span>\}\{row\.warnings\.length > 0 && <span className="block text-amber-800">\{row\.warnings\.join\(" · "\)\}<\/span>\}/);
  assert.doesNotMatch(source, /\[\.\.\.row\.errors, \.\.\.row\.warnings\]/, "no longer joined into one red cell");
});

// ---------------------------------------------------------------- 3. reason next to the disabled button

test("3: importBlockReason explains a disabled import button with the wizard's existing texts", () => {
  const base = { validCount: 5, archiveCount: 0, unmatched: 0, duplicates: 0, skuOrNameMapped: true };
  assert.equal(importBlockReason(base), null);
  assert.equal(importBlockReason({ ...base, validCount: 0 }), "İdxal üçün uyğun sətir yoxdur.");
  assert.equal(importBlockReason({ ...base, archiveCount: 3, duplicates: 1, unmatched: 2 }), "Təkrar məhsul kodu və ya adı var; şəkil uyğunluğu qeyri-müəyyəndir.");
  assert.equal(importBlockReason({ ...base, archiveCount: 3, unmatched: 2 }), "2 ZIP şəkli cədvəldəki məhsul kodu və ya adı ilə uyğunlaşmır.");
  assert.equal(importBlockReason({ ...base, archiveCount: 3, skuOrNameMapped: false }), "ZIP şəkillərini uyğunlaşdırmaq üçün məhsul kodu və ya məhsul adı sütununu seçin.");
  assert.equal(importBlockReason({ ...base, unmatched: 4 }), null, "no archive: nothing to match");
  // Every reason already exists as a message in the wizard or the import route.
  const startJob = wizard();
  for (const text of ["Təkrar məhsul kodu və ya adı var; şəkil uyğunluğu qeyri-müəyyəndir.", "ZIP şəkli cədvəldəki məhsul kodu və ya adı ilə uyğunlaşmır.", "ZIP şəkillərini uyğunlaşdırmaq üçün məhsul kodu və ya məhsul adı sütununu seçin."]) assert.ok(startJob.includes(text), text);
  assert.match(read("app/api/vendor/[storeId]/[section]/route.ts"), /İdxal üçün uyğun sətir yoxdur/);
});

test("3: the import button is disabled by the same reason that is shown next to it", () => {
  const source = wizard();
  assert.match(source, /const blockReason = importBlockReason\(\{ validCount, archiveCount: imageArchive\.length, unmatched: imageMatches\.unmatched\.length, duplicates: imageMatches\.duplicates\.length, skuOrNameMapped: Boolean\(mapping\.sku \|\| mapping\.name\) \}\);/);
  assert.match(source, /disabled=\{busy \|\| Boolean\(blockReason\)\} aria-describedby=\{blockReason \? "import-block-reason" : undefined\}/);
  assert.match(source, /\{blockReason && <p id="import-block-reason" role="status" className="basis-full text-sm text-amber-800">\{blockReason\}<\/p>\}/);
});

// ---------------------------------------------------------------- 4. result step

test("4: result lines say how many products were added as drafts, and how to publish", () => {
  assert.deepEqual(importResultLines({ created: 12, updated: 0, skipped: 0, failed: 0 }), ["12 məhsul qaralama kimi əlavə olundu."]);
  assert.deepEqual(importResultLines({ created: 3, updated: 2, skipped: 1, failed: 4 }), [
    "3 məhsul qaralama kimi əlavə olundu.",
    "2 məhsul yeniləndi; onların statusu dəyişmədi.",
    "1 sətir keçildi.",
    "4 sətir xətalıdır və əlavə olunmayıb.",
  ]);
  assert.match(IMPORT_PUBLISH_HINT, /“Məhsullarım”.*“Redaktə”.*“Aktiv”/);
  // The labels used in the hint are the real ones.
  assert.match(read("components/vendor-product-editor.tsx"), /<option value="ACTIVE">Aktiv<\/option>/);
  assert.match(read("app/vendor/[storeId]/[section]/page.tsx"), /products:"Məhsullarım"/);
  assert.match(read("components/vendor-section.tsx"), /Redaktə<\/Link>/);
});

test("4: the result step shows the summary, the hint and a link to the products list; the jargon sentence is gone", () => {
  const source = wizard();
  assert.doesNotMatch(source, /Faktiki yazılan qeydlər import tarixçəsində göstərilir/);
  assert.match(source, /importResultLines\(resultCounts\)\.map\(line => <p key=\{line\}>\{line\}<\/p>\)/);
  assert.match(source, /\{resultCounts\.created > 0 && <p className="text-slate-600">\{IMPORT_PUBLISH_HINT\}<\/p>\}/);
  assert.match(source, /\{jobUrl && resultCounts\.created > 0 && <Link href=\{`\/vendor\/\$\{encodeURIComponent\(storeId\)\}\/products`\}[^>]*>Məhsullarım bölməsinə keç<\/Link>\}/);
  assert.match(source, /setResultCounts\(\{ created: job\.createdRows, updated: job\.updatedRows, skipped: job\.skippedRows, failed: job\.failedRows \}\);/);
  assert.match(source, /setResultCounts\(\{ created, updated, skipped: 0, failed: result\.errorCount \|\| 0 \}\);/);
  // The products list keeps its status filter in component state only (no URL parameter), so the link opens the plain list.
  assert.match(read("components/vendor-section.tsx"), /\[statusFilter,setStatusFilter\]=useState\(""\)/);
  assert.doesNotMatch(read("components/vendor-section.tsx"), /useSearchParams/);
});

// ---------------------------------------------------------------- 5. error report

test("5: importErrorText turns the stored error list into plain text", () => {
  assert.equal(importErrorText(["Kateqoriya tapılmadı: Yoxdur", "Brend tapılmadı: X"]), "Kateqoriya tapılmadı: Yoxdur; Brend tapılmadı: X");
  assert.equal(importErrorText("Qiymət müsbət olmalıdır"), "Qiymət müsbət olmalıdır");
  assert.equal(importErrorText([{ message: "Məhsul kodu artıq mövcuddur" }, 42, "  "]), "Məhsul kodu artıq mövcuddur");
  assert.equal(importErrorText(null), "Nəticə məlumatı mövcud deyil.");
  assert.equal(importErrorText([]), "Nəticə məlumatı mövcud deyil.");
});

test("5: with the loaded file, the .xlsx report has the original columns of the failed rows plus 'Xəta', and re-uploads cleanly", async () => {
  const { bytes, withSourceColumns } = buildImportErrorReport([
    { rowNumber: 3, errors: ["Qiymət müsbət və icazə verilən həddə olmalıdır"] },
    { rowNumber: 2, errors: ["Kateqoriya tapılmadı: Yoxdur"] },
  ], { headers, rows });
  assert.equal(withSourceColumns, true);
  const table = await readXlsxTable(bufferOf(bytes));
  assert.deepEqual(table.headers, [...headers, ERROR_REPORT_COLUMN]);
  assert.deepEqual(table.rows, [
    { ...rows[1], [ERROR_REPORT_COLUMN]: "Kateqoriya tapılmadı: Yoxdur" },
    { ...rows[2], [ERROR_REPORT_COLUMN]: "Qiymət müsbət və icazə verilən həddə olmalıdır" },
  ], "sorted by row, original values (leading zeros, decimal comma) kept");
  // The seller fixes and uploads the same file: the wizard's reader gives the original columns back.
  const reupload = await readCatalogImportFile({ name: ERROR_REPORT_FILENAME, text: async () => "", arrayBuffer: async () => bufferOf(bytes) });
  assert.equal(reupload.format, "xlsx");
  for (const header of headers) assert.ok(reupload.headers.includes(header), header);
  assert.equal(reupload.rows[0]["Məhsul kodu (istəyə bağlı)"], "A-2");
  const sheet = await unzipEntry(bufferOf(bytes), "xl/workbook.xml");
  assert.match(sheet || "", new RegExp(`<sheet name="${ERROR_REPORT_SHEET}"`));
  const cells = await unzipEntry(bufferOf(bytes), "xl/worksheets/sheet1.xml");
  assert.match(cells || "", /<col min="1" max="1" width="\d+" customWidth="1" style="2"\/>/, "original columns are text-formatted (codes keep zeros)");
});

test("5: a file column already named 'Xəta' is kept, and the report column becomes 'Xəta (2)'; 50 + 1 columns fit", async () => {
  const withXeta = buildImportErrorReport([{ rowNumber: 1, errors: ["x"] }], { headers: ["Ad", "Xəta"], rows: [{ Ad: "A", Xəta: "köhnə" }] });
  assert.deepEqual((await readXlsxTable(bufferOf(withXeta.bytes))).rows, [{ Ad: "A", Xəta: "köhnə", "Xəta (2)": "x" }]);
  const wide = Array.from({ length: 50 }, (_, index) => `Sütun ${index + 1}`);
  const wideReport = buildImportErrorReport([{ rowNumber: 1, errors: ["x"] }], { headers: wide, rows: [Object.fromEntries(wide.map((header) => [header, "v"]))] });
  assert.equal((await readXlsxTable(bufferOf(wideReport.bytes))).headers.length, 51);
});

test("5: without the loaded file (older job, page reloaded) or with row numbers that do not fit, the report is 'Sətir' + 'Xəta'", async () => {
  const fallback = buildImportErrorReport([{ rowNumber: 7, errors: ["Brend tapılmadı: X"] }, { rowNumber: 1, errors: [] }], null);
  assert.equal(fallback.withSourceColumns, false);
  assert.deepEqual(await readXlsxTable(bufferOf(fallback.bytes)), {
    headers: [ERROR_REPORT_ROW_COLUMN, ERROR_REPORT_COLUMN],
    rows: [{ Sətir: "2", Xəta: "Nəticə məlumatı mövcud deyil." }, { Sətir: "8", Xəta: "Brend tapılmadı: X" }],
  }, "line numbers count the header as line 1, like the preview's 'Sətir'");
  assert.equal(buildImportErrorReport([{ rowNumber: 4, errors: ["x"] }], { headers, rows }).withSourceColumns, false, "row 4 is not in a 3-row file");
  assert.equal(buildImportErrorReport([], { headers, rows }).withSourceColumns, true, "empty report still has the file's columns");
});

test("5: the wizard downloads the .xlsx report; original columns only for the job of the file still loaded", () => {
  const source = wizard();
  assert.doesNotMatch(source, /row,errors|bagati-import-errors\.csv|JSON\.stringify\(item\.errors\)/);
  assert.match(source, /failures\.push\(\{ rowNumber: row\.rowNumber, errors: row\.errors \}\)/);
  assert.match(source, /const source = jobId === completedJobId && rows\.length \? \{ headers, rows \} : null;/);
  assert.match(source, /new Blob\(\[bytes as BlobPart\], \{ type: XLSX_MIME \}\)/);
  assert.match(source, /link\.download = ERROR_REPORT_FILENAME;/);
  assert.equal(ERROR_REPORT_FILENAME, "bagati-idxal-xetalari.xlsx");
  // The job pipeline numbers data rows from 1 in upload order (the report maps them back to the loaded rows).
  assert.match(read("lib/catalog-import-client.ts"), /rowNumber: offset \+ index \+ 1/);
});

// ---------------------------------------------------------------- 6. CSV template link removed

test("6: the CSV template link is removed; the Excel template stays and CSV upload is still accepted", () => {
  const source = wizard();
  assert.doesNotMatch(source, /CSV şablonunu yüklə|csvTemplate|data:text\/csv/);
  assert.match(source, />Excel şablonunu yüklə<\/a>/);
  assert.match(source, /accept="\.csv,\.xlsx,text\/csv,application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet"/);
  assert.match(source, /const parsed = await readCatalogImportFile\(file\);/);
});
