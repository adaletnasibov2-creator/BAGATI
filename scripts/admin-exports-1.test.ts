/**
 * ADMIN-3-EXPORTS-1, commit 1 (T4 of release-output/admin-3-audit-1-report.md): export safety.
 * (a) products CSV: at most ADMIN_LIST_EXPORT_MAX_ROWS rows (truncation like the list export), same filters and format;
 * (b) sales report CSV: bounded read and rows, 366-day limit kept;
 * (c) both: ADMIN only, shared export rate limit, one ADMIN_LIST_EXPORT audit row with the export name and row count;
 * (d) ADMIN_LIST_EXPORT is in SECURITY_AUDIT_ACTIONS (its label already existed);
 * (e) the subscriptions search box filters through adminSearchContains;
 * (f) no new visible text (also plain words without special letters); scope = BASE..this commit.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { ADMIN_LIST_EXPORT_MAX_ROWS, ADMIN_LIST_EXPORT_RATE_LIMIT } from "../lib/admin-power-1";
import { adminListExportAuditData } from "../lib/admin-list-export";
import { buildProductsExport, PRODUCT_EXPORT_HEADER, productExportCsv, productExportWhere, readProductExportRows } from "../lib/admin-products-export";
import { buildAdminSalesExport, SALES_EXPORT_HEADER } from "../lib/admin-reports-export";
import { AUDIT_ACTION_LABELS, SECURITY_AUDIT_ACTIONS } from "../lib/audit-action-labels";
import { adminSearchContains, subscriptionsListWhere } from "../lib/admin-list-where";

const root = process.cwd();
const BASE = "137f314";
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
const TASK = git("log", "--format=%H", "--grep=^ADMIN-3-EXPORTS-1: export safety", `${BASE}..HEAD`).trim().split(/\r?\n/).filter(Boolean)[0] ?? null;
const atTask = (path: string) => (TASK ? git("show", `${TASK}:${path}`).replace(/\r\n/g, "\n") : read(path));
const atBase = (path: string) => { try { return git("show", `${BASE}:${path}`).replace(/\r\n/g, "\n"); } catch { return ""; } };

// ---- fake product table with id-cursor paging ----
type P = { id: string; name: string; sku: string | null; description: string | null; price: { toString(): string }; discountPrice: null; status: string; images: string[]; category: { name: string } | null; store: { name: string }; inventory: { quantity: number }[]; variants: never[] };
const product = (i: number): P => ({ id: `p${String(i).padStart(6, "0")}`, name: `Məhsul ${i}`, sku: `SKU-${i}`, description: null, price: { toString: () => "12.50" }, discountPrice: null, status: "ACTIVE", images: ["/a.webp"], category: { name: "Ev" }, store: { name: "Mağaza" }, inventory: [{ quantity: 3 }], variants: [] });
function productDb(count: number) {
  const all = Array.from({ length: count }, (_, i) => product(i));
  const calls: Array<{ take: number; cursor?: string }> = [];
  return {
    calls,
    db: { product: { findMany: async (args: { take: number; cursor?: { id: string }; skip?: number }) => {
      calls.push({ take: args.take, cursor: args.cursor?.id });
      const start = args.cursor ? all.findIndex((p) => p.id === args.cursor!.id) + 1 : 0;
      return all.slice(start, start + args.take);
    } } },
  };
}

test("(a) products: bounded read (max + 1 in 250-row cursor pages), truncation like the list export", async () => {
  const small = productDb(7);
  assert.equal((await readProductExportRows(small.db as never, {}, 3)).length, 4, "max + 1 rows at most");
  const exact = productDb(2);
  assert.equal((await readProductExportRows(exact.db as never, {}, 3)).length, 2);
  const big = productDb(ADMIN_LIST_EXPORT_MAX_ROWS + 3);
  const result = await buildProductsExport(big.db as never, { status: "ACTIVE", q: "x" });
  assert.equal(result.rowCount, ADMIN_LIST_EXPORT_MAX_ROWS);
  assert.equal(result.truncated, true);
  assert.ok(big.calls.every((call) => call.take <= 250), "pages of at most 250");
  assert.equal(big.calls.reduce((sum, call) => sum + call.take, 0), ADMIN_LIST_EXPORT_MAX_ROWS + 1, "never more than max + 1 requested");
  assert.deepEqual([result.filterKeys, result.searched], [["status"], true]);
  const under = await buildProductsExport(productDb(5).db as never, {});
  assert.deepEqual([under.rowCount, under.truncated], [5, false]);
});

test("(a) products: same filters and byte-identical CSV format as before", () => {
  assert.deepEqual(productExportWhere({ q: "a%b", storeId: "s1", categoryId: "c1", status: "DRAFT" }), {
    status: "DRAFT", storeId: "s1", category: { OR: [{ id: "c1" }, { parentId: "c1" }] },
    OR: [{ name: adminSearchContains("a%b") }, { sku: adminSearchContains("a%b") }, { store: { name: adminSearchContains("a%b") } }],
  });
  const csv = productExportCsv([product(1) as never]);
  // escapeAdminReportCsvCell quotes every cell (as the old streaming route did).
  assert.equal(csv, '﻿"id","name","sku","description","category","store","price","discountPrice","status","stock","images","variants"\r\n"p000001","Məhsul 1","SKU-1","","Ev","Mağaza","12.50","","ACTIVE","3","[""/a.webp""]","[]"\r\n');
  // The old route built the same header and the same per-product cells.
  const old = atBase("app/api/admin/products/export/route.ts");
  assert.ok(old.includes(`const header = [${PRODUCT_EXPORT_HEADER.map((h) => `"${h}"`).join(", ")}].map(escapeAdminReportCsvCell).join(",");`));
  assert.ok(old.includes("JSON.stringify(product.images),\n              JSON.stringify(variants),\n            ].map(escapeAdminReportCsvCell).join(\",\");"));
});

test("(b) sales report: read bounded to max + 1, oldest first; rows capped; header unchanged", async () => {
  let args: { take?: number; orderBy?: unknown; where?: unknown } = {};
  const db = {
    storeOrder: { findMany: async (a: typeof args) => { args = a; return []; } },
    store: { findMany: async () => [] },
  };
  const from = new Date("2026-11-01T00:00:00Z"), to = new Date("2026-11-26T00:00:00Z");
  const result = await buildAdminSalesExport(db as never, { from, to, storeId: "s1" });
  assert.equal(args.take, ADMIN_LIST_EXPORT_MAX_ROWS + 1);
  assert.deepEqual(args.orderBy, { createdAt: "asc" });
  assert.deepEqual(args.where, { status: "DELIVERED", OR: [{ deliveredAt: { gte: from, lte: to } }, { deliveredAt: null, createdAt: { gte: from, lte: to } }], storeId: "s1" });
  assert.equal(result.csv, `﻿${SALES_EXPORT_HEADER.map((h) => `"${h}"`).join(",")}\r\n`, "header only (no delivered orders)");
  assert.deepEqual([result.rowCount, result.truncated, result.filterKeys, result.searched], [0, false, ["from", "storeId", "to"], false]);
  // More delivered store orders than the cap: marked truncated, computed on the first max.
  const many = Array.from({ length: 4 }, (_, i) => ({ id: `so${i}`, storeId: "s1", store: { id: "s1", name: "M" }, status: "DELIVERED", subtotal: "10", commissionRate: null, createdAt: new Date("2026-11-02T10:00:00Z"), deliveredAt: new Date("2026-11-03T10:00:00Z"), items: [], returnRequests: [] }));
  const capped = await buildAdminSalesExport({ storeOrder: { findMany: async () => many }, store: { findMany: async () => [] } } as never, { from, to }, 3);
  assert.equal(capped.truncated, true);
  assert.equal(read("app/api/admin/reports/route.ts").includes('if (to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) {'), true, "366-day limit kept");
  assert.ok(atBase("app/api/admin/reports/route.ts").includes(`"type", "period", "store_or_product", "orders_or_lines", "quantity", "net_sales_azn", "commission_rate", "commission_azn",`), "same header as before");
});

test("(c) both routes: ADMIN only, shared export rate limit, one ADMIN_LIST_EXPORT audit row; headers like the list export", () => {
  for (const [path, name] of [["app/api/admin/products/export/route.ts", "products"], ["app/api/admin/reports/route.ts", "reports"]] as const) {
    const route = atTask(path);
    const auth = route.indexOf('const admin = await requireRole("ADMIN");');
    const limit = route.indexOf('if (!allowAdminRequest("admin-list-export", admin.id, request.headers, ADMIN_LIST_EXPORT_RATE_LIMIT)) return rateLimitedResponse(60);');
    const auditAt = route.indexOf(`await prisma.auditLog.create({ data: adminListExportAuditData(admin.id, "${name}", result) });`);
    const respond = route.lastIndexOf("return new ");
    assert.ok(auth > 0 && limit > auth && auditAt > limit && respond > auditAt, `${path}: auth -> rate limit -> read -> audit -> response`);
    assert.ok(route.includes('"X-Export-Rows": String(result.rowCount)') && route.includes('"X-Export-Truncated": result.truncated ? "1" : "0"'), path);
    assert.ok(route.includes('"Cache-Control": "no-store"'), path);
  }
  assert.deepEqual(ADMIN_LIST_EXPORT_RATE_LIMIT, { limit: 10, windowMs: 60_000 });
  const audit = adminListExportAuditData("admin-1", "products", { filterKeys: ["status"], searched: true, rowCount: 12, truncated: false });
  assert.deepEqual(audit, { actorId: "admin-1", action: "ADMIN_LIST_EXPORT", entityType: "AdminList", entityId: "products", metadata: { list: "products", filterKeys: ["status"], searched: true, rowCount: 12, truncated: false, maxRows: ADMIN_LIST_EXPORT_MAX_ROWS } });
  assert.equal(adminListExportAuditData("a", "reports", { filterKeys: [], searched: false, rowCount: 0, truncated: true }).entityId, "reports");
});

test("(d) ADMIN_LIST_EXPORT shows in the security summary (its label already existed)", () => {
  assert.ok((SECURITY_AUDIT_ACTIONS as readonly string[]).includes("ADMIN_LIST_EXPORT"));
  assert.equal(AUDIT_ACTION_LABELS.ADMIN_LIST_EXPORT, "Admin siyahısı ixrac edildi");
  assert.ok(atBase("lib/audit-action-labels.ts").includes('ADMIN_LIST_EXPORT: "Admin siyahısı ixrac edildi"'), "label existed before this task");
});

test("(e) subscriptions: the search box filters (store name, slug, seller name, seller e-mail) together with the status", () => {
  assert.deepEqual(subscriptionsListWhere({}, ""), { AND: [{}, {}] });
  const where = subscriptionsListWhere({ status: "PENDING" }, "moda_");
  assert.deepEqual(where, { AND: [
    { OR: [{ subscription: { is: { status: "PENDING" } } }, { subscription: { is: null } }] },
    { OR: [{ name: adminSearchContains("moda_") }, { slug: adminSearchContains("moda_") }, { vendor: { displayName: adminSearchContains("moda_") } }, { vendor: { user: { email: adminSearchContains("moda_") } } }] },
  ] });
  assert.deepEqual(subscriptionsListWhere({ status: "ACTIVE" }, ""), { AND: [{ OR: [{ subscription: { is: { status: "ACTIVE" } } }] }, {}] });
  assert.deepEqual(subscriptionsListWhere({ status: "NOPE" }, ""), { AND: [{}, {}] }, "unknown status ignored, as before");
  const page = atTask("app/admin/_sections/subscriptions.tsx");
  assert.ok(page.includes("const where=subscriptionsListWhere(sp,q);"));
  assert.ok(page.includes('<Filters path="/admin/subscriptions" q={q}>'), "the existing search box");
});

/** Visible-looking strings: Azerbaijani fragments, JSX text nodes, and quoted phrases that start with a capital letter. */
export function visibleTexts(source: string): Set<string> {
  const code = source.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*\*|\{\/\*)/.test(line)).join("\n");
  const out = new Set<string>();
  for (const part of code.split(/["'`<>{}]|\$\{/)) { const t = part.trim(); if (/[əğıöüşçƏĞİÖÜŞÇ]/.test(t)) out.add(t); }
  for (const m of code.matchAll(/>([^<>{}\n]*[A-Za-zƏəĞğİıÖöÜüŞşÇç][^<>{}\n]*)</g)) out.add(m[1].trim());
  for (const m of code.matchAll(/"([A-ZƏĞİÖÜŞÇ][^"\n]*\s[^"\n]*)"/g)) out.add(m[1].trim());
  return out;
}

test("(f) no new visible text (incl. plain words); scope of this commit", () => {
  const files = ["app/api/admin/products/export/route.ts", "app/api/admin/reports/route.ts", "lib/admin-products-export.ts", "lib/admin-reports-export.ts", "lib/admin-list-export.ts", "lib/admin-list-where.ts", "lib/audit-action-labels.ts", "app/admin/_sections/subscriptions.tsx"];
  const before = new Set<string>();
  for (const path of [...files, "app/api/admin/list-export/[list]/route.ts"]) for (const t of visibleTexts(atBase(path))) before.add(t);
  for (const path of files) {
    const added = [...visibleTexts(atTask(path))].filter((t) => !before.has(t));
    assert.deepEqual(added, [], `${path}: new visible text`);
  }
  if (TASK) {
    const changed = git("diff", "--name-only", BASE, TASK).split(/\r?\n/).filter(Boolean).sort();
    // + three older tests that followed the moved code: admin-design-2 (reads its own commit), admin-fixes (the
    // subscriptions filter line), admin-report-csv (the CSV building now in the two lib files).
    // + multi-process.test.ts: the two new admin export rate-limit calls in its approved inventory.
    assert.deepEqual(changed, [...files, "scripts/admin-design-2.test.ts", "scripts/admin-exports-1.test.ts", "scripts/admin-fixes.test.ts", "scripts/admin-report-csv.test.ts", "scripts/multi-process.test.ts"].sort());
  }
  const untouched = ["prisma", "package.json", "package-lock.json", "app/(customer)/terms", "app/(customer)/privacy", "app/(customer)/seller-terms"];
  assert.equal((TASK ? git("diff", "--name-only", BASE, TASK, "--", ...untouched) : git("diff", "--name-only", BASE, "--", ...untouched)).trim(), "");
});
