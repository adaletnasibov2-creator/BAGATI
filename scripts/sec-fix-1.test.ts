/**
 * SEC-FIX-1: small fixes from release-output/security-audit-report.md (M1, M4, M6, L3, L4, L7, L9, L10).
 * Unit tests only: pure helpers are called directly, route wiring is checked in the source. No database.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import bcrypt from "bcryptjs";
import { authRateLimitKey, loginRateLimitKey, PASSWORD_CHECK_RATE_LIMIT, passwordCheckRateLimitKey } from "../lib/auth-rate-limit";
import { checkCurrentPassword } from "../lib/password-check";
import { equalizeLoginTiming, LOGIN_DUMMY_BCRYPT_COST, loginDummyHash } from "../lib/login-timing";
import { vendorLegacyImportBodySchema } from "../lib/vendor-legacy-import";
import * as importParsers from "../lib/import-parsers";
import { publicOrderErrorCode } from "../lib/order-create-response";
import { CART_LINE_MAX_QUANTITY, cartLineQuantityAllowed } from "../lib/cart-line-limit";
import { safePublicMapUrl } from "../lib/store-public-contact";
import { buildTransactionalEmail } from "../lib/email-templates";

process.env.SESSION_SECRET ??= "sec-fix-1-unit-test-secret-0123456789abcdef";

const root = resolve(__dirname, "..");
// Working copies may be CRLF on Windows (git autocrlf); compare with LF.
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
const before = (source: string, first: string, second: string, label: string) => {
  const a = source.indexOf(first), b = source.indexOf(second);
  assert.ok(a >= 0, `${label}: missing ${first}`);
  assert.ok(b >= 0, `${label}: missing ${second}`);
  assert.ok(a < b, `${label}: ${first} must come before ${second}`);
};

// ---------------------------------------------------------------- M1
test("M1: setup and activate check the session admin's password before any enrollment work", () => {
  const setup = read("app/api/admin/2fa/setup/route.ts");
  before(setup, "await assertEnrollmentPassword(request, actor, value.password);", "await startEnrollment(actor)", "setup");
  const activate = read("app/api/admin/2fa/activate/route.ts");
  before(activate, "await assertEnrollmentPassword(request, actor, value.password);", "await activateEnrollment(request, actor, value.code)", "activate");
  // Both still authorize first (session or forced-enrollment challenge), exactly as before.
  for (const source of [setup, activate]) before(source, "const actor = await resolveEnrollmentActor(request);", "await assertEnrollmentPassword(", "order");
});

test("M1: the password check applies to the session path only, counts the attempt before bcrypt, and reuses existing errors", () => {
  const lib = read("lib/admin-2fa.ts");
  const body = lib.slice(lib.indexOf("export async function assertEnrollmentPassword"), lib.indexOf("export async function twoFactorStatus"));
  assert.match(body, /^export async function assertEnrollmentPassword\(request: NextRequest, actor: EnrollmentActor, password: unknown\) \{\n  if \(actor\.via !== "session"\) return;/);
  assert.match(body, /passwordCheckRateLimitKey\("admin-2fa-enroll", actor\.userId\)/);
  assert.match(body, /throw new Admin2faError\("RATE_LIMITED"\)/);
  assert.match(body, /throw new Admin2faError\("INVALID_PASSWORD"\)/);
  before(body, "consumeAttempt:", "compare:", "rate limit before bcrypt");
});

test("M1: forced enrollment (challenge) is not asked for the password and touches no database", async () => {
  const { assertEnrollmentPassword } = await import("../lib/admin-2fa");
  // A challenge actor returns at once; any database or bcrypt call would throw here (no DATABASE_URL in unit runs).
  await assert.doesNotReject(assertEnrollmentPassword({} as never, { userId: "u1", email: "a@example.test", via: "challenge" }, undefined));
});

test("M1: enrollment from a session queues the ACCOUNT_SECURITY email with the 2FA line; forced enrollment does not", () => {
  const lib = read("lib/admin-2fa.ts");
  const activate = lib.slice(lib.indexOf("export async function activateEnrollment"), lib.indexOf("export type SecondFactorResult"));
  assert.match(activate, /if \(actor\.via === "session"\) \{\s*await enqueueEmail\(tx, \{ eventKey: `account-security:admin-2fa-enrolled:[^`]*`, recipient: actor\.email, template: "ACCOUNT_SECURITY", payload: \{ change: "admin-2fa-enrolled" \} \}\);/);
  before(activate, 'await audit(actor.userId, "ADMIN_2FA_ENROLLED"', "await enqueueEmail(tx,", "same transaction, after the audit row");

  const twoFactor = buildTransactionalEmail("ACCOUNT_SECURITY", { change: "admin-2fa-enrolled" }, "from@example.test", "to@example.test", "<id@example.test>");
  const password = buildTransactionalEmail("ACCOUNT_SECURITY", {}, "from@example.test", "to@example.test", "<id@example.test>");
  assert.equal(twoFactor.subject, password.subject, "same subject as before");
  assert.match(String(twoFactor.text), /İki mərhələli təsdiq aktivləşdirildi\./);
  assert.doesNotMatch(String(twoFactor.text), /şifrəsi yeniləndi/);
  assert.match(String(password.text), /Hesabınızın şifrəsi yeniləndi\./, "password change / reset email unchanged");
});

test("M1: the settings form sends the password (existing label 'Cari şifrə'); the forced-enrollment form does not", () => {
  const ui = read("components/admin-two-factor-enrollment.tsx");
  assert.match(ui, /const needsPassword = mode === "settings";/);
  assert.match(ui, /post\("\/api\/admin\/2fa\/setup", needsPassword \? \{ password \} : \{\}\)/);
  assert.match(ui, /post\("\/api\/admin\/2fa\/activate", needsPassword \? \{ code, password \} : \{ code \}\)/);
  assert.match(ui, />Cari şifrə<input className=\{passwordField\} type="password" name="password" autoComplete="current-password"/);
  assert.match(read("components/admin-two-factor-settings.tsx"), />Cari şifrə</, "the label text already exists on the same page");
});

// ---------------------------------------------------------------- M4
const unclosed = "<item>".repeat(Math.ceil(5_000_000 / 6)).slice(0, 5_000_000);

test("M4: a 5,000,000-character unclosed-tag fileText body is rejected fast by the import body schema", () => {
  assert.equal(unclosed.length, 5_000_000);
  const started = performance.now();
  const result = vendorLegacyImportBodySchema.safeParse({ action: "validate", mode: "create", sourceName: "catalog.xml", mapping: {}, rows: [{ name: "x" }], fileText: unclosed });
  const elapsed = performance.now() - started;
  assert.equal(result.success, false);
  assert.ok(elapsed < 500, `rejected in ${elapsed.toFixed(1)} ms`);
});

test("M4: the body the import wizard sends is still accepted; other unknown fields are rejected", () => {
  const body = { action: "validate", mode: "create", sourceName: "catalog.csv", mapping: { name: "Ad", price: "Qiymət", category: "Kateqoriya" }, rows: [{ Ad: "Köynək", Qiymət: "10", Kateqoriya: "Geyim" }] };
  assert.equal(vendorLegacyImportBodySchema.safeParse(body).success, true);
  assert.equal(vendorLegacyImportBodySchema.safeParse({ action: "import", sourceName: "a.xlsx", mapping: {}, rows: [{}] }).success, true, "mode keeps its default");
  assert.equal(vendorLegacyImportBodySchema.safeParse({ ...body, extra: 1 }).success, false);
  assert.equal(vendorLegacyImportBodySchema.safeParse({ ...body, rows: Array.from({ length: 1001 }, () => ({})) }).success, false, "1000-row cap kept");
  // The wizard posts exactly these keys (components/vendor-import.tsx).
  assert.match(read("components/vendor-import.tsx"), /JSON\.stringify\(\{ action: "validate", mode, sourceName: fileName, mapping, rows: rows\.slice\(offset, offset \+ 100\) \}\)/);
});

test("M4: XML is no longer parsed: parseXmlImport is gone and a 5,000,000-character .xml text is refused at once", () => {
  assert.equal("parseXmlImport" in importParsers, false);
  const started = performance.now();
  assert.throws(() => importParsers.parseImportByExtension("catalog.xml", unclosed), importParsers.ImportParseError);
  assert.ok(performance.now() - started < 500);
  assert.equal(importParsers.parseImportByExtension("a.csv", "name,price\nA,1\n").parsed.rows.length, 1, "CSV unchanged");
});

test("M4: the vendor route has no server-side file parsing left", () => {
  const route = read("app/api/vendor/[storeId]/[section]/route.ts");
  assert.doesNotMatch(route, /fileText|parseImportByExtension|ImportParseError|import-parsers/);
  assert.match(route, /const parsed=vendorLegacyImportBodySchema\.safeParse\(body\);/);
  assert.doesNotMatch(read("lib/import-parsers.ts"), /blockPattern|\[\\\\s\\\\S\]\*\?\)<\//);
});

// ---------------------------------------------------------------- M6
test("M6: login lock keys are separate per portal; the customer key is unchanged", () => {
  const email = "owner@example.test";
  const keys = new Set([loginRateLimitKey("customer", email), loginRateLimitKey("vendor", email), loginRateLimitKey("admin", email)]);
  assert.equal(keys.size, 3);
  assert.equal(loginRateLimitKey("customer", email), authRateLimitKey("login", email), "existing customer buckets keep counting");
  assert.equal(loginRateLimitKey("admin", " OWNER@Example.test "), loginRateLimitKey("admin", email), "same email normalisation");
  assert.notEqual(loginRateLimitKey("admin", email), authRateLimitKey("admin-login", email), "not the admin per-IP bucket family");
});

test("M6: each login route uses its own portal key and the same 10 / 15 min limit", () => {
  for (const [path, portal] of [["app/api/auth/login/route.ts", "customer"], ["app/api/auth/vendor-login/route.ts", "vendor"], ["app/api/admin/login/route.ts", "admin"]] as const) {
    const source = read(path);
    assert.match(source, new RegExp(`rateKey = loginRateLimitKey\\("${portal}", email\\);`), path);
    assert.doesNotMatch(source, /authRateLimitKey\("login"/, path);
    assert.match(source, /consumeAuthRateLimit\(rateKey, LOGIN_RATE_LIMIT\.limit, LOGIN_RATE_LIMIT\.windowMs\)/, path);
  }
});

// ---------------------------------------------------------------- L3
test("L3: checkCurrentPassword counts the attempt first and never runs bcrypt when the limit is reached", async () => {
  const calls: string[] = [];
  const steps = (allowed: boolean, matches: boolean) => ({
    consumeAttempt: async () => { calls.push("consume"); return allowed; },
    compare: async () => { calls.push("compare"); return matches; },
  });
  assert.equal(await checkCurrentPassword(steps(false, true)), "rate-limited");
  assert.deepEqual(calls, ["consume"]);
  calls.length = 0;
  assert.equal(await checkCurrentPassword(steps(true, false)), "invalid");
  assert.deepEqual(calls, ["consume", "compare"]);
  assert.equal(await checkCurrentPassword(steps(true, true)), "ok");
  assert.deepEqual(PASSWORD_CHECK_RATE_LIMIT, { limit: 10, windowMs: 15 * 60 * 1000 });
  assert.notEqual(passwordCheckRateLimitKey("password-change", "u1"), passwordCheckRateLimitKey("admin-2fa-disable", "u1"));
});

test("L3: password change and 2FA disable rate-limit before bcrypt, with existing messages", () => {
  const route = read("app/api/account/security/password/route.ts");
  before(route, 'passwordCheckRateLimitKey("password-change", user.id)', "bcrypt.compare(parsed.data.currentPassword", "password change");
  assert.match(route, /if \(check === "rate-limited"\) return NextResponse\.json\(\{ error: "Çox sayda cəhd edildi\. Bir müddət sonra yenidən yoxlayın\." \}, \{ status: 429/);
  assert.match(read("app/api/auth/reset-password/route.ts"), /Çox sayda cəhd edildi\. Bir müddət sonra yenidən yoxlayın\./, "message reused from reset-password");
  const lib = read("lib/admin-2fa.ts");
  const disable = lib.slice(lib.indexOf("export async function disableTwoFactor"), lib.indexOf("export function admin2faErrorMessage"));
  before(disable, 'passwordCheckRateLimitKey("admin-2fa-disable", userId)', "bcrypt.compare(input.password", "2FA disable");
  before(disable, 'throw new Admin2faError("RATE_LIMITED")', "verifySecondFactor(", "limit before the code step");
});

// ---------------------------------------------------------------- L4
test("L4: only known order error codes reach the browser", () => {
  const known = { CART_EMPTY: "Səbət boşdur.", STOCK_CHANGED: "x" };
  assert.equal(publicOrderErrorCode("CART_EMPTY", known), "CART_EMPTY");
  assert.equal(publicOrderErrorCode("\nInvalid `prisma.order.create()` invocation: column \"Order.foo\" does not exist", known), "ERROR");
  assert.equal(publicOrderErrorCode("constructor", known), "ERROR", "prototype names are not known codes");
  assert.equal(publicOrderErrorCode("", known), "ERROR");
  const route = read("app/api/orders/route.ts");
  assert.match(route, /const publicCode=publicOrderErrorCode\(code,messages\);/);
  assert.match(route, /code:publicCode\},\{status\}\);/);
  assert.doesNotMatch(route, /,code\},\{status\}\)/, "the raw code is no longer sent");
});

// ---------------------------------------------------------------- L7
test("L7: add-to-cart rejects a line total above 50, like PATCH", () => {
  assert.equal(CART_LINE_MAX_QUANTITY, 50);
  for (const ok of [1, 49, 50]) assert.equal(cartLineQuantityAllowed(ok), true, String(ok));
  for (const bad of [0, 51, 100, -1, 1.5, Number.NaN]) assert.equal(cartLineQuantityAllowed(bad), false, String(bad));
  const route = read("app/api/cart/items/route.ts");
  before(route, 'if (!cartLineQuantityAllowed(wanted)) throw new Error("QUANTITY_LIMIT");', "if (wanted > current.quantity - current.reserved)", "limit before stock");
  assert.match(route, /QUANTITY_LIMIT: "Məhsul səbətə əlavə edilmədi\."/, "existing message reused (422)");
  assert.match(read("app/api/cart/items/[itemId]/route.ts"), /quantity: z\.number\(\)\.int\(\)\.min\(1\)\.max\(50\)/);
});

// ---------------------------------------------------------------- L9
test("L9: the dummy compare uses a cost-12 hash made once and always fails", async () => {
  const hash = await loginDummyHash();
  assert.equal(bcrypt.getRounds(hash), LOGIN_DUMMY_BCRYPT_COST);
  assert.equal(LOGIN_DUMMY_BCRYPT_COST, 12);
  assert.equal(await loginDummyHash(), hash, "one hash per process");
  assert.equal(await equalizeLoginTiming("any password"), false);
  for (const path of ["app/api/account/security/password/route.ts", "app/api/auth/register/route.ts", "app/api/auth/reset-password/route.ts", "app/api/admin/vendors/route.ts"]) {
    assert.match(read(path), /bcrypt\.hash\([^)]*, 12\)/, `${path}: real hashes use the same cost`);
  }
});

test("L9: every login route runs the dummy compare for a missing, inactive or password-disabled account", () => {
  for (const [path, tag] of [["app/api/auth/login/route.ts", "customer_login"], ["app/api/auth/vendor-login/route.ts", "vendor_login"], ["app/api/admin/login/route.ts", "admin_login"]] as const) {
    const source = read(path);
    assert.match(source, new RegExp(`if \\(!user\\) \\{\\n    await equalizeLoginTiming\\(parsed\\.data\\.password\\);\\n    logAuthRejection\\("${tag}", "absent"\\);`), path);
    assert.match(source, new RegExp(`if \\(!user\\.isActive\\) \\{\\n    await equalizeLoginTiming\\(parsed\\.data\\.password\\);\\n    logAuthRejection\\("${tag}", "inactive"\\);`), path);
    assert.match(source, /if \(!user\.passwordAuthEnabled\) await equalizeLoginTiming\(parsed\.data\.password\);\n  if \(!user\.passwordAuthEnabled \|\| !\(await bcrypt\.compare\(parsed\.data\.password, user\.passwordHash\)\)\) \{/, path);
  }
});

// ---------------------------------------------------------------- L10
test("L10: the product page map link goes through safePublicMapUrl like the store page", () => {
  const page = read("app/(customer)/products/[productId]/page.tsx");
  assert.match(page, /const storeMapUrl = safePublicMapUrl\(product\.store\.mapUrl\);/);
  assert.match(page, /\{storeMapUrl && <a href=\{storeMapUrl\} target="_blank" rel="noreferrer"/);
  assert.doesNotMatch(page, /href=\{product\.store\.mapUrl\}/);
  assert.equal(safePublicMapUrl("javascript:alert(1)"), null);
  assert.equal(safePublicMapUrl("https://maps.example.test/x"), "https://maps.example.test/x");
});
