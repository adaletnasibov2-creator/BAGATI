/**
 * SIGNUP-EASY-2: A one-click Google sign-up (pending sign-up cookie + complete-register), B a guest's add-to-cart kept
 * through the login, C the hint under the login form. Unit tests only: in-memory stand-ins replace the database and
 * the browser storage; the token signing, CSRF check, redirect sanitizing and handler are the real functions.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import { SignJWT } from "jose";
import { NextResponse } from "next/server";
import {
  consumePendingGoogleSignupOnce,
  createPendingGoogleSignupToken,
  expiredPendingGoogleSignupCookie,
  GOOGLE_PENDING_SIGNUP_COOKIE,
  GOOGLE_PENDING_SIGNUP_MAX_AGE,
  pendingGoogleSignupCookieOptions,
  verifyPendingGoogleSignupToken,
} from "../lib/google-pending-signup";
import { handleCompleteGoogleRegister, type CompleteGoogleRegisterDeps } from "../lib/google-complete-register";
import { createGoogleCustomerAccount, type GoogleCustomerAccountDb } from "../lib/google-customer-account";
import type { GoogleIdentity } from "../lib/google-oauth";
import { LEGAL_VERSIONS } from "../lib/legal-versions";
import {
  addRememberedCartItem,
  PENDING_CART_ADD_KEY,
  PENDING_CART_ADD_MAX_AGE_MS,
  rememberPendingCartAdd,
  takePendingCartAdd,
  type PendingCartStorage,
} from "../lib/pending-cart-add";

// Read when the functions run (not at import), so setting it here is enough. Throwaway test value.
process.env.SESSION_SECRET ??= "signup-easy-2-unit-test-secret-0123456789abcdef";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");

const T1_START = "Google hesabınız: ";
const T1_END = ". Hesab yaratmaq üçün şərtlərlə razılığınızı təsdiqləyib «Hesab yarat» düyməsini basın.";
const T2 = "Google hesabı ilə hesab yarat";
const T3 = "Seçdiyiniz məhsul səbətə əlavə edildi.";
const T4 = "Hesabınızı Google ilə yaratmısınızsa, «Google ilə davam et» düyməsindən istifadə edin.";

const identity: GoogleIdentity = { sub: "google-sub-1", email: "new@example.test", givenName: "Ayan", familyName: "Q", name: "Ayan Q" };
const verified = { ...identity, emailVerified: true };

/** The same key derivation as lib/google-pending-signup.ts, to sign hand-made (hostile) tokens. */
const pendingKey = () => createHmac("sha256", process.env.SESSION_SECRET!).update("BAGATI_GOOGLE_PENDING_SIGNUP_V1").digest();
async function craft(claims: Record<string, unknown>, options: { key?: Uint8Array; audience?: string; expiresIn?: string | number; alg?: string } = {}) {
  const base = { purpose: "google-pending-signup", email: identity.email, email_verified: true, given_name: "Ayan", family_name: "Q", name: "Ayan Q", next: "/checkout" };
  let jwt = new SignJWT({ ...base, ...claims }).setProtectedHeader({ alg: options.alg ?? "HS256" }).setIssuer("bagati").setAudience(options.audience ?? "google-pending-signup").setSubject(identity.sub).setJti(`jti-${Math.random()}`).setIssuedAt();
  jwt = jwt.setExpirationTime(options.expiresIn ?? "600s");
  return jwt.sign(options.key ?? pendingKey());
}

// ---------------------------------------------------------------- A: the pending sign-up cookie

test("A: the cookie value round-trips the verified identity and a sanitized next", async () => {
  const token = await createPendingGoogleSignupToken(verified, "/checkout?step=1");
  const pending = await verifyPendingGoogleSignupToken(token);
  assert.ok(pending);
  assert.deepEqual(pending.identity, identity);
  assert.equal(pending.next, "/checkout?step=1");
  assert.ok(pending.id.length > 10);
  assert.ok(pending.expiresAt > Date.now() && pending.expiresAt <= Date.now() + GOOGLE_PENDING_SIGNUP_MAX_AGE * 1000 + 1000);
  // Two cookies for the same identity are different (single-use ids).
  const other = await verifyPendingGoogleSignupToken(await createPendingGoogleSignupToken(verified, "/"));
  assert.notEqual(other?.id, pending.id);
});

test("A: email_verified false never gets a cookie (refused when signing, refused when reading)", async () => {
  await assert.rejects(createPendingGoogleSignupToken({ ...identity, emailVerified: false }, "/"));
  assert.equal(await verifyPendingGoogleSignupToken(await craft({ email_verified: false })), null);
  assert.equal(await verifyPendingGoogleSignupToken(await craft({ email_verified: "true" })), null);
  // The callback only builds it after exchangeGoogleCode, which throws on email_verified !== true.
  const oauth = read("lib/google-oauth.ts");
  assert.match(oauth, /if \(payload\.email_verified !== true\) throw new GoogleEmailUnverifiedError\(\);/);
});

test("A: wrong, expired, tampered, foreign-key, wrong-audience, wrong-purpose or missing cookies are refused", async () => {
  const good = await createPendingGoogleSignupToken(verified, "/");
  const [header, payload, signature] = good.split(".");
  const tamperedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), email: "admin@example.test" })).toString("base64url");
  const cases: Array<[string, string | undefined]> = [
    ["missing", undefined],
    ["empty", ""],
    ["garbage", "not-a-token"],
    ["tampered payload", `${header}.${tamperedPayload}.${signature}`],
    ["tampered signature", `${header}.${payload}.${signature.slice(0, -2)}${signature.endsWith("AA") ? "BB" : "AA"}`],
    ["expired", await craft({}, { expiresIn: Math.floor(Date.now() / 1000) - 5 })],
    ["raw SESSION_SECRET key (session / e-mail-verification style)", await craft({}, { key: new TextEncoder().encode(process.env.SESSION_SECRET!) })],
    ["session audience", await craft({}, { audience: "bagati-session" })],
    ["e-mail verification audience", await craft({}, { audience: "email-verification" })],
    ["wrong purpose", await craft({ purpose: "email-verification" })],
    ["HS512", await craft({}, { alg: "HS512" })],
    ["upper-case e-mail", await craft({ email: "New@Example.test" })],
    ["bad e-mail", await craft({ email: "nobody" })],
    ["long name", await craft({ name: "x".repeat(81) })],
    ["no next", await craft({ next: 5 })],
    ["oversized", "a".repeat(5000)],
  ];
  for (const [label, token] of cases) assert.equal(await verifyPendingGoogleSignupToken(token), null, label);
  const unsigned = `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${payload}.`;
  assert.equal(await verifyPendingGoogleSignupToken(unsigned), null, "alg none");
});

test("A: next is sanitized for a customer when signing and again when reading", async () => {
  for (const hostile of ["//evil.example", "https://evil.example", "/\\evil", "/admin", "/vendor/products", "javascript:alert(1)"]) {
    const pending = await verifyPendingGoogleSignupToken(await createPendingGoogleSignupToken(verified, hostile));
    assert.equal(pending?.next, "/account", hostile);
    assert.equal((await verifyPendingGoogleSignupToken(await craft({ next: hostile })))?.next, "/account", `crafted ${hostile}`);
  }
  assert.equal((await verifyPendingGoogleSignupToken(await createPendingGoogleSignupToken(verified, "/vendor/apply")))?.next, "/vendor/apply");
});

test("A: cookie is HttpOnly, SameSite=Lax, 10 minutes, Secure like the other OAuth cookies; clearing expires it", () => {
  const options = pendingGoogleSignupCookieOptions();
  assert.equal(options.httpOnly, true);
  assert.equal(options.sameSite, "lax");
  assert.equal(options.maxAge, 600);
  assert.equal(options.path, "/");
  assert.equal(options.secure, process.env.NODE_ENV === "production");
  assert.match(read("lib/google-pending-signup.ts"), /secure: process\.env\.NODE_ENV === "production",/);
  assert.match(read("lib/google-oauth.ts"), /secure: process\.env\.NODE_ENV === "production",/);
  const cleared = expiredPendingGoogleSignupCookie();
  assert.equal(cleared.name, GOOGLE_PENDING_SIGNUP_COOKIE);
  assert.equal(cleared.value, "");
  assert.equal(cleared.maxAge, 0);
  assert.equal(cleared.httpOnly, true);
});

test("A: the in-process single-use marker accepts an id once", () => {
  const id = `single-${Math.random()}`;
  assert.equal(consumePendingGoogleSignupOnce(id, Date.now() + 60_000), true);
  assert.equal(consumePendingGoogleSignupOnce(id, Date.now() + 60_000), false);
});

// ---------------------------------------------------------------- A: POST /api/auth/google/complete-register

type Account = { id: string; email: string; role: "CUSTOMER" | "VENDOR" | "ADMIN"; googleSub?: string };
function world(options: { accounts?: Account[]; rateLimited?: boolean; createThrows?: "race" | "error"; separateProcesses?: boolean } = {}) {
  const accounts: Account[] = [...(options.accounts ?? [])];
  const created: GoogleIdentity[] = [];
  const sessions: string[] = [];
  const used = new Set<string>();
  const deps = (token: string | undefined): CompleteGoogleRegisterDeps => ({
    readToken: async () => token,
    rateLimitAllowed: async () => !options.rateLimited,
    accountExists: async id => accounts.some(account => account.email === id.email || account.googleSub === id.sub),
    createAccount: async id => {
      if (options.createThrows === "race") { accounts.push({ id: "raced", email: id.email, role: "CUSTOMER", googleSub: id.sub }); throw new Error("P2002"); }
      if (options.createThrows === "error") throw new Error("database down");
      const account = { id: `user-${accounts.length + 1}`, email: id.email, role: "CUSTOMER" as const, googleSub: id.sub };
      accounts.push(account); created.push(id);
      return { id: account.id };
    },
    createSession: async userId => { sessions.push(userId); return { name: "bagati_session", value: `session-for-${userId}`, httpOnly: true, secure: false, sameSite: "lax" as const, path: "/", maxAge: 3600 }; },
    // Separate processes: each call has its own marker (only the database re-check is shared).
    consumeOnce: options.separateProcesses ? () => true : id => (used.has(id) ? false : (used.add(id), true)),
    log: () => {},
  });
  return { accounts, created, sessions, deps };
}

function post(body: unknown, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/auth/google/complete-register", {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3000", origin },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function json(response: NextResponse) { return response.json() as Promise<Record<string, unknown>>; }
const pendingCleared = (response: NextResponse) => response.cookies.get(GOOGLE_PENDING_SIGNUP_COOKIE)?.value === "" && response.cookies.get(GOOGLE_PENDING_SIGNUP_COOKIE)?.maxAge === 0;

test("A: valid cookie + ticked box creates ONE customer, signs in, clears the cookie and goes to the sanitized next", async () => {
  const w = world();
  const token = await createPendingGoogleSignupToken(verified, "/products/p1");
  const response = await handleCompleteGoogleRegister(post({ acceptTerms: true }), w.deps(token));
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), { redirectTo: "/products/p1" });
  assert.deepEqual(w.created, [identity]);
  assert.deepEqual(w.sessions, ["user-1"]);
  assert.equal(response.cookies.get("bagati_session")?.value, "session-for-user-1");
  assert.ok(pendingCleared(response));
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("A: single use — a second call with the same cookie fails and creates/signs in nothing", async () => {
  const w = world();
  const token = await createPendingGoogleSignupToken(verified, "/");
  assert.equal((await handleCompleteGoogleRegister(post({ acceptTerms: true }), w.deps(token))).status, 200);
  const again = await handleCompleteGoogleRegister(post({ acceptTerms: true }), w.deps(token));
  assert.equal(again.status, 400);
  assert.deepEqual(await json(again), { code: "invalid" });
  assert.ok(pendingCleared(again));
  assert.equal(w.created.length, 1);
  assert.equal(w.sessions.length, 1);
});

test("A: single use across processes — the database re-check refuses the replay and never signs the account in", async () => {
  const w = world({ separateProcesses: true });
  const token = await createPendingGoogleSignupToken(verified, "/");
  assert.equal((await handleCompleteGoogleRegister(post({ acceptTerms: true }), w.deps(token))).status, 200);
  const again = await handleCompleteGoogleRegister(post({ acceptTerms: true }), w.deps(token));
  assert.equal(again.status, 409);
  assert.deepEqual(await json(again), { code: "account-exists" });
  assert.equal(w.created.length, 1);
  assert.equal(w.sessions.length, 1, "the replay got no session");
});

test("A: missing, tampered, expired or foreign cookies → no account, no session, cookie cleared", async () => {
  const good = await createPendingGoogleSignupToken(verified, "/");
  const tokens = [undefined, "", "x.y.z", `${good.slice(0, -3)}abc`, await craft({}, { expiresIn: Math.floor(Date.now() / 1000) - 1 }), await craft({}, { audience: "bagati-session" }), await craft({ email_verified: false })];
  for (const token of tokens) {
    const w = world();
    const response = await handleCompleteGoogleRegister(post({ acceptTerms: true }), w.deps(token));
    assert.equal(response.status, 400, String(token));
    assert.deepEqual(await json(response), { code: "invalid" });
    assert.ok(pendingCleared(response));
    assert.equal(w.created.length, 0);
    assert.equal(w.sessions.length, 0);
  }
});

test("A: terms box not ticked → nothing created, the cookie stays usable", async () => {
  const w = world();
  const token = await createPendingGoogleSignupToken(verified, "/");
  for (const body of [{}, { acceptTerms: false }, { acceptTerms: "true" }, { acceptTerms: 1 }, "not json", null]) {
    const response = await handleCompleteGoogleRegister(post(body === null ? "null" : body), w.deps(token));
    assert.equal(response.status, 400);
    assert.deepEqual(await json(response), { code: "terms-required" });
    assert.equal(response.cookies.get(GOOGLE_PENDING_SIGNUP_COOKIE), undefined, "cookie untouched");
  }
  assert.equal(w.created.length, 0);
  assert.equal(w.sessions.length, 0);
  // Ticking the box afterwards still works with the same cookie.
  assert.equal((await handleCompleteGoogleRegister(post({ acceptTerms: true }), w.deps(token))).status, 200);
});

test("A: an existing e-mail (ADMIN, VENDOR or CUSTOMER) or an already linked Google id never gets an account or a session", async () => {
  for (const existing of [
    { id: "admin", email: identity.email, role: "ADMIN" as const },
    { id: "vendor", email: identity.email, role: "VENDOR" as const },
    { id: "customer", email: identity.email, role: "CUSTOMER" as const },
    { id: "linked", email: "other@example.test", role: "CUSTOMER" as const, googleSub: identity.sub },
  ]) {
    const w = world({ accounts: [existing] });
    const response = await handleCompleteGoogleRegister(post({ acceptTerms: true }), w.deps(await createPendingGoogleSignupToken(verified, "/")));
    assert.equal(response.status, 409, existing.id);
    assert.deepEqual(await json(response), { code: "account-exists" });
    assert.equal(w.created.length, 0);
    assert.deepEqual(w.sessions, [], `${existing.id}: the cookie cannot log in an existing account`);
    assert.equal(response.cookies.get("bagati_session"), undefined);
    assert.ok(pendingCleared(response));
  }
});

test("A: a concurrent creation (unique index) answers account-exists; a database error answers failed; neither signs in", async () => {
  const raced = world({ createThrows: "race" });
  const r1 = await handleCompleteGoogleRegister(post({ acceptTerms: true }), raced.deps(await createPendingGoogleSignupToken(verified, "/")));
  assert.deepEqual([r1.status, await json(r1)], [409, { code: "account-exists" }]);
  assert.equal(raced.sessions.length, 0);
  const broken = world({ createThrows: "error" });
  const r2 = await handleCompleteGoogleRegister(post({ acceptTerms: true }), broken.deps(await createPendingGoogleSignupToken(verified, "/")));
  assert.deepEqual([r2.status, await json(r2)], [500, { code: "failed" }]);
  assert.equal(broken.sessions.length, 0);
});

test("A: cross-site POST and rate limit are refused before anything else", async () => {
  const w = world();
  const token = await createPendingGoogleSignupToken(verified, "/");
  const cross = await handleCompleteGoogleRegister(post({ acceptTerms: true }, "https://evil.example"), w.deps(token));
  assert.equal(cross.status, 403);
  assert.equal((await json(cross)).code, "CROSS_SITE_REQUEST");
  const limited = world({ rateLimited: true });
  const r = await handleCompleteGoogleRegister(post({ acceptTerms: true }), limited.deps(token));
  assert.deepEqual([r.status, await json(r)], [429, { code: "rate-limited" }]);
  assert.equal(w.created.length + limited.created.length, 0);
  // The cookie was not consumed by the refused calls.
  assert.equal((await handleCompleteGoogleRegister(post({ acceptTerms: true }), w.deps(token))).status, 200);
});

test("A: the route wires the real pieces (same-origin, rate limits, re-check of e-mail AND Google id, shared creation)", () => {
  const route = read("app/api/auth/google/complete-register/route.ts");
  assert.match(route, /export async function POST\(/);
  assert.doesNotMatch(route, /export async function GET/);
  assert.match(route, /consumeAuthProcessRateLimit\("google-complete-register"/);
  assert.match(route, /authRateLimitKey\("google-complete-register", `ip:\$\{clientIp\}`\)/);
  assert.match(route, /existingAccountIdentity\(identity\.email\)\)\.kind !== "none"/);
  assert.match(route, /"GoogleAccount" WHERE "googleSub" = \$\{identity\.sub\}/);
  assert.match(route, /createAccount: identity => createGoogleCustomerAccount\(prisma, identity\)/);
  assert.match(route, /request\.cookies\.get\(GOOGLE_PENDING_SIGNUP_COOKIE\)/);
  assert.match(read("lib/google-complete-register.ts"), /const crossSite = csrfRejection\(request\);\n  if \(crossSite\) return crossSite;/);
});

// ---------------------------------------------------------------- A: the shared creation function

function transactionWorld(options: { userCreateThrows?: boolean } = {}) {
  const writes: Array<{ op: string; data: unknown }> = [];
  const tx = {
    user: { create: async (args: { data: unknown }) => { if (options.userCreateThrows) throw new Error("P2002"); writes.push({ op: "user.create", data: args.data }); return { id: "new-user" }; } },
    $executeRaw: async (sql: { values: unknown[]; strings: readonly string[] }) => { writes.push({ op: "googleAccount.insert", data: { text: sql.strings.join("?"), values: sql.values } }); return 1; },
    emailOutbox: { upsert: async (args: { create: unknown }) => { writes.push({ op: "emailOutbox.upsert", data: args.create }); return { id: "mail" }; } },
    legalAcceptance: {
      createMany: async (args: { data: unknown[] }) => { writes.push({ op: "legalAcceptance.createMany", data: args.data[0] }); return { count: 1 }; },
      findUnique: async () => ({ id: "acceptance" }),
    },
    auditLog: { create: async (args: { data: unknown }) => { writes.push({ op: "auditLog.create", data: args.data }); return { id: "audit" }; } },
  };
  let committed: typeof writes = [];
  const db = { $transaction: async (work: (t: typeof tx) => Promise<unknown>) => { const result = await work(tx); committed = [...writes]; return result; } };
  return { db: db as unknown as GoogleCustomerAccountDb, writes: () => committed };
}

test("A: the shared creation makes a CUSTOMER with password sign-in off, verified e-mail, profile, cart, Google link, welcome mail and REGISTER_GOOGLE acceptance", async () => {
  const w = transactionWorld();
  const result = await createGoogleCustomerAccount(w.db, identity);
  assert.deepEqual(result, { id: "new-user" });
  const writes = w.writes();
  assert.deepEqual(writes.map(write => write.op), ["user.create", "googleAccount.insert", "emailOutbox.upsert", "legalAcceptance.createMany", "auditLog.create"]);
  const user = writes[0].data as Record<string, unknown>;
  assert.equal(user.email, identity.email);
  assert.equal(user.role, "CUSTOMER");
  assert.equal(user.passwordAuthEnabled, false);
  assert.equal(user.isActive, true);
  assert.ok(user.emailVerifiedAt instanceof Date);
  assert.match(String(user.passwordHash), /^\$2[aby]\$12\$/);
  assert.deepEqual(user.customerProfile, { create: { firstName: "Ayan", lastName: "Q" } });
  assert.deepEqual(user.cart, { create: {} });
  const link = writes[1].data as { text: string; values: unknown[] };
  assert.match(link.text, /INSERT INTO "GoogleAccount"/);
  assert.ok(link.values.includes(identity.sub) && link.values.includes("new-user"));
  assert.equal((writes[2].data as { template: string }).template, "WELCOME_CUSTOMER");
  assert.equal((writes[2].data as { recipient: string }).recipient, identity.email);
  assert.deepEqual(writes[3].data, { userId: "new-user", document: "CUSTOMER_TERMS", version: LEGAL_VERSIONS.CUSTOMER_TERMS, source: "REGISTER_GOOGLE", vendorApplicationId: null });
});

test("A: a duplicate (unique index) writes nothing", async () => {
  const w = transactionWorld({ userCreateThrows: true });
  await assert.rejects(createGoogleCustomerAccount(w.db, identity));
  assert.deepEqual(w.writes(), []);
});

test("A: ONE creation function used by both the callback and complete-register (no duplicate)", () => {
  const callback = read("app/api/auth/google/callback/route.ts");
  const route = read("app/api/auth/google/complete-register/route.ts");
  const creation = read("lib/google-customer-account.ts");
  assert.equal(creation.match(/\.user\.create\(/g)?.length, 1);
  for (const source of [callback, route]) {
    assert.equal(source.match(/createGoogleCustomerAccount\(prisma, identity\)/g)?.length, 1);
    assert.doesNotMatch(source, /\.user\.create\(|WELCOME_CUSTOMER|recordAcceptance|passwordAuthEnabled/);
  }
  // Nothing else in the app creates Google accounts.
  const users: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry) && /createGoogleCustomerAccount\(/.test(readFileSync(full, "utf8"))) users.push(relative(root, full).replace(/\\/g, "/"));
    }
  };
  for (const dir of ["app", "lib", "components"]) walk(resolve(root, dir));
  assert.deepEqual(users.sort(), ["app/api/auth/google/callback/route.ts", "app/api/auth/google/complete-register/route.ts", "lib/google-customer-account.ts"]);
});

test("A: callback — register-required now sets the pending cookie; the old message stays as fallback; other paths unchanged", () => {
  const callback = read("app/api/auth/google/callback/route.ts");
  assert.match(callback, /if \(decision\.kind === "redirect" && decision\.result === "register-required"\) \{\n      const pending = await pendingSignupRedirect\(origin, state, identity\);\n      if \(pending\) return pending;\n    \}\n    if \(decision\.kind === "link"\)/);
  // Fallback: when the cookie cannot be made, pendingSignupRedirect returns null and resultUrl(..."register-required") runs.
  const helper = callback.slice(callback.indexOf("async function pendingSignupRedirect"), callback.indexOf("function finish("));
  assert.match(helper, /createPendingGoogleSignupToken\(\{ \.\.\.identity, emailVerified: true \}, state\.next\)/);
  assert.match(helper, /new URL\("\/register", origin\)/);
  assert.match(helper, /safeOAuthNextPath\(state\.next, "customer"\)/);
  assert.match(helper, /finish\(NextResponse\.redirect\(target\)\)/, "the OAuth state cookie is cleared, no-store");
  assert.match(helper, /pendingGoogleSignupCookieOptions\(\)/);
  assert.match(helper, /catch \(error\) \{\n    logAuthFailure\("google_pending_signup_cookie", error\);\n    return null;/);
  assert.match(callback, /REGISTER_RESULTS = new Set\(\["register-required", "terms-required"\]\)/);
  assert.match(read("components/google-oauth-button.tsx"), /case "register-required": return "Əvvəlcə qeydiyyatdan keçin\./);
  // The pending cookie is reached only after the decision (never for a linked/existing/ADMIN/seller account).
  assert.ok(callback.indexOf("pendingSignupRedirect(origin, state, identity)") > callback.indexOf("let decision = await resolve();"));
  assert.match(read("lib/google-oauth-decision.ts"), /if \(input\.intent === "customer"\) return input\.customerTermsAccepted \? \{ kind: "create-customer" \} : \{ kind: "redirect", result: "register-required" \};/);
});

test("A: /register shows T1 + the existing consent box + T2 only with a valid cookie; otherwise exactly as before", () => {
  const page = read("app/(customer)/register/page.tsx");
  assert.match(page, /const googlePending = await readPendingGoogleSignup\(\);/);
  assert.match(page, /googlePendingEmail=\{googlePending\?\.identity\.email\}/);
  const form = read("components/register-form.tsx");
  assert.match(form, /\{googlePendingEmail \? <div className="mt-7 space-y-3">/);
  assert.match(form, /<\/div> : <GoogleOAuthButton intent="customer" mode="register" nextPath=\{nextPath\} errorCode=\{oauthError\} portal=\{portal\} termsGate=\{\{ accepted: acceptTerms, onBlocked: blockWithoutTerms \}\}\/>\}/);
  // The same consent checkbox is rendered once, before both ways.
  assert.equal(form.match(/<LegalConsentCheckbox /g)?.length, 1);
  assert.match(form, /if \(!acceptTerms\) \{ blockWithoutTerms\(\); return; \}\n    if \(googleBusy\) return;/);
  assert.match(form, /fetch\("\/api\/auth\/google\/complete-register", \{\n        method: "POST",/);
  assert.match(form, /body: JSON\.stringify\(\{ acceptTerms: true \}\)/);
  assert.match(form, /finishAuthNavigation\(data\.redirectTo\)/);
  // The cookie is HttpOnly: the page only receives the e-mail, never the token.
  assert.doesNotMatch(form, /bagati_google_signup|document\.cookie/);
});

// ---------------------------------------------------------------- B: remembered add-to-cart

function memoryStorage(options: { removeThrows?: boolean; getThrows?: boolean; setThrows?: boolean } = {}) {
  const map = new Map<string, string>();
  const storage: PendingCartStorage = {
    getItem: key => { if (options.getThrows) throw new Error("blocked"); return map.get(key) ?? null; },
    setItem: (key, value) => { if (options.setThrows) throw new Error("quota"); map.set(key, value); },
    removeItem: key => { if (options.removeThrows) throw new Error("blocked"); map.delete(key); },
  };
  return { storage, map };
}

function poster(result: { ok: boolean; status: number; error?: string }) {
  const calls: unknown[] = [];
  return { calls, post: async (body: unknown) => { calls.push(body); return result; } };
}

test("B: the remembered item is added once — refresh / back / second effect run do not add it again", async () => {
  const { storage, map } = memoryStorage();
  assert.equal(rememberPendingCartAdd(storage, { productId: "p1", variantId: "v1", quantity: 2 }), true);
  const server = poster({ ok: true, status: 201 });
  assert.deepEqual(await addRememberedCartItem({ storage, productId: "p1", viewerIsCustomer: true, post: server.post }), { kind: "added" });
  assert.deepEqual(server.calls, [{ productId: "p1", variantId: "v1", quantity: 2 }]);
  assert.equal(map.has(PENDING_CART_ADD_KEY), false);
  assert.equal(await addRememberedCartItem({ storage, productId: "p1", viewerIsCustomer: true, post: server.post }), null);
  assert.equal(server.calls.length, 1);
});

test("B: the item is removed BEFORE the request, and nothing is sent if it cannot be removed", async () => {
  const { storage, map } = memoryStorage();
  rememberPendingCartAdd(storage, { productId: "p1", quantity: 1 });
  let storedDuringRequest: boolean | null = null;
  await addRememberedCartItem({ storage, productId: "p1", viewerIsCustomer: true, post: async () => { storedDuringRequest = map.has(PENDING_CART_ADD_KEY); return { ok: true, status: 201 }; } });
  assert.equal(storedDuringRequest, false);
  const locked = memoryStorage({ removeThrows: true });
  locked.map.set(PENDING_CART_ADD_KEY, JSON.stringify({ productId: "p1", quantity: 1, savedAt: Date.now() }));
  const server = poster({ ok: true, status: 201 });
  assert.equal(await addRememberedCartItem({ storage: locked.storage, productId: "p1", viewerIsCustomer: true, post: server.post }), null);
  assert.equal(server.calls.length, 0);
});

test("B: a pending item for a different product is ignored and kept for its own page", async () => {
  const { storage, map } = memoryStorage();
  rememberPendingCartAdd(storage, { productId: "p2", quantity: 1 });
  const server = poster({ ok: true, status: 201 });
  assert.equal(await addRememberedCartItem({ storage, productId: "p1", viewerIsCustomer: true, post: server.post }), null);
  assert.equal(server.calls.length, 0);
  assert.equal(map.has(PENDING_CART_ADD_KEY), true);
  assert.deepEqual(await addRememberedCartItem({ storage, productId: "p2", viewerIsCustomer: true, post: server.post }), { kind: "added" });
});

test("B: a vendor, an admin or a guest (viewerIsCustomer false) never triggers the add and leaves the item alone", async () => {
  const { storage, map } = memoryStorage();
  rememberPendingCartAdd(storage, { productId: "p1", quantity: 1 });
  const server = poster({ ok: true, status: 201 });
  assert.equal(await addRememberedCartItem({ storage, productId: "p1", viewerIsCustomer: false, post: server.post }), null);
  assert.equal(server.calls.length, 0);
  assert.equal(map.has(PENDING_CART_ADD_KEY), true);
  const page = read("app/(customer)/products/[productId]/page.tsx");
  assert.match(page, /viewerIsCustomer=\{viewer\?\.role === "CUSTOMER"\}/);
  assert.match(page, /const viewer = await currentUser\(\);/);
});

test("B: older than 30 minutes, from the future or malformed → nothing added, item removed", async () => {
  const now = Date.now();
  for (const raw of [
    JSON.stringify({ productId: "p1", quantity: 1, savedAt: now - PENDING_CART_ADD_MAX_AGE_MS - 1 }),
    JSON.stringify({ productId: "p1", quantity: 1, savedAt: now + 60_000 }),
    JSON.stringify({ productId: "p1", quantity: 99, savedAt: now }),
    JSON.stringify({ productId: "../x", quantity: 1, savedAt: now }),
    "{not json",
  ]) {
    const { storage, map } = memoryStorage();
    map.set(PENDING_CART_ADD_KEY, raw);
    const server = poster({ ok: true, status: 201 });
    assert.equal(await addRememberedCartItem({ storage, productId: "p1", viewerIsCustomer: true, post: server.post, now }), null, raw);
    assert.equal(server.calls.length, 0);
    assert.equal(map.has(PENDING_CART_ADD_KEY), false, raw);
  }
  const { storage } = memoryStorage();
  rememberPendingCartAdd(storage, { productId: "p1", quantity: 1 }, now - PENDING_CART_ADD_MAX_AGE_MS + 1000);
  assert.ok(takePendingCartAdd(storage, "p1", now), "29m59s is still fresh");
});

test("B: a refused add (sold out, variant gone) shows the server's own text; the item is gone, nothing added twice", async () => {
  const { storage, map } = memoryStorage();
  rememberPendingCartAdd(storage, { productId: "p1", variantId: "v-gone", quantity: 1 });
  const server = poster({ ok: false, status: 422, error: "Seçilən variant artıq satışda deyil." });
  assert.deepEqual(await addRememberedCartItem({ storage, productId: "p1", viewerIsCustomer: true, post: server.post }), { kind: "failed", serverError: "Seçilən variant artıq satışda deyil." });
  assert.equal(map.has(PENDING_CART_ADD_KEY), false);
  assert.equal(await addRememberedCartItem({ storage, productId: "p1", viewerIsCustomer: true, post: server.post }), null);
  assert.equal(server.calls.length, 1);
  // The English 401 text is never shown.
  rememberPendingCartAdd(storage, { productId: "p1", quantity: 1 });
  assert.deepEqual(await addRememberedCartItem({ storage, productId: "p1", viewerIsCustomer: true, post: poster({ ok: false, status: 401, error: "Authentication required" }).post }), { kind: "failed", serverError: null });
  // The cart API itself refuses inside one transaction (nothing is written on an error).
  assert.match(read("app/api/cart/items/route.ts"), /if \(!current \|\| current\.quantity - current\.reserved < parsed\.data\.quantity\) throw new Error\("VARIANT_OUT_OF_STOCK"\);/);
});

test("B: storage errors are swallowed (private mode / blocked / quota)", async () => {
  assert.equal(rememberPendingCartAdd(memoryStorage({ setThrows: true }).storage, { productId: "p1", quantity: 1 }), false);
  assert.equal(rememberPendingCartAdd(null, { productId: "p1", quantity: 1 }), false);
  assert.equal(takePendingCartAdd(memoryStorage({ getThrows: true }).storage, "p1"), null);
  assert.equal(takePendingCartAdd(null, "p1"), null);
});

test("B: the product page remembers on 401 (no URL parameter), then adds once for the signed-in customer and shows T3 + Səbətə keç", () => {
  const source = read("components/product-variant-purchase.tsx");
  const onUnauthorized = source.slice(source.indexOf("if (response.status === 401) {"), source.indexOf('if (!response.ok) { setMessage(result.error || "Məhsulu'));
  assert.match(onUnauthorized, /rememberPendingCartAdd\(browserSessionStorage\(\), \{ productId, \.\.\.\(selectedVariant \? \{ variantId: selectedVariant\.id \} : \{\}\), quantity \}\);\n        router\.push\(`\/login\?next=\$\{encodeURIComponent\(pathname\)\}`\); return;/);
  assert.doesNotMatch(source, /addToCart=|pendingCart=|[?&](add|cart|item)=/, "no state-changing URL parameter");
  assert.match(source, /if \(!viewerIsCustomer \|\| pendingHandled\.current\) return;\n    pendingHandled\.current = true;/);
  assert.equal(source.match(/addRememberedCartItem\(/g)?.length, 1);
  assert.match(source, /if \(outcome\.kind === "added"\) \{ setMessage\(PENDING_CART_ADDED_MESSAGE\); router\.refresh\(\); return; \}/);
  assert.match(source, /\(message === ADDED_TO_CART_MESSAGE \|\| message === PENDING_CART_ADDED_MESSAGE\) && <> <Link href="\/cart" className="underline underline-offset-4">Səbətə keç<\/Link><\/>/);
  assert.match(read("lib/pending-cart-add.ts"), /window\.sessionStorage/);
  assert.doesNotMatch(read("lib/pending-cart-add.ts"), /localStorage/);
});

// ---------------------------------------------------------------- C + texts

test("C: T4 sits under the login form as plain text", () => {
  const form = read("components/login-form.tsx");
  assert.ok(form.indexOf(T4) > form.indexOf("</form>"));
  assert.match(form, new RegExp(`<p className="mt-4 text-center text-sm text-muted">${T4.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</p>`));
});

function sourceFiles() {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) files.push(relative(root, full).replace(/\\/g, "/"));
    }
  };
  for (const dir of ["app", "components", "lib"]) walk(resolve(root, dir));
  return files;
}

test("texts: T1–T4 each appear exactly once in the application code", () => {
  const all = sourceFiles().map(path => read(path)).join("\n");
  const count = (needle: string) => all.split(needle).length - 1;
  assert.equal(count(`\`${T1_START}\${email}${T1_END}\``), 1, "T1");
  assert.equal(count(T1_END), 1, "T1 tail");
  assert.equal(count(`"${T2}"`), 1, "T2");
  assert.equal(count(T3), 1, "T3");
  assert.equal(count(T4), 1, "T4");
  assert.match(read("components/register-form.tsx"), /\{googlePendingSignupText\(googlePendingEmail\)\}/);
  assert.match(read("components/register-form.tsx"), /\{GOOGLE_PENDING_SIGNUP_BUTTON\}<\/Button>/);
});

const BASE = "e5aba40"; // main before SIGNUP-EASY-2
const AZ = /[əğıöüşçƏĞİÖÜŞÇ«»]/;
/** Existing texts reused by SIGNUP-EASY-2 (each must exist somewhere in the base commit). */
const REUSED = [
  "Hesab yaradılır…",
  "və ya e-poçtla",
  "Bağlantı xətası. Məlumatlar saxlanılmadı; yenidən cəhd edin.",
  "Bağlantı xətası. Yenidən cəhd edin.",
  "Məhsulu səbətə əlavə etmək mümkün olmadı.",
  "Səbətə keç",
];

function baseFile(path: string) {
  try { return execFileSync("git", ["show", `${BASE}:${path}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).replace(/\r\n/g, "\n"); } catch { return ""; }
}

test("texts: no other new visible Azerbaijani text (scan of every changed application file against the base)", () => {
  const changed = ["app/(customer)/register/page.tsx", "app/(customer)/products/[productId]/page.tsx", "app/api/auth/google/callback/route.ts", "app/api/auth/google/complete-register/route.ts", "components/login-form.tsx", "components/product-variant-purchase.tsx", "components/register-form.tsx", "lib/auth-rate-limit.ts", "lib/google-complete-register.ts", "lib/google-customer-account.ts", "lib/google-pending-signup.ts", "lib/pending-cart-add.ts"];
  const baseAll = ["components/register-form.tsx", "components/google-oauth-button.tsx", "components/product-variant-purchase.tsx", "components/checkout-form.tsx", "components/login-form.tsx"].map(baseFile).join("\n");
  assert.ok(baseAll.length > 1000, "git show of the base commit works");
  for (const text of REUSED) assert.ok(baseAll.includes(text), `reused text exists before: ${text}`);
  // Text fragments = pieces between quotes, JSX brackets and braces that contain Azerbaijani letters.
  const fragments = (source: string) => new Set(source.split(/["'`<>{}]|\$\{/).map(part => part.trim()).filter(part => AZ.test(part)));
  for (const path of changed) {
    const before = fragments(baseFile(path));
    const added = [...fragments(read(path))].filter(fragment => !before.has(fragment));
    for (const fragment of added) {
      let rest = fragment;
      for (const text of [T1_START.trim(), T1_END, T2, T3, T4, ...REUSED]) rest = rest.split(text).join("");
      assert.doesNotMatch(rest, AZ, `${path}: new Azerbaijani text: ${fragment}`);
    }
  }
  for (const path of ["app/(customer)/terms/page.tsx", "app/(customer)/privacy/page.tsx", "app/(customer)/seller-terms/page.tsx"]) {
    const now = read(path);
    assert.ok(now.length > 0 && now === baseFile(path), `${path} unchanged`);
  }
});

test("the handler returns plain JSON responses (sanity for the client mapping)", async () => {
  const response = await handleCompleteGoogleRegister(post({ acceptTerms: true }), world().deps(undefined));
  assert.ok(response instanceof NextResponse);
  assert.equal(response.headers.get("content-type")?.startsWith("application/json"), true);
});
