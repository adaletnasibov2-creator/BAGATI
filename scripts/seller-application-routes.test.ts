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

test("applicant routes: same-origin, then an active verified CUSTOMER, then rate limits recorded in the Security Center", () => {
  const guard = read("lib/seller-application-http.ts");
  const fn = between(guard, "export async function guardApplicantRequest", "\nexport function applicantErrorResponse");
  // Follow-up: the per-user key moved into applicantRateLimitBuckets (which adds the trusted client IP bucket).
  const order = ["csrfRejection(request)", "await currentUser()", 'user.role !== "CUSTOMER"', "consumeAuthProcessRateLimit(", "applicantRateLimitBuckets(user.id, trustedCloudflareClientIp(request.headers), (identity) => authRateLimitKey(\"seller-application\", identity))", "consumeAuthRateLimit(bucket.key, bucket.limit, bucket.windowMs)", 'eventType: "RATE_LIMIT_VIOLATION"'].map((needle) => {
    const index = fn.indexOf(needle);
    assert.ok(index >= 0, needle);
    return index;
  });
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  for (const path of ["app/api/vendor/apply/route.ts", "app/api/vendor/apply/withdraw/route.ts"]) {
    const route = read(path);
    assert.ok(route.indexOf("guardApplicantRequest(request") < route.indexOf("readJsonBodyLimited(request"), `${path}: guard before body`);
    assert.doesNotMatch(route, /export async function (GET|PUT|PATCH|DELETE)/);
  }
  assert.match(read("lib/auth-rate-limit.ts"), /"seller-application", identity: string/);
});

test("submission and withdrawal are transactional, audited and never change the role", () => {
  const service = read("lib/seller-application-service.ts");
  const submit = between(service, "export async function submitSellerApplication", "\n/** The applicant withdraws");
  assert.match(submit, /FROM "User" WHERE "id" = \$\{input\.userId\} FOR UPDATE/);
  assert.match(submit, /user\.role !== "CUSTOMER" \|\| !user\.isActive \|\| !user\.verified/);
  assert.match(submit, /const decision = reapplyDecision\(history, now\);/);
  assert.match(submit, /openUserId: input\.userId,\s+status: "PENDING",\s+source: "SELF",/);
  assert.match(submit, /action: "SELLER_APPLICATION_SUBMITTED"/);
  assert.match(submit, /eventKey: `seller-application:\$\{application\.id\}`/);
  assert.match(submit, /if \(isUniqueViolation\(error\)\) throw new SellerApplicationError\("OPEN"\)/);
  const withdraw = between(service, "export async function withdrawSellerApplication", "\nfunction isUniqueViolation");
  assert.match(withdraw, /await lockApplication\(tx, input\.applicationId\);/);
  assert.match(withdraw, /if \(application\.userId !== input\.userId\) throw new SellerApplicationError\("NOT_FOUND"\)/);
  assert.match(withdraw, /status: "WITHDRAWN", openUserId: null, withdrawnAt: now/);
  assert.match(withdraw, /action: "SELLER_APPLICATION_WITHDRAWN"/);
  for (const part of [submit, withdraw]) assert.doesNotMatch(part, /role: "VENDOR"/);
});

test("/vendor/apply shows the status instead of switching the account", () => {
  const page = read("app/vendor/apply/page.tsx");
  assert.match(page, /if \(!user\) redirect\("\/login\?next=%2Fvendor%2Fapply"\);/);
  assert.match(page, /if \(user\.role === "VENDOR"\) redirect\("\/vendor"\);/);
  assert.match(page, /latest\?\.status === "PENDING" && <section/);
  assert.match(page, /<VendorApplyWithdraw applicationId=\{latest\.id\} \/>/);
  assert.match(page, /latest\.rejectionReason/);
  assert.match(page, /formatBakuDateTime\(waitUntil\)/);
  assert.doesNotMatch(page, /rolu satıcıya keçirilir/);
  const form = read("components/vendor-apply-form.tsx");
  assert.match(form, /fetch\("\/api\/vendor\/apply"/);
  assert.doesNotMatch(form, /\/vendor\/stores\/new/, "no redirect into the seller panel after applying");
});
