/**
 * Messaging phase 8 (admin reports): static checks. Behaviour on PostgreSQL: scripts/messaging-admin.integration.test.ts.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { ADMIN_MESSAGING_NAV_HREF, ADMIN_NAV_GROUPS } from "../lib/admin-nav";
import { CONVERSATION_ADMIN_VIEW, REPORT_DECISION_ACTIONS, reportReasonLabel } from "../lib/messaging-admin";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");
const files = (dir: string): string[] => readdirSync(resolve(process.cwd(), dir)).flatMap((name) => {
  const path = join(dir, name).replace(/\\/g, "/");
  return statSync(resolve(process.cwd(), path)).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
});
const admin = read("lib/messaging-admin.ts");
const slice = (from: string, to: string) => admin.slice(admin.indexOf(from), admin.indexOf(to));

test("route: same-origin first, then ADMIN, then the audited decision; only REVIEWED or DISMISSED", () => {
  const route = read("app/api/admin/messages/reports/[reportId]/route.ts");
  const order = ["csrfRejection(request)", 'requireRole("ADMIN")', "decideReport(prisma"].map((step) => route.indexOf(step));
  assert.ok(order.every((index, i) => index > 0 && (i === 0 || index > order[i - 1])), `order ${order}`);
  assert.match(route, /if \(status !== "REVIEWED" && status !== "DISMISSED"\) return json/);
  assert.doesNotMatch(route, /export (async function|const) (GET|PUT|PATCH|DELETE)/, "POST only");
  assert.deepEqual(REPORT_DECISION_ACTIONS, { REVIEWED: "CONVERSATION_REPORT_REVIEWED", DISMISSED: "CONVERSATION_REPORT_DISMISSED" });
});

test("pages: ADMIN only; the list shows no message text; opening goes through openReportForAdmin; links do not prefetch", () => {
  for (const file of ["app/admin/messages/reports/page.tsx", "app/admin/messages/reports/[reportId]/page.tsx"]) {
    assert.match(read(file), /const admin = await requireRole\("ADMIN"\);\n  if \(!admin\) redirect\("\/admin\/login"\);/, file);
  }
  const list = read("app/admin/messages/reports/page.tsx");
  assert.match(list, /listConversationReports\(prisma/);
  assert.doesNotMatch(list, /\.body\b|\.note\b|openReportForAdmin/);
  assert.match(list, /<Link prefetch=\{false\} href=\{`\/admin\/messages\/reports\/\$\{encodeURIComponent\(item\.id\)\}`\}/);
  const detail = read("app/admin/messages/reports/[reportId]/page.tsx");
  assert.match(detail, /const opened = await openReportForAdmin\(prisma, \{ reportId, adminId: admin\.id \}\);/);
  assert.doesNotMatch(detail, /dangerouslySetInnerHTML/);
  assert.match(detail, /<p className="whitespace-pre-wrap break-words text-sm leading-6">\{message\.body\}<\/p>/);
  // The list query selects no message body and no reporter note.
  assert.doesNotMatch(slice("export async function listConversationReports", "export async function openReportForAdmin"), /body|note/);
});

test("every open is audited before anything is read, in the same transaction", () => {
  const open = slice("export async function openReportForAdmin", "export async function decideReport");
  assert.match(open, /return db\.\$transaction\(async \(tx\) => \{/);
  const audit = open.indexOf("tx.auditLog.create(");
  assert.ok(audit > 0 && audit < open.indexOf("tx.conversation.findUniqueOrThrow(") && audit < open.indexOf("tx.conversationMessage.findMany("), "audit row first");
  assert.match(open, /action: CONVERSATION_ADMIN_VIEW, entityType: "Conversation", entityId: report\.conversationId, metadata: \{ reportId: report\.id \}/);
  assert.equal(CONVERSATION_ADMIN_VIEW, "CONVERSATION_ADMIN_VIEW");
  const decide = slice("export async function decideReport", "\n}\n\n\n");
  assert.match(decide, /where: \{ id: report\.id, status: "OPEN" \}/);
  assert.match(decide, /tx\.auditLog\.create\(\{\n\s+data: \{ actorId: input\.adminId, action: REPORT_DECISION_ACTIONS\[input\.status\]/);
});

test("no admin access to unreported conversations: only lib/messaging-admin.ts reads them, and only through a report", () => {
  const adminReachable = [...files("app/admin"), ...files("app/api/admin"), ...files("lib").filter((file) => /^lib\/admin/.test(file)), ...files("components").filter((file) => /^components\/admin/.test(file))];
  for (const file of adminReachable) {
    assert.doesNotMatch(read(file), /\.(conversation|conversationMessage|conversationReport|conversationBlock)\.|messaging-service|messaging-views/, `${file} does not touch conversations directly`);
  }
  // The admin service exposes no conversation lookup: its only inputs are a report id, a status filter and paging.
  const exported = [...admin.matchAll(/export async function (\w+)\(db: Db, input: \{([^}]*)\}/g)].map(([, name, args]) => [name, args.trim()]);
  assert.deepEqual(exported, [
    ["listConversationReports", "status?: ReportStatus | null; skip?: number; take?: number"],
    ["openReportForAdmin", "reportId: string; adminId: string"],
    ["decideReport", 'reportId: string; adminId: string; status: "REVIEWED" | "DISMISSED"; now?: Date'],
  ]);
  assert.match(admin, /tx\.conversation\.findUniqueOrThrow\(\{\n\s+where: \{ id: report\.conversationId \}/);
  assert.match(admin, /tx\.conversationMessage\.findMany\(\{\n\s+where: \{ conversationId: conversation\.id \}/);
  assert.equal(admin.match(/\.conversation\.find/g)?.length, 1, "one conversation read, keyed by the report");
});

test("admin menu: Mesaj şikayətləri in Məzmun, hidden unless messaging is ON; every AdminShell gets the flag", () => {
  assert.equal(ADMIN_MESSAGING_NAV_HREF, "/admin/messages/reports");
  assert.ok(ADMIN_NAV_GROUPS.find((group) => group.id === "content")?.items.some(([href, label]) => href === ADMIN_MESSAGING_NAV_HREF && label === "Mesaj şikayətləri"));
  assert.match(read("components/admin-shell.tsx"), /\(href !== ADMIN_MESSAGING_NAV_HREF \|\| messagingEnabled\) && /);
  assert.match(read("components/admin-shell.tsx"), /export default function AdminShell\(\{ children, email, messagingEnabled = false \}: AdminShellProps\)/);
  const callers = files("app/admin").filter((file) => read(file).includes("<AdminShell"));
  assert.ok(callers.length >= 13);
  for (const file of callers) {
    for (const use of read(file).match(/<AdminShell [^>]*>/g) ?? []) assert.match(use, /messagingEnabled=\{/, `${file}: ${use}`);
  }
  assert.match(read("lib/messaging-pages.ts"), /export async function adminMessagingNavEnabled\(\): Promise<boolean> \{\n  return \(await loadMessagingSettings\(\)\)\.enabled;/);
  assert.equal(reportReasonLabel("SPAM"), "Spam");
  assert.equal(reportReasonLabel("WEIRD"), "WEIRD");
});
