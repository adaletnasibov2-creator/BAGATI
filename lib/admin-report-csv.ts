export type AdminReportCsvRow = readonly (string | number | null)[];

export function sanitizeCsvText(value: string) {
  const formulaAfterWhitespace = /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/u.test(value);
  const leadingTabOrCarriageReturn = /^[\t\r]/.test(value);
  return formulaAfterWhitespace || leadingTabOrCarriageReturn ? `'${value}` : value;
}

export function escapeAdminReportCsvCell(value: AdminReportCsvRow[number]) {
  if (value === null) return "";
  if (typeof value === "number") return String(value);
  const safe = sanitizeCsvText(value);
  return `"${safe.replaceAll('"', '""')}"`;
}

export function buildAdminReportCsv(rows: readonly AdminReportCsvRow[]) {
  return rows.map((row) => row.map(escapeAdminReportCsvCell).join(",")).join("\r\n") + "\r\n";
}
