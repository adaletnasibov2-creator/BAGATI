import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { buildTransactionalEmail, EMAIL_TEMPLATES } from "../lib/email-templates";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const between = (text: string, start: string, end: string) => {
  const from = text.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  const to = text.indexOf(end, from + start.length);
  return text.slice(from, to < 0 ? undefined : to);
};

test("admin review route: same-origin check, then ADMIN, then a bounded JSON body; POST only", () => {
  const route = read("app/api/admin/seller-applications/[id]/route.ts");
  const csrf = route.indexOf("csrfRejection(request)");
  const auth = route.indexOf('requireRole("ADMIN")');
  const body = route.indexOf("readJsonBodyLimited(request");
  assert.ok(csrf > 0 && auth > csrf && body > auth, "csrf → auth → body");
  assert.doesNotMatch(route, /export async function (GET|PUT|PATCH|DELETE)/);
  assert.match(route, /sellerApplicationReviewSchema\.safeParse/);
  assert.match(route, /code === "DUPLICATE_VOEN_UNCONFIRMED"[\s\S]*?409/);
  assert.match(route, /code === "NOT_PENDING"[\s\S]*?409/);
  assert.doesNotMatch(route, /role: "VENDOR"/, "the route itself never writes a role");
});

test("admin pages are ADMIN only and list VÖEN masked; full VÖEN only on the detail page", () => {
  const list = read("app/admin/seller-applications/page.tsx");
  const detail = read("app/admin/seller-applications/[id]/page.tsx");
  for (const page of [list, detail]) assert.match(page, /const admin = await requireRole\("ADMIN"\);\s+if \(!admin\) redirect\("\/admin\/login"\);/);
  assert.match(list, /maskVoen\(row\.voenNormalized\)/);
  assert.doesNotMatch(list, /\{row\.voen\}|applicantNote|phone/);
  assert.match(detail, /findDuplicateVoen\(prisma/);
  assert.match(detail, /application\.status === "PENDING" && <AdminSellerApplicationReview/);
  assert.match(read("components/admin-shell.tsx"), /\["\/admin\/seller-applications", "Satıcı müraciətləri", ClipboardCheck\]/);
});

test("approval runs in one transaction: lock, still PENDING, still an active verified CUSTOMER, then role, profile, status, audit, e-mail", () => {
  const service = read("lib/seller-application-service.ts");
  const approve = between(service, "export async function approveSellerApplication", "\n/** Admin rejection");
  const order = [
    "db.$transaction(async (tx) => {",
    "await lockApplication(tx, input.applicationId);",
    'if (application.status !== "PENDING") throw new SellerApplicationError("NOT_PENDING"',
    'if (user.role !== "CUSTOMER" || !user.isActive || !user.emailVerifiedAt) throw new SellerApplicationError("ACCOUNT_CHANGED")',
    'if (duplicate && !input.confirmDuplicateVoen)',
    'tx.user.updateMany({ where: { id: user.id, role: "CUSTOMER", isActive: true }, data: { role: "VENDOR" } })',
    "tx.vendorProfile.create({ data: { userId: user.id, ...profileData }",
    'status: "APPROVED",',
    "openUserId: null,",
    'action: "SELLER_APPLICATION_APPROVED"',
    'template: "SELLER_APPLICATION_APPROVED"',
  ].map((needle) => {
    const index = approve.indexOf(needle);
    assert.ok(index >= 0, `missing: ${needle}`);
    return index;
  });
  assert.deepEqual([...order].sort((a, b) => a - b), order, "steps happen in this order");
  assert.match(service, /SELECT "id" FROM "VendorApplication" WHERE "id" = \$\{applicationId\} FOR UPDATE/);
  assert.match(approve, /duplicateVoenConfirmed: duplicate/);
  // Audit metadata: ids and flags only, never personal data.
  const metadata = between(approve, "metadata: {", "},");
  assert.doesNotMatch(metadata, /voen:|phone|legalAddress|legalName|adminNote|applicantNote|email/);
});

test("rejection needs a reason, locks the row, keeps the role and queues an e-mail", () => {
  const service = read("lib/seller-application-service.ts");
  const reject = between(service, "export async function rejectSellerApplication", "\nexport const SELLER_APPLICATION_PAGE_SIZE");
  assert.match(reject, /await lockApplication\(tx, input\.applicationId\);/);
  assert.match(reject, /status: "REJECTED", openUserId: null, rejectionReason: input\.reason/);
  assert.match(reject, /action: "SELLER_APPLICATION_REJECTED"/);
  assert.match(reject, /metadata: \{ applicantUserId: application\.userId, reasonLength: input\.reason\.length \}/);
  assert.match(reject, /template: "SELLER_APPLICATION_REJECTED"/);
  assert.doesNotMatch(reject, /role/);
});

test("seller application e-mail templates exist, escape text and never include VÖEN", () => {
  for (const template of ["SELLER_APPLICATION_SUBMITTED", "SELLER_APPLICATION_APPROVED", "SELLER_APPLICATION_REJECTED"] as const) {
    assert.ok(EMAIL_TEMPLATES.includes(template), template);
  }
  const rejected = buildTransactionalEmail("SELLER_APPLICATION_REJECTED", { displayName: "Aysel", reason: "<b>VÖEN</b> uyğun deyil" }, "BAGATI <no-reply@example.test>", "a@example.test", "m1");
  assert.equal(rejected.subject, "Satıcı müraciəti barədə qərar");
  assert.match(String(rejected.html), /&lt;b&gt;VÖEN&lt;\/b&gt; uyğun deyil/);
  assert.doesNotMatch(String(rejected.html), /<b>VÖEN/);
  const approved = buildTransactionalEmail("SELLER_APPLICATION_APPROVED", { displayName: "Aysel" }, "BAGATI <no-reply@example.test>", "a@example.test", "m2");
  assert.equal(approved.subject, "Satıcı müraciətiniz təsdiqləndi");
  assert.match(String(approved.text), /Salam Aysel,/);
  const service = read("lib/seller-application-service.ts");
  for (const payload of service.match(/payload: \{[^}]*\}/g) ?? []) assert.doesNotMatch(payload, /voen|phone|legalAddress/i);
});

test("business pulse counts pending seller applications", () => {
  assert.match(read("lib/admin-system-status-cards.ts"), /FROM "VendorApplication" WHERE "status" = 'PENDING'\) AS "pendingSellerApplications"/);
  assert.match(read("components/admin-system-status.tsx"), /Yoxlama gözləyən satıcı müraciətləri/);
});
