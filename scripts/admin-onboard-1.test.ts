/**
 * ADMIN-3-ONBOARD-1 (T3 of release-output/admin-3-audit-1-report.md): application -> seller -> store -> approve, with
 * no dead ends.
 * (a) approved application page links to the seller (/admin/vendors/<vendorProfileId>), only when APPROVED with a profile;
 * (b) the seller page lists the stores with links, status and visibility (already present; pinned here);
 * (c) on the store page the approval panel comes before the archive/delete actions;
 * (d) the admin can send a DRAFT store for review: same checkStoreSubmission, only DRAFT, idempotent, audit row in the
 *     same transaction (in-memory fake transaction, no database);
 * (e) no other new Azerbaijani text; scope = BASE..own commit; selling/approval rules untouched.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { ADMIN_STORE_SUBMIT_AUDIT, STORE_SUBMIT_TEXT, submitStoreForReviewAsAdmin, type AdminStoreSubmitDb } from "../lib/admin-store-submit";
import { auditActionLabel } from "../lib/audit-action-labels";

const root = process.cwd();
const BASE = "116a41a";
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
const TASK = git("log", "--format=%H", "--grep=^ADMIN-3-ONBOARD-1", `${BASE}..HEAD`).trim().split(/\r?\n/).filter(Boolean)[0] ?? null;
const atTask = (path: string) => (TASK ? git("show", `${TASK}:${path}`).replace(/\r\n/g, "\n") : read(path));
const atBase = (path: string) => { try { return git("show", `${BASE}:${path}`).replace(/\r\n/g, "\n"); } catch { return ""; } };
const LINK_TEXT = "Satıcının səhifəsinə keç";

test("(a) approved application: link to the seller page, only for APPROVED with a seller profile", () => {
  const page = atTask("app/admin/seller-applications/[id]/page.tsx");
  assert.ok(page.includes('{application.status === "APPROVED" && application.vendorProfileId && <p className="mt-4"><Link'), "condition: APPROVED and a profile id (read from the application row on every load)");
  assert.ok(page.includes(`href={\`/admin/vendors/\${encodeURIComponent(application.vendorProfileId)}\`}>${LINK_TEXT}</Link>`), "link target and the approved text");
  assert.equal(page.split(LINK_TEXT).length, 2, "one link");
  // vendorProfileId is a column of VendorApplication (no new column); the approve API already returned it.
  assert.match(read("prisma/schema.prisma"), /model VendorApplication \{[\s\S]*?vendorProfileId\s+String\?/);
  assert.match(read("app/api/admin/seller-applications/[id]/route.ts"), /vendorProfileId/);
  // The page loads the whole application row (include, no select), so vendorProfileId is there after a reload.
  assert.match(page, /prisma\.vendorApplication\.findUnique\(\{\s*where: \{ id \},\s*include: \{/);
});

test("(b) the seller page lists the stores: link, status label, visibility, existing empty sentence", () => {
  const vendor = atTask("app/admin/_sections/vendor-detail.tsx");
  assert.ok(vendor.includes('<Link href={"/admin/stores/" + r.id} className="font-semibold text-primary hover:underline">{r.name}</Link>'));
  assert.ok(vendor.includes('<AdminStatusBadge kind="store" value={r.status}/> · {r.status === "ACTIVE" && r.isActive ? "ictimai görünür" : "ictimai gizlidir"}'));
  assert.ok(vendor.includes('empty="Bu satıcıya aid mağaza yoxdur."'));
  assert.equal(vendor, atBase("app/admin/_sections/vendor-detail.tsx"), "already present before this task: unchanged");
});

test("(c) store page: the approval panel renders before the archive/delete actions", () => {
  const form = atTask("components/admin-store-profile-form.tsx");
  const review = form.indexOf("<AdminStoreReviewActions ");
  const archive = form.indexOf("<AdminStoreArchiveAction ");
  assert.ok(review > 0 && archive > review, "review panel first, destructive actions after");
  // The panel itself is unchanged apart from the DRAFT button (free-sale checkbox still there).
  assert.match(atTask("components/admin-store-review-actions.tsx"), /Ödənişsiz satış \(admin icazəsi\)/);
});

// ---- (d) DRAFT submit with an in-memory fake transaction ----
type Store = { id: string; status: string; isActive: boolean; legalInfoApproved: boolean; adminManaged: boolean; subscription: null; vendor: { sellerType: string | null; legalName: string | null; voen: string | null; legalAddress: string | null } };
function world(store: Store | null, options: { failAudit?: boolean } = {}) {
  const committed: Array<{ op: string; args: unknown }> = [];
  let current = store ? { ...store } : null;
  const db: AdminStoreSubmitDb = {
    async $transaction(run) {
      const staged: Array<{ op: string; args: unknown }> = [];
      let draft = current ? { ...current } : null;
      const tx = {
        $queryRaw: async () => { staged.push({ op: "lock", args: null }); return []; },
        store: {
          findUnique: async () => (draft ? { ...draft } : null),
          updateMany: async (args: { where: { id: string; status: "DRAFT" }; data: { status: "PENDING_REVIEW" } }) => {
            if (!draft || draft.id !== args.where.id || draft.status !== args.where.status) return { count: 0 };
            draft = { ...draft, status: args.data.status }; staged.push({ op: "store.updateMany", args }); return { count: 1 };
          },
        },
        auditLog: { create: async (args: unknown) => { if (options.failAudit) throw new Error("audit failed"); staged.push({ op: "auditLog.create", args }); return {}; } },
      };
      const result = await run(tx as never);
      committed.push(...staged.filter((w) => w.op !== "lock")); current = draft; // commit
      return result;
    },
  };
  return { db, committed, state: () => current };
}
const legal = { sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: "Pilot", voen: "1234567890", legalAddress: "Bakı" };
const draft = (over: Partial<Store> = {}): Store => ({ id: "store-1", status: "DRAFT", isActive: false, legalInfoApproved: false, adminManaged: true, subscription: null, vendor: legal, ...over });

test("(d) DRAFT with complete legal data -> PENDING_REVIEW, audit row in the same transaction", async () => {
  const w = world(draft());
  const result = await submitStoreForReviewAsAdmin(w.db, { storeId: "store-1", adminId: "admin-1" });
  assert.deepEqual(result, { ok: true, status: "PENDING_REVIEW", changed: true, message: STORE_SUBMIT_TEXT.done });
  assert.deepEqual(w.committed.map((c) => c.op), ["store.updateMany", "auditLog.create"]);
  assert.deepEqual((w.committed[1].args as { data: unknown }).data, { actorId: "admin-1", action: "STORE_SUBMIT_FOR_REVIEW", entityType: "Store", entityId: "store-1", metadata: { previousStatus: "DRAFT", nextStatus: "PENDING_REVIEW", adminManaged: true, isActive: false } });
  assert.equal(w.state()?.status, "PENDING_REVIEW");
  assert.equal(w.state()?.isActive, false, "visibility unchanged");
  // Idempotent: a second click (or a seller who already sent it) changes nothing and writes no second audit row.
  const again = await submitStoreForReviewAsAdmin(w.db, { storeId: "store-1", adminId: "admin-1" });
  assert.deepEqual(again, { ok: true, status: "PENDING_REVIEW", changed: false, message: STORE_SUBMIT_TEXT.done });
  assert.equal(w.committed.length, 2);
});

test("(d) same checks as the seller: missing legal data -> 422 with the seller route's message, nothing written", async () => {
  const w = world(draft({ vendor: { ...legal, legalName: " " } }));
  const result = await submitStoreForReviewAsAdmin(w.db, { storeId: "store-1", adminId: "admin-1" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.httpStatus, 422);
  assert.ok(result.error.startsWith(STORE_SUBMIT_TEXT.legalPrefix) && result.error.endsWith("."), result.error);
  assert.deepEqual(result.missingFields, ["legalName"]);
  assert.deepEqual(w.committed, []);
  // The library calls checkStoreSubmission (no shortcut) and the messages are the seller route's.
  const lib = read("lib/admin-store-submit.ts");
  assert.match(lib, /import \{ checkStoreSubmission \} from "@\/lib\/store-submission";/);
  assert.match(lib, /const submission = checkStoreSubmission\(\{/);
  const vendorRoute = read("app/api/vendor/[storeId]/[section]/route.ts");
  for (const text of [STORE_SUBMIT_TEXT.invalidStatus, STORE_SUBMIT_TEXT.legalPrefix, `"${STORE_SUBMIT_TEXT.notFound}"`]) assert.ok(vendorRoute.includes(text), `seller route has: ${text}`);
  assert.ok(read("components/vendor-store-profile-editor.tsx").includes(STORE_SUBMIT_TEXT.done));
});

test("(d) only DRAFT: other statuses are refused (409) and nothing is written; unknown store 404", async () => {
  for (const status of ["ACTIVE", "REJECTED", "SUSPENDED"]) {
    const w = world(draft({ status }));
    const result = await submitStoreForReviewAsAdmin(w.db, { storeId: "store-1", adminId: "admin-1" });
    assert.deepEqual(result, { ok: false, httpStatus: 409, error: STORE_SUBMIT_TEXT.invalidStatus }, status);
    assert.deepEqual(w.committed, [], status);
  }
  const none = world(null);
  assert.deepEqual(await submitStoreForReviewAsAdmin(none.db, { storeId: "x", adminId: "a" }), { ok: false, httpStatus: 404, error: STORE_SUBMIT_TEXT.notFound });
});

test("(d) when the audit write fails, the status change is not committed", async () => {
  const w = world(draft(), { failAudit: true });
  await assert.rejects(submitStoreForReviewAsAdmin(w.db, { storeId: "store-1", adminId: "admin-1" }), /audit failed/);
  assert.deepEqual(w.committed, []);
  assert.equal(w.state()?.status, "DRAFT");
});

test("(d) route and button: admin only, POST /api/admin/stores/<id>/submit, existing wording", () => {
  const route = atTask("app/api/admin/stores/[storeId]/submit/route.ts");
  assert.match(route, /const admin = await requireRole\("ADMIN"\);\s*if \(!admin\)/);
  assert.match(route, /submitStoreForReviewAsAdmin\(prisma as unknown as AdminStoreSubmitDb, \{ storeId, adminId: admin\.id \}\)/);
  const panel = atTask("components/admin-store-review-actions.tsx");
  assert.ok(panel.includes("fetch(`/api/admin/stores/${encodeURIComponent(props.storeId)}/submit`, { method: \"POST\""));
  assert.ok(panel.includes('{props.status === "DRAFT" && <div className="mt-4"><button type="button" disabled={busy} onClick={() => void submitDraft()}'));
  assert.ok(panel.includes('{busy ? "Gözləyin…" : "Yoxlamaya göndər"}'));
  // No new visible audit label: the action shows as its code in the audit log (no label existed).
  assert.equal(auditActionLabel(ADMIN_STORE_SUBMIT_AUDIT), "STORE_SUBMIT_FOR_REVIEW");
});

test("(e) no other new text; selling, approval and entitlement rules untouched; scope", () => {
  const AZ = /[əğıöüşçƏĞİÖÜŞÇ]/;
  const fragments = (source: string) => new Set(source.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*\*|\{\/\*)/.test(line)).join("\n").split(/["'`<>{}]|\$\{/).map((part) => part.trim()).filter((part) => AZ.test(part)));
  const existing = new Set<string>([LINK_TEXT]);
  for (const source of ["app/api/vendor/[storeId]/[section]/route.ts", "components/vendor-store-profile-editor.tsx", "lib/vendor-store-setup.ts", "app/api/admin/stores/[storeId]/review/route.ts", "components/admin-store-review-actions.tsx"]) {
    for (const part of fragments(atBase(source))) existing.add(part);
  }
  const files = ["app/admin/seller-applications/[id]/page.tsx", "components/admin-store-review-actions.tsx", "components/admin-store-profile-form.tsx", "lib/admin-store-submit.ts", "app/api/admin/stores/[storeId]/submit/route.ts"];
  for (const path of files) {
    const before = fragments(atBase(path));
    const added = [...fragments(atTask(path))].filter((part) => !before.has(part) && !existing.has(part));
    assert.deepEqual(added, [], `${path}: new Azerbaijani text`);
  }
  const rules = ["lib/subscription-entitlements.ts", "lib/store-review.ts", "lib/store-review-transaction.ts", "lib/store-submission.ts", "lib/admin-store-product-publishing.ts", "lib/public-store-eligibility.ts", "lib/seller-legal-policy.ts", "lib/audit-action-labels.ts", "prisma", "package.json", "package-lock.json"];
  assert.equal((TASK ? git("diff", "--name-only", BASE, TASK, "--", ...rules) : git("diff", "--name-only", BASE, "--", ...rules)).trim(), "");
  if (TASK) {
    const changed = git("diff", "--name-only", BASE, TASK).split(/\r?\n/).filter(Boolean).sort();
    // + security-page-1.test.ts: the documented exception for the unlabelled STORE_SUBMIT_FOR_REVIEW (owner decision).
    assert.deepEqual(changed, ["app/admin/seller-applications/[id]/page.tsx", "app/api/admin/stores/[storeId]/submit/route.ts", "components/admin-store-profile-form.tsx", "components/admin-store-review-actions.tsx", "lib/admin-store-submit.ts", "scripts/admin-onboard-1.test.ts", "scripts/security-page-1.test.ts"]);
  }
});
