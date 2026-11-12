import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import bcrypt from "bcryptjs";
import { authRateLimitKey, consumeAuthProcessRateLimit, LOGIN_RATE_LIMIT, OAUTH_IP_RATE_LIMIT, PASSWORD_RESET_RATE_LIMIT, REGISTRATION_IP_RATE_LIMIT, REGISTRATION_RATE_LIMIT } from "../lib/auth-rate-limit";
import { getPublicAppUrl, generatePasswordResetToken, hashPasswordResetToken, PASSWORD_RESET_TTL_MS, passwordResetTokenIsUsable } from "../lib/password-reset";
import { buildTransactionalEmail } from "../lib/email-templates";
import { loginSchema } from "../lib/validation";
import { registrationAcknowledgement } from "../lib/registration-response";
import { verificationResendAcknowledgement } from "../lib/verification-resend-response";
import { isDuplicateEmailError, resumableRegistrationUserId } from "../lib/registration-errors";
import { shouldReloadForAuthBroadcast } from "../lib/auth-client";
import { createRequire } from "node:module";
import { AUTH_SESSION_COOKIE, expiredSessionCookie, readSessionClaims } from "../lib/auth";
import { createEmailVerificationContext, verifyEmailVerificationContextToken } from "../lib/email-verification";
import { SignJWT } from "jose";
import { trustedCloudflareClientIp } from "../lib/trusted-proxy";

const priorSecret = process.env.SESSION_SECRET;
after(() => {
  if (priorSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = priorSecret;
});

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("sessions are persisted, revocable, and identity is reloaded from the active database user", async () => {
  const auth = await source("lib/auth.ts");
  assert.match(auth, /prisma\.authSession\.create/);
  assert.match(auth, /prisma\.authSession\.findUnique/);
  assert.match(auth, /revokedAt/);
  assert.match(auth, /session\.expiresAt <= new Date\(\)/);
  assert.match(auth, /where: \{ id: claims\.userId, isActive: true \}/);
  assert.match(auth, /emailVerificationRequired\(user\.role, user\.emailVerifiedAt\)/);
  assert.match(auth, /customerProfile: \{ select: \{ firstName: true, lastName: true \} \}/);
  assert.match(auth, /vendorProfile: \{ select: \{ displayName: true \} \}/);
});

test("each login endpoint verifies a password and enforces its intended role before session creation", async () => {
  const [customer, vendor, admin] = await Promise.all([
    source("app/api/auth/login/route.ts"),
    source("app/api/auth/vendor-login/route.ts"),
    source("app/api/admin/login/route.ts"),
  ]);
  for (const route of [customer, vendor, admin]) {
    assert.match(route, /bcrypt\.compare\(/);
    assert.match(route, /const session = await createSession\(user\.id\)/);
    assert.match(route, /response\.cookies\.set\(session\)/);
  }
  assert.match(customer, /!user\.passwordAuthEnabled/);
  assert.match(vendor, /!user\.passwordAuthEnabled/);
  assert.match(customer, /user\.role !== "CUSTOMER"/);
  assert.match(vendor, /mayUseVendorLogin\(user\.role\)/);
  assert.match(admin, /user\.role !== "ADMIN"/);
  assert.match(customer, /emailVerificationRequired\(user\.role, user\.emailVerifiedAt\)/);
  assert.match(vendor, /emailVerificationRequired\(user\.role, user\.emailVerifiedAt\)/);
  assert.doesNotMatch(customer, /enqueueVerificationEmail|sendVerificationEmail|forgot-password/);
  assert.doesNotMatch(vendor, /enqueueVerificationEmail|sendVerificationEmail|forgot-password/);
  assert.doesNotMatch(admin, /enqueueVerificationEmail|sendVerificationEmail|emailVerificationRequired/);
});

test("customer and vendor password login remain controlled by explicit password-auth state", async () => {
  const [customer, vendor, googleCallback, linkMigration, authMigration] = await Promise.all([
    source("app/api/auth/login/route.ts"),
    source("app/api/auth/vendor-login/route.ts"),
    source("app/api/auth/google/callback/route.ts"),
    source("prisma/migrations/20261016020000_preserve_linked_password_auth/migration.sql"),
    source("prisma/migrations/20261016010000_password_auth_provider/migration.sql"),
  ]);
  assert.match(customer, /!user\.passwordAuthEnabled/);
  assert.match(vendor, /!user\.passwordAuthEnabled/);
  assert.match(googleCallback, /passwordAuthEnabled:\s*false/);
  assert.doesNotMatch(linkMigration, /\b(UPDATE|DELETE|INSERT)\b/i);
  assert.doesNotMatch(authMigration, /\b(UPDATE|DELETE|INSERT)\b/i);
});

test("cart page redirects non-customers before rendering the client cart", async () => {
  const cart = await source("app/(customer)/cart/page.tsx");
  assert.match(cart, /const user = await currentUser\(\)/);
  assert.match(cart, /if \(!user \|\| user\.role !== "CUSTOMER"\) redirect\("\/login\?next=%2Fcart"\)/);
  assert.match(cart, /return <CartPageClient \/>/);
  assert.ok(cart.indexOf("redirect(") < cart.indexOf("return <CartPageClient"));
});

test("admin verification monitoring is role-gated and links only to existing account records", async () => {
  const page = await source("app/admin/verification/page.tsx");
  const summary = await source("components/admin-verification-summary.tsx");
  assert.match(page, /requireRole\("ADMIN"\)/);
  assert.match(page, /emailVerifiedAt:\s*null/);
  assert.match(page, /take:\s*50/);
  assert.match(page, /\/admin\/email/);
  assert.doesNotMatch(page, /enqueueEmail|sendTransactionalEmail|updateMany|\.create\(/);
  assert.match(summary, /emailVerifiedAt:\s*null/);
  assert.match(summary, /\/admin\/verification/);
});

test("logout revokes the server session and expires the same scoped cookie", async () => {
  const [auth, route, customerLogin] = await Promise.all([
    source("lib/auth.ts"),
    source("app/api/auth/logout/route.ts"),
    source("app/api/auth/login/route.ts"),
  ]);
  const createSession = auth.slice(auth.indexOf("export async function createSession"), auth.indexOf("export async function currentUser"));
  const destroySession = auth.slice(auth.indexOf("export async function destroySession"));
  assert.match(destroySession, /revokeCookieSession\(cookieStore\.get\(AUTH_SESSION_COOKIE\)\?\.value\)/);
  assert.doesNotMatch(destroySession, /cookieStore\.set/);
  assert.match(createSession, /revokeCookieSession\(cookieStore\.get\(AUTH_SESSION_COOKIE\)\?\.value\)/);
  assert.doesNotMatch(createSession, /cookieStore\.set/);
  assert.match(auth, /export function expiredSessionCookie\((secure\?: boolean)?\)[\s\S]*?sessionCookie\("", 0(, secure)?\)/);
  assert.match(auth, /maxAge <= 0 \? \{ expires: new Date\(0\) \} : \{\}/);
  assert.match(auth, /httpOnly: true/);
  assert.match(auth, /path: "\/"/);
  assert.doesNotMatch(auth, /domain:/);
  assert.match(route, /await destroySession\(\)/);
  const success = route.slice(0, route.indexOf("} catch {"));
  assert.match(success, /response\.cookies\.set\(expiredSessionCookie\((secure)?\)\)/);
  assert.match(customerLogin, /response\.cookies\.set\(session\)/);
});

test("login pages keep an authenticated visitor and offer an account switch", async () => {
  const [customer, vendor, admin, notice] = await Promise.all([
    source("app/(customer)/login/page.tsx"),
    source("app/vendor/login/page.tsx"),
    source("app/admin/login/page.tsx"),
    source("components/active-session-notice.tsx"),
  ]);
  for (const page of [customer, vendor, admin]) {
    assert.match(page, /export const dynamic = "force-dynamic"/);
    assert.match(page, /ActiveSessionNotice/);
  }
  assert.doesNotMatch(admin, /redirect\("\/admin"\)/);
  assert.match(notice, /currentUser\(\)/);
  assert.match(await source("components/account-switch-bar.tsx"), /postLogout\(\)/);
  assert.match(await source("components/account-switch-bar.tsx"), /finishAuthNavigation\(returnTo\)/);
});

test("a re-parsed logout cookie still expires in the past", () => {
  const cookie = expiredSessionCookie();
  assert.equal(cookie.name, AUTH_SESSION_COOKIE);
  assert.equal(cookie.value, "");
  assert.equal(cookie.maxAge, 0);
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.path, "/");
  assert.equal(cookie.sameSite, "lax");
  assert.equal(cookie.expires?.getTime(), 0);

  const { ResponseCookies } = createRequire(import.meta.url)("next/dist/compiled/@edge-runtime/cookies/index.js") as {
    ResponseCookies: new (headers: Headers) => {
      set: (cookie: { name: string; value: string; expires?: Date; maxAge?: number; httpOnly?: boolean; path?: string; sameSite?: string }) => void;
      get: (name: string) => { value?: string; expires?: Date; maxAge?: number } | undefined;
    };
  };
  const headers = new Headers();
  new ResponseCookies(headers).set(cookie);
  const serialized = headers.getSetCookie();
  assert.equal(serialized.length, 1);
  assert.match(serialized[0], /Max-Age=0/);
  assert.match(serialized[0], /Expires=Thu, 01 Jan 1970/);

  const reparsed = new ResponseCookies(headers).get(AUTH_SESSION_COOKIE);
  assert.ok(reparsed);
  assert.equal(reparsed.expires?.getTime(), 0);
  const roundTrip = new Headers();
  new ResponseCookies(roundTrip).set({ name: AUTH_SESSION_COOKIE, value: "", expires: reparsed.expires });
  assert.match(roundTrip.getSetCookie()[0], /Expires=Thu, 01 Jan 1970/);

  const maxAgeOnly = new Headers();
  new ResponseCookies(maxAgeOnly).set({ name: AUTH_SESSION_COOKIE, value: "", maxAge: 0, path: "/", httpOnly: true });
  const lostExpiry = new ResponseCookies(maxAgeOnly).get(AUTH_SESSION_COOKIE);
  assert.equal(lostExpiry?.expires, undefined);
});

test("new and duplicate registrations receive the same non-enumerating acknowledgement", async () => {
  process.env.SESSION_SECRET = "auth-test-session-secret-with-more-than-32-characters";
  const duplicate = await registrationAcknowledgement(null, "CUSTOMER", "/verify-email");
  const created = await registrationAcknowledgement("database-user-id", "CUSTOMER", "/verify-email");
  assert.equal(duplicate.status, 202);
  assert.equal(created.status, 202);
  assert.deepEqual(await duplicate.json(), await created.json());
  assert.equal(duplicate.headers.get("cache-control"), "no-store");
  assert.equal(duplicate.cookies.has("bagati_email_verification"), true);
  assert.equal(created.cookies.has("bagati_email_verification"), true);
  const [customer, vendor] = await Promise.all([source("app/api/auth/register/route.ts"), source("app/api/auth/vendor-register/route.ts")]);
  assert.match(vendor, /status: 410/);
  for (const route of [customer]) {
    assert.match(route, /registerSchema\.safeParse|vendorRegisterSchema\.safeParse/);
    assert.match(route, /enqueueVerificationEmail\(tx/);
    assert.match(route, /isDuplicateEmailError\(error\)/);
    assert.match(route, /resumableRegistrationUserId/);
    assert.match(route, /registrationAcknowledgement\(userId/);
    assert.match(route, /consumeAuthProcessRateLimit\("registration"/);
    assert.match(route, /consumeAuthRateLimit/);
    assert.match(route, /trustedCloudflareClientIp\(request\.headers\)/);
    assert.match(route, /registrationAcknowledgement\(null/);
    assert.ok(route.indexOf("consumeAuthProcessRateLimit") < route.indexOf("prisma.user.findFirst"));
  }
  const [queuedResend, absentResend] = [verificationResendAcknowledgement(), verificationResendAcknowledgement()];
  assert.equal(queuedResend.status, absentResend.status);
  assert.deepEqual(await queuedResend.json(), await absentResend.json());
  const resendRoute = await source("app/api/auth/resend-verification/route.ts");
  assert.equal((resendRoute.match(/verificationResendAcknowledgement\(\)/g) ?? []).length >= 5, true);
});

test("duplicate registration resumes only a matching unverified account with its password", async () => {
  const password = "Valid-Auth-Test-Password!";
  const account = {
    id: "unverified-customer",
    passwordHash: await bcrypt.hash(password, 4),
    role: "CUSTOMER" as const,
    emailVerifiedAt: null,
  };
  assert.equal(await resumableRegistrationUserId(account, password, "CUSTOMER"), account.id);
  assert.equal(await resumableRegistrationUserId(account, "wrong-password", "CUSTOMER"), null);
  assert.equal(await resumableRegistrationUserId(account, password, "VENDOR"), null);
  assert.equal(await resumableRegistrationUserId({ ...account, emailVerifiedAt: new Date() }, password, "CUSTOMER"), null);
});

test("only an email uniqueness conflict is treated as duplicate registration", () => {
  assert.equal(isDuplicateEmailError({ code: "P2002", meta: { target: ["email"] } }), true);
  assert.equal(isDuplicateEmailError({ code: "P2002", meta: { target: ["User_email_normalized_key"] } }), true);
  assert.equal(isDuplicateEmailError({ code: "P2002", meta: { target: ["EmailOutbox_dedupeKey_key"] } }), false);
  assert.equal(isDuplicateEmailError({ code: "P2025" }), false);
});

test("password recovery tokens are random, hashed at rest, expiring, and single-use", () => {
  const token = generatePasswordResetToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(hashPasswordResetToken(token), token);
  assert.match(hashPasswordResetToken(token), /^[a-f0-9]{64}$/);
  assert.equal(PASSWORD_RESET_TTL_MS, 30 * 60 * 1000);
  const now = new Date("2026-10-14T00:00:00.000Z");
  assert.equal(passwordResetTokenIsUsable({ expiresAt: new Date(now.getTime() + 1), usedAt: null }, now), true);
  assert.equal(passwordResetTokenIsUsable({ expiresAt: now, usedAt: null }, now), false);
  assert.equal(passwordResetTokenIsUsable({ expiresAt: new Date(now.getTime() + 1), usedAt: now }, now), false);
});

test("public recovery URL requires a canonical origin and HTTPS in production", () => {
  assert.equal(getPublicAppUrl("http://localhost:3000/", false), "http://localhost:3000");
  assert.throws(() => getPublicAppUrl("http://example.test", false));
  assert.throws(() => getPublicAppUrl("https://example.test/path", false));
  assert.equal(getPublicAppUrl("https://bagati.example", true), "https://bagati.example");
  assert.throws(() => getPublicAppUrl("http://bagati.example", true));
});

test("login throttling hashes normalized identities and uses separate recovery limits", () => {
  process.env.SESSION_SECRET = "auth-test-session-secret-with-more-than-32-characters";
  assert.equal(authRateLimitKey("login", " VENDOR@Example.test "), authRateLimitKey("login", "vendor@example.test"));
  assert.notEqual(authRateLimitKey("login", "vendor@example.test"), authRateLimitKey("password-reset", "vendor@example.test"));
  assert.equal(authRateLimitKey("registration", " PERSON@example.test "), authRateLimitKey("registration", "person@example.test"));
  assert.notEqual(authRateLimitKey("registration", "person@example.test"), authRateLimitKey("google-oauth-start", "person@example.test"));
  assert.equal(LOGIN_RATE_LIMIT.limit, 10);
  assert.equal(PASSWORD_RESET_RATE_LIMIT.limit, 3);
  assert.equal(REGISTRATION_RATE_LIMIT.limit, 5);
  assert.equal(REGISTRATION_IP_RATE_LIMIT.limit, 30);
  assert.equal(OAUTH_IP_RATE_LIMIT.limit, 300);
  const now = 1_000_000;
  assert.equal(consumeAuthProcessRateLimit("auth-test-process-limit", 2, 1000, now), true);
  assert.equal(consumeAuthProcessRateLimit("auth-test-process-limit", 2, 1000, now + 1), true);
  assert.equal(consumeAuthProcessRateLimit("auth-test-process-limit", 2, 1000, now + 2), false);
  assert.equal(consumeAuthProcessRateLimit("auth-test-process-limit", 2, 1000, now + 1000), true);
});

test("only explicitly trusted Cloudflare ingress supplies a client IP", () => {
  const headers = new Headers({ "cf-connecting-ip": "2001:0DB8:0:0:0:0:0:1", "x-real-ip": "198.51.100.5" });
  assert.equal(trustedCloudflareClientIp(headers, false), null);
  assert.equal(trustedCloudflareClientIp(headers, true), "2001:db8::1");
  assert.equal(trustedCloudflareClientIp(new Headers({ "x-real-ip": "198.51.100.5" }), true), null);
  assert.equal(trustedCloudflareClientIp(new Headers({ "cf-connecting-ip": "not-an-ip" }), true), null);
});

test("login and registration email identities trim whitespace and normalize case before lookup", () => {
  const parsed = loginSchema.safeParse({ email: "  Vendor@Example.test  ", password: "current-password" });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.email, "Vendor@Example.test");
  const route = "app/api/auth/vendor-login/route.ts";
  return source(route).then((vendorLogin) => {
    assert.match(vendorLogin, /parsed\.data\.email\.trim\(\)\.toLowerCase\(\)/);
    assert.match(vendorLogin, /mode: "insensitive"/);
  });
});

test("vendor login checks the seller profile before creating a session and the form validates the returned role", async () => {
  const [route, form] = await Promise.all([
    source("app/api/auth/vendor-login/route.ts"),
    source("components/vendor-login-form.tsx"),
  ]);
  const profileCheck = route.indexOf("prisma.vendorProfile.findUnique");
  const sessionCreate = route.indexOf("await createSession(user.id)");
  assert.ok(profileCheck >= 0 && sessionCreate > profileCheck);
  assert.match(route, /if \(!vendorProfile\)[\s\S]*?status: 409/);
  assert.match(form, /data\.user\?\.role !== "VENDOR"/);
  assert.match(form, /disabled=\{busy\}/);
});

test("password reset email contains the secure link and rejects unsafe protocols", () => {
  const url = "https://bagati.example/reset-password#token=opaque";
  const message = buildTransactionalEmail("PASSWORD_RESET", { resetUrl: url }, "from@example.test", "to@example.test", "reset-id");
  assert.match(String(message.subject), /Şifrənin yenilənməsi/);
  assert.match(String(message.text), /30 dəqiqə/);
  assert.match(String(message.text), new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(String(message.html), /href="https:\/\/bagati\.example\/reset-password#token=opaque"/);
  assert.throws(() => buildTransactionalEmail("PASSWORD_RESET", { resetUrl: "javascript:alert(1)" }, "from@example.test", "to@example.test", "bad"));
});

test("recovery endpoints are generic, hashed-token based, atomic, and revoke sessions", async () => {
  const [requestRoute, resetRoute, worker, migration, resetForm] = await Promise.all([
    source("app/api/auth/forgot-password/route.ts"),
    source("app/api/auth/reset-password/route.ts"),
    source("lib/email-outbox-worker.ts"),
    source("prisma/migrations/20261014003000_secure_account_recovery/migration.sql"),
    source("components/reset-password-form.tsx"),
  ]);
  assert.match(requestRoute, /status: 202/);
  assert.match(requestRoute, /consumeAuthRateLimit/);
  assert.match(requestRoute, /email: \{ equals: email, mode: "insensitive" \}/);
  assert.match(requestRoute, /select: \{ id: true, email: true, passwordAuthEnabled: true \}/);
  assert.match(requestRoute, /!user\.passwordAuthEnabled/);
  assert.match(requestRoute, /Google ilə yaradılmış və şifrə girişi bağlı olan hesablar Google girişi ilə istifadə olunur/);
  assert.match(requestRoute, /INSERT INTO "PasswordResetToken"/);
  assert.match(requestRoute, /FOR UPDATE/);
  assert.match(requestRoute, /enqueueEmail\(transaction/);
  assert.match(requestRoute, /reset-password#token=/);
  assert.match(resetRoute, /hashPasswordResetToken/);
  assert.match(resetRoute, /"expiresAt" > \$\{now\}/);
  assert.match(resetRoute, /claimed !== 1/);
  assert.match(resetRoute, /FOR UPDATE/);
  assert.match(resetRoute, /authSession\.updateMany/);
  assert.match(resetRoute, /bcrypt\.hash\(parsed\.data\.password, 12\)/);
  assert.match(resetRoute, /"passwordAuthEnabled" = true/);
  assert.match(resetRoute, /AND "passwordAuthEnabled" = true/);
  const passwordChangeRoute = await source("app/api/account/security/password/route.ts");
  assert.match(passwordChangeRoute, /passwordAuthEnabled/);
  assert.match(passwordChangeRoute, /if \(!record\?\.passwordAuthEnabled\)/);
  assert.match(resetForm, /window\.location\.hash/);
  assert.match(resetForm, /window\.history\.replaceState/);
  assert.match(resetForm, /searchParams\.delete\("token"\)/);
  assert.match(worker, /PASSWORD_RESET_STALE/);
  assert.match(migration, /CREATE TABLE "PasswordResetToken"/);
  assert.match(migration, /CREATE TABLE "AuthRateLimit"/);
  assert.match(migration, /CREATE UNIQUE INDEX "User_email_normalized_key"/);
  assert.doesNotMatch(migration, /\b(DROP|TRUNCATE|DELETE FROM|UPDATE "User")\b/i);
});

const JWT_TEST_SECRET = "auth-test-session-secret-with-more-than-32-characters";
const sessionSigner = (alg: string, secret = JWT_TEST_SECRET) => new SignJWT({ sub: "user-1", jti: "session-1" })
  .setProtectedHeader({ alg })
  .setIssuer("bagati")
  .setAudience("bagati-session")
  .setIssuedAt()
  .setExpirationTime("5m")
  .sign(new TextEncoder().encode(secret));

test("session cookie verification accepts only HS256 tokens with the intended claims", async () => {
  process.env.SESSION_SECRET = JWT_TEST_SECRET;
  assert.deepEqual(await readSessionClaims(await sessionSigner("HS256")), { userId: "user-1", sessionId: "session-1" });
  await assert.rejects(readSessionClaims(await sessionSigner("HS384")), /alg/);
  await assert.rejects(readSessionClaims(await sessionSigner("HS512")), /alg/);
  await assert.rejects(readSessionClaims(await sessionSigner("HS256", "another-secret-with-more-than-32-characters-xx")));
  const expired = await new SignJWT({ sub: "user-1", jti: "session-1" }).setProtectedHeader({ alg: "HS256" }).setIssuer("bagati").setAudience("bagati-session")
    .setIssuedAt(Math.floor(Date.now() / 1000) - 600).setExpirationTime(Math.floor(Date.now() / 1000) - 300).sign(new TextEncoder().encode(JWT_TEST_SECRET));
  await assert.rejects(readSessionClaims(expired), /exp/);
  const wrongIssuer = await new SignJWT({ sub: "user-1", jti: "session-1" }).setProtectedHeader({ alg: "HS256" }).setIssuer("not-bagati").setAudience("bagati-session").setExpirationTime("5m").sign(new TextEncoder().encode(JWT_TEST_SECRET));
  await assert.rejects(readSessionClaims(wrongIssuer), /iss/);
  const wrongAudience = await new SignJWT({ sub: "user-1", jti: "session-1" }).setProtectedHeader({ alg: "HS256" }).setIssuer("bagati").setAudience("email-verification").setExpirationTime("5m").sign(new TextEncoder().encode(JWT_TEST_SECRET));
  await assert.rejects(readSessionClaims(wrongAudience), /aud/);
});

test("email verification context accepts only HS256 tokens issued for verification", async () => {
  process.env.SESSION_SECRET = JWT_TEST_SECRET;
  const valid = await createEmailVerificationContext("user-2", "CUSTOMER");
  assert.deepEqual(await verifyEmailVerificationContextToken(valid), { userId: "user-2", role: "CUSTOMER" });
  const forge = (alg: string, overrides: { iss?: string; aud?: string; purpose?: string; role?: string } = {}) => new SignJWT({ purpose: overrides.purpose ?? "email-verification", role: overrides.role ?? "CUSTOMER" })
    .setProtectedHeader({ alg }).setIssuer(overrides.iss ?? "bagati").setAudience(overrides.aud ?? "email-verification").setSubject("user-2").setIssuedAt().setExpirationTime("5m").sign(new TextEncoder().encode(JWT_TEST_SECRET));
  assert.equal(await verifyEmailVerificationContextToken(await forge("HS384")), null);
  assert.equal(await verifyEmailVerificationContextToken(await forge("HS256", { aud: "bagati-session" })), null);
  assert.equal(await verifyEmailVerificationContextToken(await forge("HS256", { iss: "other" })), null);
  assert.equal(await verifyEmailVerificationContextToken(await forge("HS256", { purpose: "session" })), null);
  assert.equal(await verifyEmailVerificationContextToken(`${valid}x`), null);
  const expired = await new SignJWT({ purpose: "email-verification", role: "CUSTOMER" }).setProtectedHeader({ alg: "HS256" }).setIssuer("bagati").setAudience("email-verification").setSubject("user-2")
    .setIssuedAt(Math.floor(Date.now() / 1000) - 600).setExpirationTime(Math.floor(Date.now() / 1000) - 300).sign(new TextEncoder().encode(JWT_TEST_SECRET));
  assert.equal(await verifyEmailVerificationContextToken(expired), null);
});

test("an auth change reloads other tabs and leaves the tab that made the change alone", () => {
  assert.equal(shouldReloadForAuthBroadcast({ type: "changed", sender: "other-tab" }, "this-tab"), true);
  assert.equal(shouldReloadForAuthBroadcast({ type: "changed", sender: "this-tab" }, "this-tab"), false);
  assert.equal(shouldReloadForAuthBroadcast({ type: "noop", sender: "other-tab" }, "this-tab"), false);
  assert.equal(shouldReloadForAuthBroadcast(null, "this-tab"), false);
});

test("AuthSession migration is additive and retains existing user data", async () => {
  const migration = await source("prisma/migrations/20261008190000_auth_sessions/migration.sql");
  assert.match(migration, /CREATE TABLE "AuthSession"/);
  assert.match(migration, /FOREIGN KEY \("userId"\) REFERENCES "User"\("id"\) ON DELETE CASCADE/);
  assert.doesNotMatch(migration, /\b(DROP|TRUNCATE|DELETE FROM|UPDATE "User")\b/i);
});
