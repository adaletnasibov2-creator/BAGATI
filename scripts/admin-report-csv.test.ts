import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAdminReportCsv, escapeAdminReportCsvCell, sanitizeCsvText } from "../lib/admin-report-csv";
import { adminSectionSource } from "./admin-section-source";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("CSV quotes delimiter, quote, and multiline content and prefixes formulas", () => {
  assert.equal(
    buildAdminReportCsv([["product", '=HYPERLINK("https://bad.test")', "comma, quote\" and\r\nnewline"]]),
    '"product","\'=HYPERLINK(""https://bad.test"")","comma, quote"" and\r\nnewline"\r\n',
  );
});

test("CSV prefixes all spreadsheet formula starters after whitespace and control characters", () => {
  const prefixes = ["", " ", "\t", "\r", "\n", "\u0000", "\u001f", "\u007f", "\u0085", "\u009f", "\u00a0", "\u2003", "\u2028", "\ufeff"];
  const starters = ["=", "+", "-", "@"];
  const values = prefixes.flatMap((prefix) => starters.map((starter) => `${prefix}${starter}1+1`));
  const row = values.map((value) => escapeAdminReportCsvCell(value)).join(",");

  assert.equal(row, values.map((value) => `"\'${value}"`).join(","));
  assert.equal(sanitizeCsvText(" \t=1+1"), "' \t=1+1");
  assert.equal(sanitizeCsvText("\u0000\u001f@SUM(A1)"), "'\u0000\u001f@SUM(A1)");
  assert.equal(sanitizeCsvText("\u0085+SUM(A1)"), "'\u0085+SUM(A1)");
  assert.equal(sanitizeCsvText("\ttext"), "'\ttext");
  assert.equal(sanitizeCsvText(" ordinary text"), " ordinary text");
  assert.equal(escapeAdminReportCsvCell(-1.25), "-1.25");

  const productExport = readFileSync(resolve(root, "app/api/admin/products/export/route.ts"), "utf8");
  assert.match(productExport, /escapeAdminReportCsvCell/);
  const reportExport = readFileSync(resolve(root, "app/api/admin/reports/route.ts"), "utf8");
  assert.match(reportExport, /buildAdminReportCsv/);
});

test("CSV retains numeric values and encodes null as an empty cell", () => {
  assert.equal(buildAdminReportCsv([["store", 12, null, -1.25]]), '"store",12,,-1.25\r\n');
});

test("CSV export endpoint and admin report UI are connected and protected", () => {
  const route = readFileSync(resolve(root, "app/api/admin/reports/route.ts"), "utf8");
  const page = adminSectionSource();
  assert.match(route, /requireRole\("ADMIN"\)/);
  assert.match(route, /summarizeDeliveredSales/);
  assert.match(route, /summarizeMonthlyStoreSales/);
  assert.match(page, /\/api\/admin\/reports\?/);
  assert.match(page, /rangeTooLong/);
  assert.match(route, /366 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(page, /366\*24\*60\*60\*1000/);
});
