/**
 * ADMIN-3-TEXTS-1 (T6 of release-output/admin-3-audit-1-report.md): exactly the owner-approved admin text changes.
 * (a) each approved item: the new text is there and the old text is gone;
 * (b) a scanner over every changed file: the only visible strings that changed (Azerbaijani, English and plain words)
 *     are the approved ones;
 * (c) scope = BASE..this commit, exact file list; no legal / customer page, no logic, no schema.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { adminRoleLabel } from "../lib/admin-power-1";
import { AUDIT_ACTION_LABELS, auditActionLabel } from "../lib/audit-action-labels";

const root = process.cwd();
const BASE = "d010263";
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
const TASK = git("log", "--format=%H", "--grep=^ADMIN-3-TEXTS-1", `${BASE}..HEAD`).trim().split(/\r?\n/).filter(Boolean)[0] ?? null;
const atTask = (path: string) => (TASK ? git("show", `${TASK}:${path}`).replace(/\r\n/g, "\n") : read(path));
const atBase = (path: string) => { try { return git("show", `${BASE}:${path}`).replace(/\r\n/g, "\n"); } catch { return ""; } };

const R = "app/api/admin/[...resource]/route.ts";
/** [file, old, new] per approved change (exact source strings). */
const ITEMS: Array<[number | string, string, string, string]> = [
  [1, R, '"Active city not found"', '"Aktiv şəhər tapılmadı"'],
  [2, R, '"Active vendor profile not found"', '"Aktiv satıcı profili tapılmadı"'],
  [3, R, '"Map URL must use HTTPS"', '"Xəritə linki HTTPS ilə başlamalıdır"'],
  [4, R, "yalnız admin yoxlama workflow-u ilə", "yalnız admin yoxlama prosesi ilə"],
  [5, "app/admin/verification/page.tsx", "SMTP qəbul cavabı inbox-a çatdırılmanı", "SMTP qəbul cavabı gələn qutusuna çatdırılmanı"],
  [6, "components/admin-store-profile-form.tsx", 'label: "Logo HTTPS URL"', 'label: "Logo HTTPS linki"'],
  ["7a", "components/admin-system-status.tsx", '<Row label="Worker" ', '<Row label="İşçi proses" '],
  ["7b", "components/admin-system-status.tsx", '<Row label="Build ID">', '<Row label="Versiya nömrəsi">'],
  [8, R, '{ error: "Rəy identifikatoru yanlışdır" }, { status: 422 });\n  if (section === "categories")', '{ error: section === "categories" ? "Kateqoriya identifikatoru yanlışdır" : "Rəy identifikatoru yanlışdır" }, { status: 422 });\n  if (section === "categories")'],
  ["9a", "app/api/admin/stores/[storeId]/activation/route.ts", "görünürlüğü", "görünürlüyü"],
  ["9b", "components/admin-store-activation-action.tsx", "görünürlüğü", "görünürlüyü"],
  ["9c", "lib/admin-store-product-publishing.ts", "görünürlüğü", "görünürlüyü"],
  ["10a", "app/admin/seller-applications/[id]/page.tsx", "· rol {row.role}</li>", "· rol {adminRoleLabel(row.role)}</li>"],
  ["10b", "app/admin/seller-applications/[id]/page.tsx", '<Field label="Hazırkı rol">{application.user.role}</Field>', '<Field label="Hazırkı rol">{adminRoleLabel(application.user.role)}</Field>'],
  ["10c", "app/admin/_sections/notifications.tsx", "${r.user.email} · ${r.user.role}", "${r.user.email} · ${adminRoleLabel(r.user.role)}"],
  ["11a", "components/admin-subscription-manager.tsx", "text-fg-secondary\">Plan<select", "text-fg-secondary\">Paket<select"],
  ["11b", R, '"Mağaza, plan, abunəlik dövrü və səbəbi yoxlayın."', '"Mağaza, paket, abunəlik dövrü və səbəbi yoxlayın."'],
  ["11c", R, '"Aktiv BASIC və ya PRO planı seçin."', '"Aktiv Basic və ya Pro paketi seçin."'],
  ["11d", "app/admin/_sections/stores.tsx", '{label:"İdarəetmə / plan",', '{label:"İdarəetmə / paket",'],
  ["11e", "lib/admin-store-readiness.ts", "v\\u0259 plan sat\\u0131\\u015f", "v\\u0259 paket sat\\u0131\\u015f"],
  ["11f", "components/admin-complimentary-manager.tsx", "Paket BASIC (300 aktiv məhsul) və ya PRO (2 000)", "Paket Basic (300 aktiv məhsul) və ya Pro (2 000)"],
  ["11g", "components/admin-complimentary-manager.tsx", '>BASIC (300 məhsul)</option><option value="PRO">PRO (2 000 məhsul)<', '>Basic (300 məhsul)</option><option value="PRO">Pro (2 000 məhsul)<'],
  ["11h", "components/admin-store-review-actions.tsx", '>BASIC (300 məhsul)</option><option value="PRO">PRO (2 000 məhsul)<', '>Basic (300 məhsul)</option><option value="PRO">Pro (2 000 məhsul)<'],
  ["11i", "app/admin/_sections/stores-new.tsx", "Admin mağazaları BASIC limitləri", "Admin mağazaları Basic limitləri"],
  [12, "lib/audit-action-labels.ts", "", 'STORE_SUBMIT_FOR_REVIEW: "Mağaza yoxlamaya göndərildi"'],
];

test("(a) each approved change: the new text is there, the old text is gone", () => {
  for (const [item, path, before, after] of ITEMS) {
    const base = atBase(path), now = atTask(path);
    if (before) assert.ok(base.includes(before), `item ${item}: the old text existed in ${path}`);
    assert.ok(now.includes(after), `item ${item}: new text in ${path}`);
    if (before && !after.includes(before)) assert.ok(!now.includes(before), `item ${item}: old text gone from ${path}`);
  }
  // 9: no Turkish-style "görünürlüğü" left in the four files; "görünürlüyünü" untouched.
  for (const path of ["app/api/admin/stores/[storeId]/activation/route.ts", "components/admin-store-activation-action.tsx", "lib/admin-store-product-publishing.ts"]) assert.ok(!atTask(path).includes("görünürlüğü"), path);
  assert.equal(atTask("components/admin-store-activation-action.tsx").split("görünürlüyünü").length, atBase("components/admin-store-activation-action.tsx").split("görünürlüyünü").length);
  // 8: the review delete keeps its own message.
  assert.ok(atTask(R).includes('"Rəy identifikatoru yanlışdır"'), "reviews keep their message");
  // 10: the existing labels; other roles unchanged.
  assert.deepEqual([adminRoleLabel("CUSTOMER"), adminRoleLabel("VENDOR"), adminRoleLabel("ADMIN")], ["Müştəri", "Satıcı", "ADMIN"]);
  assert.ok(atBase("lib/admin-power-1.ts").includes('roleCustomer: "Müştəri"') && atBase("lib/admin-power-1.ts").includes('roleVendor: "Satıcı"'), "existing labels");
  // 12: the label exists and the documented exception is gone.
  assert.equal(AUDIT_ACTION_LABELS.STORE_SUBMIT_FOR_REVIEW, "Mağaza yoxlamaya göndərildi");
  assert.equal(auditActionLabel("STORE_SUBMIT_FOR_REVIEW"), "Mağaza yoxlamaya göndərildi");
  assert.ok(!atTask("scripts/security-page-1.test.ts").includes('codes.delete("STORE_SUBMIT_FOR_REVIEW")'));
});

/** Visible-looking strings of a source: quoted / template strings and JSX text that contain a space, an Azerbaijani
 * letter, or a capitalised word (so plain words like "Worker" or "Plan" count too). Comments are ignored. */
function visibleStrings(source: string): string[] {
  const out: string[] = [];
  for (const raw of source.split("\n")) {
    if (/^\s*(\/\/|\*|\/\*\*|\{\/\*)/.test(raw)) continue;
    const line = raw.replace(/\s\/\/\s.*$/, "");
    for (const m of line.matchAll(/"((?:[^"\\]|\\.)*)"|`([^`]*)`|>([^<>{}]+)</g)) {
      const text = (m[1] ?? m[2] ?? m[3] ?? "").trim();
      if (!text || !/[A-Za-zƏəĞğİıÖöÜüŞşÇç]/.test(text)) continue;
      if (/\s/.test(text) || /[əğıöüşçƏĞİÖÜŞÇ]|\\u0/.test(text) || /^[A-ZƏĞİÖÜŞÇ][a-zəğıöüşç]/.test(text)) out.push(text);
    }
  }
  return out;
}
const multisetDiff = (a: string[], b: string[]) => {
  const count = new Map<string, number>();
  for (const x of a) count.set(x, (count.get(x) ?? 0) - 1);
  for (const x of b) count.set(x, (count.get(x) ?? 0) + 1);
  return { removed: [...count].filter(([, n]) => n < 0).map(([x]) => x).sort(), added: [...count].filter(([, n]) => n > 0).map(([x]) => x).sort() };
};

const CHANGED_FILES = [
  "app/admin/_sections/notifications.tsx", "app/admin/_sections/stores-new.tsx", "app/admin/_sections/stores.tsx", "app/admin/seller-applications/[id]/page.tsx",
  "app/admin/verification/page.tsx", "app/api/admin/[...resource]/route.ts", "app/api/admin/stores/[storeId]/activation/route.ts",
  "components/admin-complimentary-manager.tsx", "components/admin-store-activation-action.tsx", "components/admin-store-profile-form.tsx",
  "components/admin-store-review-actions.tsx", "components/admin-subscription-manager.tsx", "components/admin-system-status.tsx",
  "lib/admin-power-1.ts", "lib/admin-store-product-publishing.ts", "lib/admin-store-readiness.ts", "lib/audit-action-labels.ts",
];

test("(b) scanner: the only visible strings that changed are the approved ones", () => {
  const removed: string[] = [], added: string[] = [];
  for (const path of CHANGED_FILES) {
    const diff = multisetDiff(visibleStrings(atBase(path)), visibleStrings(atTask(path)));
    removed.push(...diff.removed.map((x) => `${path}: ${x}`));
    added.push(...diff.added.map((x) => `${path}: ${x}`));
  }
  const show = (lines: string[]) => lines.map((line) => line.replace(/^[^:]+\.tsx?: /, (m) => m)).sort();
  // Every removed / added visible string must belong to an approved change.
  const approvedOld = ["Active city not found", "Active vendor profile not found", "Map URL must use HTTPS", "workflow-u", "inbox-a", "Logo HTTPS URL", "Worker", "Build ID", "görünürlüğü", "${r.user.email} · ${r.user.role}", "Plan", "plan", "BASIC", "PRO"];
  const approvedNew = ["Aktiv şəhər tapılmadı", "Aktiv satıcı profili tapılmadı", "Xəritə linki HTTPS ilə başlamalıdır", "prosesi", "gələn qutusuna", "Logo HTTPS linki", "İşçi proses", "Versiya nömrəsi", "Kateqoriya identifikatoru yanlışdır", "görünürlüyü", "adminRoleLabel", "Paket", "paket", "Basic", "Pro", "Mağaza yoxlamaya göndərildi"];
  for (const line of show(removed)) assert.ok(approvedOld.some((text) => line.includes(text)), `unexpected removed text: ${line}`);
  for (const line of show(added)) assert.ok(approvedNew.some((text) => line.includes(text)), `unexpected new text: ${line}`);
  // And each changed line pairs up: as many changes as approved strings (no extra edits hidden in approved files).
  assert.equal(removed.length, 27, removed.join("\n"));
  // 27 replaced strings + the category message (reviews keep theirs) + the new audit label.
  assert.equal(added.length, 29, added.join("\n"));
});

test("(c) scope: exact files; no legal / customer page, schema or package; no logic beyond the role label and the category message", () => {
  if (TASK) {
    const files = git("diff", "--name-only", BASE, TASK).split(/\r?\n/).filter(Boolean).sort();
    assert.deepEqual(files, [...CHANGED_FILES, "scripts/admin-onboard-1.test.ts", "scripts/admin-texts-1.test.ts", "scripts/security-page-1.test.ts"].sort());
  }
  const untouched = ["app/(customer)", "lib/legal-versions.ts", "prisma", "package.json", "package-lock.json", "components/customer-footer.tsx"];
  assert.equal((TASK ? git("diff", "--name-only", BASE, TASK, "--", ...untouched) : git("diff", "--name-only", BASE, "--", ...untouched)).trim(), "");
});
