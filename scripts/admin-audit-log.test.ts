import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  AUDIT_CSV_HEADER,
  AUDIT_EXPORT_MAX_ROWS,
  auditFiltersForAudit,
  auditFiltersToSearchParams,
  bakuDayBounds,
  buildAuditLogCsv,
  escapeLikePattern,
  formatBakuDateTime,
  isSensitiveMetadataKey,
  parseAuditLogFilters,
  summarizeAuditMetadata,
  type AuditExportRow,
} from "../lib/admin-audit-log";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

test("audit page and CSV export require the ADMIN role", () => {
  assert.match(read("app/admin/audit-log/page.tsx"), /const admin = await requireRole\("ADMIN"\);\s*if \(!admin\) redirect\("\/admin\/login"\)/);
  const route = read("app/api/admin/audit-log/export/route.ts");
  assert.match(route, /export async function GET[\s\S]*?const admin = await requireRole\("ADMIN"\);\s*if \(!admin\) return NextResponse\.json\(\{ error: "İcazə yoxdur" \}, \{ status: 403 \}\)/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  // The old catch-all branch is gone, so the dedicated page is the only audit list.
  assert.doesNotMatch(read("app/admin/[...section]/page.tsx"), /route==="audit-log"/);
});

test("the export writes an AUDIT_EXPORT entry and never selects IP, user agent or tokens", () => {
  const query = read("lib/admin-audit-log-query.ts");
  assert.match(query, /action: AUDIT_EXPORT_ACTION/);
  assert.match(query, /rowCount: result\.rowCount/);
  assert.doesNotMatch(query, /"ip"|userAgent|"token"|sourceIp/i);
  assert.match(query, /SET LOCAL statement_timeout/);
});

test("filters: empty input means no filters", () => {
  assert.deepEqual(parseAuditLogFilters({}), { filters: {}, errors: [] });
  assert.deepEqual(parseAuditLogFilters({ actor: " ", action: "", page: "2" }), { filters: {}, errors: [] });
});

test("filters: valid values are parsed and trimmed", () => {
  const { filters, errors } = parseAuditLogFilters({
    actor: " Admin@Example.COM ", action: "STORE_REVIEW", entityType: "Store", entityId: "clx123abc", from: "2026-11-01", to: "2026-11-13", q: " 50% ",
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(filters, {
    actor: { kind: "email", value: "admin@example.com" }, action: "STORE_REVIEW", entityType: "Store", entityId: "clx123abc", from: "2026-11-01", to: "2026-11-13", q: "50%",
  });
  assert.deepEqual(parseAuditLogFilters({ actor: "system" }).filters.actor, { kind: "system" });
  assert.deepEqual(parseAuditLogFilters({ actor: "SYSTEM" }).filters.actor, { kind: "system" });
  assert.deepEqual(parseAuditLogFilters({ actor: "cm0abc123def456ghi789" }).filters.actor, { kind: "id", value: "cm0abc123def456ghi789" });
});

test("filters: invalid values are dropped with a message and never reach SQL", () => {
  const { filters, errors } = parseAuditLogFilters({
    actor: "x'; DROP TABLE", action: "A B", entityType: "Store;--", entityId: "a\u0000b", from: "2026-02-30", to: "13/11/2026", q: "x".repeat(101),
  });
  assert.deepEqual(filters, {});
  assert.equal(errors.length, 7);
});

test("filters: a reversed date range is rejected", () => {
  const { filters, errors } = parseAuditLogFilters({ from: "2026-11-13", to: "2026-11-01" });
  assert.equal(filters.from, undefined);
  assert.equal(filters.to, undefined);
  assert.equal(errors.length, 1);
});

test("Baku day bounds are a half-open UTC interval", () => {
  const bounds = bakuDayBounds("2026-11-13");
  assert.equal(bounds?.start.toISOString(), "2026-11-12T20:00:00.000Z");
  assert.equal(bounds?.endExclusive.toISOString(), "2026-11-13T20:00:00.000Z");
  assert.equal(bakuDayBounds("2026-13-01"), null);
  assert.equal(bakuDayBounds("2026-1-1"), null);
});

test("filter query string is canonical so pagination links are stable", () => {
  const a = parseAuditLogFilters({ q: "x", action: "CREATE", actor: "system", junk: "1" }).filters;
  const b = parseAuditLogFilters({ actor: "system", action: "CREATE", q: "x" }).filters;
  assert.equal(auditFiltersToSearchParams(a).toString(), auditFiltersToSearchParams(b).toString());
  assert.equal(auditFiltersToSearchParams(a).toString(), "actor=system&action=CREATE&q=x");
  assert.equal(auditFiltersToSearchParams({}).toString(), "");
});

test("the AUDIT_EXPORT entry does not store an actor e-mail filter value", () => {
  const { filters } = parseAuditLogFilters({ actor: "someone@example.com", action: "CREATE" });
  assert.deepEqual(auditFiltersForAudit(filters), { actor: "email-filter", action: "CREATE" });
});

test("LIKE wildcards in free text are matched literally", () => {
  assert.equal(escapeLikePattern("50%_off\\x"), "50\\%\\_off\\\\x");
});

test("sensitive metadata keys are redacted in the CSV summary", () => {
  for (const key of ["ip", "sourceIp", "clientIP", "client_ip", "ipAddress", "userAgent", "resetToken", "codeHash", "contactEmail", "contactPhone", "password", "recipient"]) {
    assert.equal(isSensitiveMetadataKey(key), true, key);
  }
  for (const key of ["membership", "reasonCode", "status", "storeId", "relationship", "description"]) {
    assert.equal(isSensitiveMetadataKey(key), false, key);
  }
  assert.equal(summarizeAuditMetadata({ ip: "203.0.113.5", reasonCode: "abuse", nested: { userAgent: "x" } }), '{"ip":"[gizlədilib]","reasonCode":"abuse","nested":{"userAgent":"[gizlədilib]"}}');
  assert.equal(summarizeAuditMetadata(null), "");
  assert.equal(summarizeAuditMetadata({}), "");
  assert.equal(summarizeAuditMetadata({ note: "x".repeat(5000) }).length, 1000);
});

const row = (overrides: Partial<AuditExportRow> = {}): AuditExportRow => ({
  createdAt: new Date("2026-11-13T08:30:15.123Z"), actorId: "admin1", actorRole: "ADMIN", action: "STORE_REVIEW", entityType: "Store", entityId: "s1", metadata: null, ...overrides,
});

test("CSV has a UTF-8 BOM, a fixed header, UTC and Baku times, and CRLF line endings", () => {
  const { csv, rowCount, truncated } = buildAuditLogCsv([row({ metadata: { note: "Mağaza təsdiqləndi — çox gözəl" } })]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const lines = csv.slice(1).split("\r\n");
  assert.equal(lines[0], AUDIT_CSV_HEADER.map((h) => `"${h}"`).join(","));
  assert.equal(lines[1], '"2026-11-13 08:30:15","2026-11-13 12:30:15","admin1","ADMIN","STORE_REVIEW","Store","s1","{""note"":""Mağaza təsdiqləndi — çox gözəl""}"');
  assert.equal(lines[2], "");
  assert.equal(rowCount, 1);
  assert.equal(truncated, false);
  assert.equal(Buffer.from(csv, "utf8").subarray(0, 3).toString("hex"), "efbbbf");
});

test("CSV marks system entries and never contains an e-mail column", () => {
  const { csv } = buildAuditLogCsv([row({ actorId: null, actorRole: null })]);
  assert.match(csv, /"","SYSTEM","STORE_REVIEW"/);
  assert.doesNotMatch(csv.split("\r\n")[0], /email|ip|agent/i);
});

test("CSV cells that start with = + - @ (or tab/CR) are prefixed against formula injection", () => {
  const dangerous = ["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", " =1", "\t=1"];
  for (const value of dangerous) {
    const { csv } = buildAuditLogCsv([row({ entityId: value })]);
    const cell = csv.split("\r\n")[1].split('","')[6];
    assert.ok(cell.startsWith("'"), `${JSON.stringify(value)} → ${cell}`);
  }
  const { csv } = buildAuditLogCsv([row({ action: "a\"b", entityId: "line1\nline2" })]);
  assert.match(csv, /"a""b"/);
  assert.match(csv, /"line1\nline2"/);
});

test("CSV is capped at the row limit and reports truncation", () => {
  assert.equal(AUDIT_EXPORT_MAX_ROWS, 10_000);
  const rows = Array.from({ length: 12 }, (_, index) => row({ entityId: `e${index}` }));
  const capped = buildAuditLogCsv(rows, 10);
  assert.equal(capped.rowCount, 10);
  assert.equal(capped.truncated, true);
  assert.equal(capped.csv.slice(1).trimEnd().split("\r\n").length, 11);
  const exact = buildAuditLogCsv(rows.slice(0, 10), 10);
  assert.equal(exact.truncated, false);
  const full = buildAuditLogCsv(Array.from({ length: AUDIT_EXPORT_MAX_ROWS + 1 }, () => row()));
  assert.equal(full.rowCount, AUDIT_EXPORT_MAX_ROWS);
  assert.equal(full.truncated, true);
});

test("Baku time formatting", () => {
  assert.equal(formatBakuDateTime(new Date("2026-12-31T21:00:00Z")), "2027-01-01 01:00:00");
});
