/**
 * SIGNUP-EASY-1: R2 (sign-in after the e-mail code), R4 (checkout prefill + profile phone), R5 (address form open),
 * R6 (cart link after add), R7 (Google rate-limit code). Unit tests only: an in-memory stand-in replaces the database;
 * the code hashing, context tokens and redirect sanitizing are the real functions.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { handleVerifyEmail } from "../lib/email-verification-route";
import { createEmailVerificationContext, EMAIL_CODE_MAX_ATTEMPTS, hashVerificationCode, verifyEmailVerificationContextToken } from "../lib/email-verification";
import { verifiedCustomerSignIn } from "../lib/verify-email-sign-in";
import { addressFormOpenInitially, defaultCheckoutCityId } from "../lib/checkout-prefill";
import { rememberProfilePhoneIfEmpty } from "../lib/profile-phone";
import { googleOAuthMessage } from "../components/google-oauth-button";

// The secret is read when the functions run (not at import), so setting it here is enough.
process.env.SESSION_SECRET ??= "signup-easy-1-unit-test-secret-0123456789abcdef";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");

// ---------------------------------------------------------------- in-memory world for POST /api/auth/verify-email

type Role = "CUSTOMER" | "VENDOR" | "ADMIN";
function world(options: { role?: Role; code?: string; attempts?: number; expiresInMs?: number; alreadyVerified?: boolean; deleteFails?: boolean; sessionThrows?: boolean; context?: "none" | Role } = {}) {
  const role = options.role ?? "CUSTOMER";
  const user = { id: "u1", email: "new@example.test", role, isActive: true, emailVerifiedAt: options.alreadyVerified ? new Date() : null as Date | null, customerProfile: { firstName: "Ayan", lastName: "Q" }, vendorProfile: role === "VENDOR" ? { displayName: "Satıcı" } : null };
  let verification: { userId: string; codeHash: string; expiresAt: Date; attempts: number } | null = { userId: "u1", codeHash: hashVerificationCode(options.code ?? "123456"), expiresAt: new Date(Date.now() + (options.expiresInMs ?? 600_000)), attempts: options.attempts ?? 0 };
  const sessions: string[] = [];
  const mails: string[] = [];
  let cleared = 0;
  const matches = (where: { codeHash?: string; expiresAt?: { gt: Date }; attempts?: { lt: number } }) => Boolean(verification
    && (where.codeHash === undefined || where.codeHash === verification.codeHash)
    && (!where.expiresAt || verification.expiresAt > where.expiresAt.gt)
    && (!where.attempts || verification.attempts < where.attempts.lt));
  const db = {
    user: {
      findFirst: async ({ where }: { where: { id: string; role: Role; isActive: boolean; emailVerifiedAt: null } }) =>
        where.id === user.id && where.role === user.role && user.isActive && user.emailVerifiedAt === null ? { id: user.id } : null,
      updateMany: async ({ where, data }: { where: { role: Role }; data: { emailVerifiedAt: Date } }) => {
        if (where.role !== user.role || user.emailVerifiedAt !== null) return { count: 0 };
        user.emailVerifiedAt = data.emailVerifiedAt; return { count: 1 };
      },
      findUnique: async () => ({ ...user }),
    },
    emailVerification: {
      findUnique: async () => (verification ? { ...verification } : null),
      updateMany: async ({ where }: { where: Parameters<typeof matches>[0] }) => { if (!matches(where)) return { count: 0 }; verification!.attempts += 1; return { count: 1 }; },
      deleteMany: async ({ where }: { where: Parameters<typeof matches>[0] }) => { if (options.deleteFails || !matches(where)) return { count: 0 }; verification = null; return { count: 1 }; },
    },
    emailOutbox: { updateMany: async () => ({ count: 0 }) },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(db),
  };
  const contextRole = options.context ?? role;
  const deps = {
    db,
    readContext: async () => (contextRole === "none" ? null : { userId: "u1", role: contextRole }),
    clearContext: async () => { cleared += 1; },
    createSession: async (userId: string) => { if (options.sessionThrows) throw new Error("db down"); sessions.push(userId); return { name: "bagati_session", value: `session-for-${userId}`, httpOnly: true, path: "/" }; },
    enqueueEmail: async (_tx: unknown, input: { template: string }) => { mails.push(input.template); },
  };
  return { deps: deps as never, user, sessions, mails, get verification() { return verification; }, get cleared() { return cleared; } };
}
const post = (body: unknown) => new Request("http://localhost/api/auth/verify-email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
async function run(w: ReturnType<typeof world>, body: unknown) {
  const response = await handleVerifyEmail(post(body), w.deps);
  return { status: response.status, json: await response.json(), cookie: response.cookies.get("bagati_session")?.value ?? null };
}

// ---------------------------------------------------------------- R2

test("R2: a correct code signs a CUSTOMER in and returns the sanitized destination", async () => {
  const w = world();
  const result = await run(w, { code: "123456", next: "/checkout" });
  assert.equal(result.status, 200);
  assert.deepEqual({ signedIn: result.json.signedIn, redirectTo: result.json.redirectTo }, { signedIn: true, redirectTo: "/checkout" });
  assert.equal(result.cookie, "session-for-u1");
  assert.deepEqual(w.sessions, ["u1"]);
  assert.ok(w.user.emailVerifiedAt, "verified first");
  assert.equal(w.verification, null, "code consumed");
  assert.deepEqual(w.mails, ["WELCOME_CUSTOMER"]);
  assert.equal(w.cleared, 1, "verification context cookie cleared");
});

test("R2: the destination is sanitized on the server (no other site, no /admin, no seller pages)", async () => {
  for (const [next, expected] of [
    [undefined, "/account"], ["//evil.example", "/account"], ["/\\evil.example", "/account"], ["https://evil.example/x", "/account"],
    ["/admin/security-center", "/account"], ["/vendor/products", "/account"], ["/vendor/apply", "/vendor/apply"], ["/products/abc?x=1", "/products/abc?x=1"],
  ] as const) {
    const result = await run(world(), next === undefined ? { code: "123456" } : { code: "123456", next });
    assert.equal(result.json.redirectTo, expected, String(next));
  }
});

test("R2: a wrong code gives no session (attempt counted, account not verified)", async () => {
  const w = world();
  const result = await run(w, { code: "654321", next: "/checkout" });
  assert.equal(result.status, 400);
  assert.equal(result.cookie, null);
  assert.deepEqual(w.sessions, []);
  assert.equal(w.verification?.attempts, 1);
  assert.equal(w.user.emailVerifiedAt, null);
  assert.equal(result.json.signedIn, undefined);
});

test("R2: an expired code gives no session, even when it is the right code", async () => {
  const w = world({ expiresInMs: -1_000 });
  const result = await run(w, { code: "123456" });
  assert.equal(result.status, 400);
  assert.deepEqual(w.sessions, []);
  assert.equal(w.user.emailVerifiedAt, null);
});

test("R2: a locked code (attempt limit reached) gives no session, even when it is the right code", async () => {
  const w = world({ attempts: EMAIL_CODE_MAX_ATTEMPTS });
  const result = await run(w, { code: "123456" });
  assert.equal(result.status, 400);
  assert.deepEqual(w.sessions, []);
  // Guessing: 5 wrong codes lock it; the 6th (correct) try is refused too. The limit is unchanged.
  const g = world();
  for (let i = 0; i < EMAIL_CODE_MAX_ATTEMPTS; i++) assert.equal((await run(g, { code: String(100000 + i) })).status, 400);
  assert.equal(g.verification?.attempts, EMAIL_CODE_MAX_ATTEMPTS);
  assert.equal((await run(g, { code: "123456" })).status, 400);
  assert.deepEqual(g.sessions, []);
});

test("R2: no session without a valid context cookie, for a malformed code, an already verified account, or a lost race", async () => {
  const noContext = world({ context: "none" });
  assert.equal((await run(noContext, { code: "123456" })).status, 401);
  const malformed = world();
  assert.equal((await run(malformed, { code: "12345" })).status, 400);
  assert.equal(malformed.verification?.attempts, 1, "malformed input is still counted");
  const alreadyVerified = world({ alreadyVerified: true });
  assert.equal((await run(alreadyVerified, { code: "123456" })).status, 400);
  const race = world({ deleteFails: true });
  assert.equal((await run(race, { code: "123456" })).status, 400, "the code was consumed by a parallel request");
  for (const w of [noContext, malformed, alreadyVerified, race]) assert.deepEqual(w.sessions, []);
});

test("R2: the seller flow is unchanged (no session, no redirect target; the form goes to /vendor/login)", async () => {
  const w = world({ role: "VENDOR" });
  const result = await run(w, { code: "123456", next: "/vendor" });
  assert.equal(result.status, 200);
  assert.equal(result.json.verified, true);
  assert.equal(result.json.signedIn, undefined);
  assert.equal(result.json.redirectTo, undefined);
  assert.equal(result.cookie, null);
  assert.deepEqual(w.sessions, []);
  assert.deepEqual(w.mails, ["WELCOME_SELLER"]);
  assert.ok(w.user.emailVerifiedAt);
  assert.deepEqual(verifiedCustomerSignIn("VENDOR", "/vendor"), { signIn: false, redirectTo: null });
});

test("R2: an ADMIN never gets a session here", async () => {
  // 1. The context cookie can never carry ADMIN: the real token check rejects it.
  const adminToken = await createEmailVerificationContext("a1", "ADMIN" as never);
  assert.equal(await verifyEmailVerificationContextToken(adminToken), null);
  assert.deepEqual(await verifyEmailVerificationContextToken(await createEmailVerificationContext("c1", "CUSTOMER" as never)), { userId: "c1", role: "CUSTOMER" });
  // 2. Even if an ADMIN context reached the handler, the sign-in rule refuses it.
  assert.deepEqual(verifiedCustomerSignIn("ADMIN", "/admin"), { signIn: false, redirectTo: null });
  const w = world({ role: "ADMIN" });
  const result = await run(w, { code: "123456" });
  assert.deepEqual(w.sessions, []);
  assert.equal(result.cookie, null);
});

test("R2: if the session cannot be created, verification still succeeds and the old flow (login) is used", async () => {
  const w = world({ sessionThrows: true });
  const result = await run(w, { code: "123456" });
  assert.equal(result.status, 200);
  assert.equal(result.json.verified, true);
  assert.equal(result.json.signedIn, undefined);
  assert.equal(result.cookie, null);
});

test("R2: the session is created only after every check and the committed transaction (source order)", () => {
  const lib = read("lib/email-verification-route.ts");
  const order = ["const context = await deps.readContext();", "emailCodeCanBeAttempted(", "compareVerificationCode(", "verified = await db.$transaction(", 'if (!verified) return NextResponse.json({ error: safeError }, { status: 400 });', "deps.createSession(user.id)"];
  let last = -1;
  for (const needle of order) { const at = lib.indexOf(needle); assert.ok(at > last, needle); last = at; }
  assert.equal(lib.split("deps.createSession(").length - 1, 1, "one call site");
  const route = read("app/api/auth/verify-email/route.ts");
  assert.match(route, /return handleVerifyEmail\(request, \{\n\s+db: prisma,\n\s+readContext: readEmailVerificationContext,\n\s+clearContext: clearEmailVerificationContext,\n\s+createSession,\n\s+enqueueEmail,\n\s+\}\);/);
});

test("R2: the form sends next only for customers, follows only a safe server destination, and keeps the seller path", () => {
  const form = read("components/email-verification-form.tsx");
  assert.match(form, /body: JSON\.stringify\(role === "CUSTOMER" \? \{ code, next: nextPath \} : \{ code \}\),/);
  assert.match(form, /if \(data\.signedIn === true && typeof data\.redirectTo === "string" && data\.redirectTo\.startsWith\("\/"\) && !data\.redirectTo\.startsWith\("\/\/"\) && !data\.redirectTo\.includes\("\\\\"\)\) \{/);
  assert.match(form, /window\.location\.replace\(`\$\{loginPath\}\$\{loginPath\.includes\("\?"\) \? "&" : "\?"\}verified=1`\);/, "fallback unchanged");
  assert.match(form, /const loginPath = role === "VENDOR" \? "\/vendor\/login" : `\/login\?next=\$\{encodeURIComponent\(nextPath\)\}`;/);
  assert.match(read("app/(customer)/verify-email/page.tsx"), /const nextPath = safeOAuthNextPath\(params\.next, "customer"\);/);
});

// ---------------------------------------------------------------- R4 / R5

test("R4: default city = default address's city, else Bakı, else the first city", () => {
  const cities = [{ id: "c-gence", name: "Gəncə" }, { id: "c-baku", name: "Bakı" }, { id: "c-sumqayit", name: "Sumqayıt" }];
  assert.equal(defaultCheckoutCityId([{ cityId: "c-sumqayit", isDefault: true }, { cityId: "c-gence", isDefault: false }], cities), "c-sumqayit");
  assert.equal(defaultCheckoutCityId([], cities), "c-baku");
  assert.equal(defaultCheckoutCityId([{ cityId: "c-closed", isDefault: true }], cities), "c-baku", "inactive city of the default address is skipped");
  assert.equal(defaultCheckoutCityId([{ cityId: "c-gence", isDefault: false }], cities), "c-baku", "no default address: Bakı");
  assert.equal(defaultCheckoutCityId([], [{ id: "x", name: "Gəncə" }, { id: "y", name: "Şəki" }]), "x", "no Bakı: first city");
  assert.equal(defaultCheckoutCityId([], [{ id: "b", name: " BAKI " }]), "b", "Azerbaijani upper-case I is matched");
  assert.equal(defaultCheckoutCityId([], []), "");
});

test("R5: the address form opens by itself only when there is no saved address", () => {
  assert.equal(addressFormOpenInitially([]), true);
  assert.equal(addressFormOpenInitially([{}]), false);
  const form = read("components/checkout-form.tsx");
  assert.match(form, /\[adding,setAdding\]=useState\(\(\)=>addressFormOpenInitially\(initialAddresses\)\)/);
  assert.match(form, /\[cityId,setCityId\]=useState\(\(\)=>defaultCheckoutCityId\(initialAddresses,cities\)\)/);
  assert.match(form, /\[phone,setPhone\]=useState\(customerPhone\)/);
  assert.match(form, /longitude:location\?\.longitude\?\?null,rememberPhone:true\}\)/);
  assert.match(read("app/(customer)/checkout/page.tsx"), /customerName=\{name\} customerPhone=\{profile\?\.phone \?\? ""\} email=\{user\.email\}/);
});

function profileDb(initial: { phone: string | null } | null, createFailsWith?: string) {
  let profile = initial ? { ...initial } : null;
  const calls: string[] = [];
  const db = {
    customerProfile: {
      updateMany: async ({ where, data }: { where: { OR: Array<{ phone: null | string }> }; data: { phone: string } }) => {
        calls.push("updateMany");
        const empty = profile && where.OR.some((cond) => cond.phone === profile!.phone);
        if (!empty) return { count: 0 };
        profile!.phone = data.phone; return { count: 1 };
      },
      findUnique: async () => { calls.push("findUnique"); return profile ? { id: "p1" } : null; },
      create: async ({ data }: { data: { phone: string } }) => {
        calls.push("create");
        if (createFailsWith) throw new Prisma.PrismaClientKnownRequestError("unique", { code: createFailsWith, clientVersion: "test" });
        profile = { phone: data.phone }; return { id: "p1" };
      },
    },
  };
  return { db: db as never, get profile() { return profile; }, calls };
}

test("R4: the address phone fills an EMPTY profile phone and never overwrites an existing one", async () => {
  const empty = profileDb({ phone: null });
  assert.equal(await rememberProfilePhoneIfEmpty(empty.db, "u1", " 050 123 45 67 "), "saved");
  assert.equal(empty.profile?.phone, "050 123 45 67");
  const blank = profileDb({ phone: "" });
  assert.equal(await rememberProfilePhoneIfEmpty(blank.db, "u1", "0501234567"), "saved");
  const existing = profileDb({ phone: "0559999999" });
  assert.equal(await rememberProfilePhoneIfEmpty(existing.db, "u1", "0501234567"), "kept");
  assert.equal(existing.profile?.phone, "0559999999", "never overwritten");
  assert.ok(!existing.calls.includes("create"));
  const none = profileDb(null);
  assert.equal(await rememberProfilePhoneIfEmpty(none.db, "u1", "0501234567"), "created");
  assert.equal(none.profile?.phone, "0501234567");
  const raced = profileDb(null, "P2002");
  assert.equal(await rememberProfilePhoneIfEmpty(raced.db, "u1", "0501234567"), "kept", "a profile created meanwhile is left alone");
  assert.equal(await rememberProfilePhoneIfEmpty(profileDb({ phone: null }).db, "u1", "   "), "kept", "blank phone is ignored");
});

test("R4: the address API saves the address first and remembers the phone only on request, best-effort", () => {
  const route = read("app/api/account/addresses/route.ts");
  assert.match(route, /isDefault: z\.boolean\(\)\.optional\(\), rememberPhone: z\.boolean\(\)\.optional\(\) \}\);/);
  assert.match(route, /const \{ rememberPhone, \.\.\.address \} = parsed\.data;/);
  assert.match(route, /tx\.address\.create\(\{ data: \{ \.\.\.address, userId: user\.id, isDefault: makeDefault \} \}\)/, "the flag never reaches the Address row");
  const save = route.indexOf("await prisma.$transaction("), remember = route.indexOf("rememberProfilePhoneIfEmpty(prisma, user.id, address.phone)");
  assert.ok(save > 0 && remember > save, "after the address transaction");
  assert.match(route, /if \(rememberPhone\) \{\n\s+try \{ await rememberProfilePhoneIfEmpty\(prisma, user\.id, address\.phone\); \}\n\s+catch \(error\)/);
  assert.match(read("lib/profile-phone.ts"), /where: \{ userId, OR: \[\{ phone: null \}, \{ phone: "" \}\] \}/);
});

// ---------------------------------------------------------------- R6

test("R6: after a successful add the status line links to the cart with the existing words 'Səbətə keç'", () => {
  const source = read("components/product-variant-purchase.tsx");
  assert.match(source, /const ADDED_TO_CART_MESSAGE = "Məhsul səbətə əlavə edildi\.";/);
  assert.match(source, /setMessage\(ADDED_TO_CART_MESSAGE\); router\.refresh\(\);/);
  // SIGNUP-EASY-2 adds T3 (PENDING_CART_ADDED_MESSAGE) to the same link condition.
  assert.match(source, /\{\(message === ADDED_TO_CART_MESSAGE \|\| message === PENDING_CART_ADDED_MESSAGE\) && <> <Link href="\/cart" className="underline underline-offset-4">Səbətə keç<\/Link><\/>\}/);
  assert.match(read("components/checkout-form.tsx"), />Səbətə keç<\/Link>/, "the same words are already used in checkout");
});

// ---------------------------------------------------------------- R7

test("R7: Google rate limits use their own code with the existing rate-limit text; 'unavailable' stays for configuration", () => {
  const existing = "Çox sayda cəhd edildi. Bir müddət sonra yenidən yoxlayın.";
  assert.equal(googleOAuthMessage("rate-limited"), existing);
  assert.match(read("app/api/auth/reset-password/route.ts"), new RegExp(existing.replace(/\./g, "\\.")), "text already existed");
  assert.equal(googleOAuthMessage("unavailable"), "Google girişi serverdə konfiqurasiya edilməyib.");
  const start = read("app/api/auth/google/start/route.ts");
  assert.match(start, /if \(!consumeAuthProcessRateLimit\("google-oauth-start", 600, 60_000\)\) \{\n\s+return NextResponse\.redirect\(new URL\(`\$\{formPath\(intent, mode\)\}\?oauth=rate-limited`, origin\)\);/);
  assert.match(start, /if \(!allowed\) return NextResponse\.redirect\(new URL\(`\$\{formPath\(intent, mode\)\}\?oauth=rate-limited`, origin\)\);/);
  assert.match(read("app/api/auth/google/callback/route.ts"), /if \(!allowed\) return finish\(NextResponse\.redirect\(resultUrl\(origin, state, "rate-limited"\)\)\);/);
});
