/**
 * ADMIN-3-EXPORTS-1, commit 2 (T5 of release-output/admin-3-audit-1-report.md): /admin/returns gets status chips, the
 * search box (order number, customer e-mail, store name) and the CSV export through the existing list export
 * (cap + rate limit + audit). Decision forms, refunds logic and pagination unchanged; no new visible text.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { ADMIN_RETURN_STATUSES, adminSearchContains, returnsListWhere } from "../lib/admin-list-where";
import { ADMIN_LIST_EXPORT_MAX_ROWS, ADMIN_LIST_EXPORTS } from "../lib/admin-power-1";
import { ADMIN_LIST_EXPORT_HEADERS, adminListExportAuditData, buildAdminListExport } from "../lib/admin-list-export";
import { exportHref } from "../components/admin-list-toolbar";

const root = process.cwd();
const BASE = "137f314";
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
const TASK = git("log", "--format=%H", "--grep=^ADMIN-3-EXPORTS-1: returns", `${BASE}..HEAD`).trim().split(/\r?\n/).filter(Boolean)[0] ?? null;
const atTask = (path: string) => (TASK ? git("show", `${TASK}:${path}`).replace(/\r\n/g, "\n") : read(path));
const atBase = (path: string) => { try { return git("show", `${BASE}:${path}`).replace(/\r\n/g, "\n"); } catch { return ""; } };
const PAGE = "app/admin/_sections/returns.tsx";

test("filter: status chips (every return status) and search (order number, customer e-mail, store) via the helper", () => {
  assert.deepEqual([...ADMIN_RETURN_STATUSES].sort(), read("prisma/schema.prisma").match(/enum ReturnStatus \{([^}]*)\}/)![1].split(/\s+/).filter(Boolean).sort(), "every ReturnStatus");
  assert.deepEqual(returnsListWhere({}, ""), {}, "default: all returns (as before)");
  assert.deepEqual(returnsListWhere({ status: "REQUESTED" }, ""), { status: "REQUESTED" });
  assert.deepEqual(returnsListWhere({ status: "NOPE" }, ""), {}, "unknown status ignored");
  assert.deepEqual(returnsListWhere({}, "#ab12_cd"), { OR: [
    { storeOrder: { orderId: adminSearchContains("ab12_cd") } },
    { customer: { email: adminSearchContains("#ab12_cd") } },
    { store: { name: adminSearchContains("#ab12_cd") } },
  ] });
  assert.deepEqual(returnsListWhere({ status: "REFUNDED" }, "moda"), { status: "REFUNDED", OR: [
    { storeOrder: { orderId: adminSearchContains("moda") } }, { customer: { email: adminSearchContains("moda") } }, { store: { name: adminSearchContains("moda") } },
  ] });
  assert.equal(adminSearchContains("a%b").contains, "a\\%b", "escaped: % is literal");
});

test("page: chips + search box + CSV button; the same filter for rows and count; table and decision form unchanged", () => {
  const page = atTask(PAGE);
  assert.ok(page.includes("const where=returnsListWhere(sp,q);"));
  assert.ok(page.includes("prisma.returnRequest.findMany({where,include:") && page.includes("prisma.returnRequest.count({where})"), "rows and count use the filter");
  assert.ok(page.includes('<AdminListToolbar path="/admin/returns" sp={sp} options={adminStatusOptions("return",ADMIN_RETURN_STATUSES)} selected={selected} exportList="returns"/><Filters path="/admin/returns" q={q}/>'));
  assert.ok(page.includes(',skip,take})'), "pagination (25 from the section context) kept");
  // The header text, the table columns and the decision form are byte-identical to main.
  const tail = (source: string) => source.slice(source.indexOf("<Table rows={rows}"));
  assert.equal(tail(page), tail(atBase(PAGE)));
  const header = (source: string) => source.slice(source.indexOf("<Header title="), source.indexOf('tamamlanmır."/>') + 'tamamlanmır."/>'.length);
  assert.equal(header(page), header(atBase(PAGE)));
  // Decision logic of returns / refunds untouched.
  assert.equal((TASK ? git("diff", "--name-only", BASE, TASK, "--", "app/api/admin/returns", "app/admin/_sections/refunds.tsx", "lib/return-requests.ts", "lib/refunds.ts") : git("diff", "--name-only", BASE, "--", "app/api/admin/returns", "app/admin/_sections/refunds.tsx")).trim(), "");
});

test("CSV: returns go through the list export (bounded, same filter, display fields, audited)", async () => {
  assert.ok((ADMIN_LIST_EXPORTS as readonly string[]).includes("returns"));
  assert.deepEqual(ADMIN_LIST_EXPORT_HEADERS.returns, ["order_number", "customer_email", "store", "product", "quantity", "refund_amount", "status", "requested_at_baku"]);
  let args: { where?: unknown; take?: number; orderBy?: unknown } = {};
  const row = { refundAmount: "12.50", status: "REQUESTED", createdAt: new Date("2026-11-26T08:00:00Z"), store: { name: "Moda" }, storeOrder: { orderId: "cmabcdef12345678" }, orderItem: { productName: "Köynək", variantName: "M", quantity: 2 }, customer: { email: "buyer@example.invalid" } };
  const db = { returnRequest: { findMany: async (a: typeof args) => { args = a; return [row]; } } };
  const result = await buildAdminListExport(db as never, "returns", { status: "REQUESTED", q: "moda", page: "3" });
  assert.deepEqual(args.where, returnsListWhere({ status: "REQUESTED" }, "moda"));
  assert.equal(args.take, ADMIN_LIST_EXPORT_MAX_ROWS + 1);
  assert.deepEqual(args.orderBy, { createdAt: "desc" });
  assert.deepEqual([result.rowCount, result.truncated, result.filterKeys, result.searched], [1, false, ["status"], true]);
  assert.ok(result.csv.includes('"#12345678","buyer@example.invalid","Moda","Köynək · M",2,"12.50","Sorğu göndərildi"'), result.csv);
  assert.equal(adminListExportAuditData("admin-1", "returns", result).entityId, "returns");
  // The route accepts it through ADMIN_LIST_EXPORTS (auth, rate limit and audit as for every list).
  assert.match(read("app/api/admin/list-export/[list]/route.ts"), /if \(!\(ADMIN_LIST_EXPORTS as readonly string\[\]\)\.includes\(list\)\)/);
  assert.equal(exportHref("returns", { status: "REQUESTED", q: "moda", page: "2" }), "/api/admin/list-export/returns?status=REQUESTED&q=moda", "the page's filters, without the page number");
});

function visibleTexts(source: string): Set<string> {
  const code = source.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*\*|\{\/\*)/.test(line)).join("\n");
  const out = new Set<string>();
  for (const part of code.split(/["'`<>{}]|\$\{/)) { const t = part.trim(); if (/[əğıöüşçƏĞİÖÜŞÇ]/.test(t)) out.add(t); }
  for (const m of code.matchAll(/>([^<>{}\n]*[A-Za-zƏəĞğİıÖöÜüŞşÇç][^<>{}\n]*)</g)) out.add(m[1].trim());
  for (const m of code.matchAll(/"([A-ZƏĞİÖÜŞÇ][^"\n]*\s[^"\n]*)"/g)) out.add(m[1].trim());
  return out;
}

test("no new visible text (incl. plain words); scope of this commit", () => {
  const files = [PAGE, "lib/admin-list-export.ts", "lib/admin-list-where.ts", "lib/admin-power-1.ts"];
  for (const path of files) {
    const before = visibleTexts(atBase(path));
    const added = [...visibleTexts(atTask(path))].filter((t) => !before.has(t));
    assert.deepEqual(added, [], `${path}: new visible text`);
  }
  if (TASK) {
    const parent = git("rev-parse", `${TASK}^`).trim();
    const changed = git("diff", "--name-only", parent, TASK).split(/\r?\n/).filter(Boolean).sort();
    assert.deepEqual(changed, [PAGE, "lib/admin-list-export.ts", "lib/admin-list-where.ts", "lib/admin-power-1.ts", "scripts/admin-returns-list.test.ts"].sort());
  }
});
