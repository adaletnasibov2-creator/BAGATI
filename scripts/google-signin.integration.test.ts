/**
 * End-to-end Google sign-in rules against the isolated verification PostgreSQL cluster.
 *
 * Safety: uses ONLY BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL, and refuses unless the host is loopback,
 * the port is exactly 5433 and the database name contains "verify". It never reads DATABASE_URL and
 * never connects to 5432. Google is replaced by the loopback stand-in in scripts/fake-google-oidc.ts.
 * The test skips (with the reason) when the variable, the cluster or the schema is unavailable.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { startFakeGoogle, type FakeGoogle, type FakeGoogleIdentity, type FakeGoogleTamper } from "./fake-google-oidc";

const VERIFY_URL_ENV = "BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL";
const SESSION_SECRET = "bagati-isolated-google-signin-test-secret-32";
const CLIENT_ID = "bagati-test-client.apps.googleusercontent.invalid";
const CLIENT_SECRET = "bagati-test-client-value-not-a-real-credential";
const DIST_DIR = ".next-google-signin-verify";
const PASSWORD = "Isolated-Google-Signin-123!";

/** Returns the verify URL only if it passes the guard; otherwise a reason. Never returns or logs the URL text on failure. */
function guardedVerifyUrl(): { url: string } | { refuse: string } | { skip: string } {
  const raw = process.env[VERIFY_URL_ENV];
  if (!raw) return { skip: `${VERIFY_URL_ENV} is not set` };
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return { refuse: `${VERIFY_URL_ENV} is not a valid URL` }; }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) return { refuse: "verify database host must be loopback" };
  if (parsed.port !== "5433") return { refuse: "verify database port must be exactly 5433" };
  if (!database.includes("verify")) return { refuse: "verify database name must contain \"verify\"" };
  return { url: raw };
}

class Jar {
  private values = new Map<string, string>();
  header() { return [...this.values.entries()].map(([name, value]) => `${name}=${value}`).join("; "); }
  has(name: string) { return this.values.has(name); }
  absorb(response: Response) {
    for (const raw of response.headers.getSetCookie()) {
      const [pair, ...attributes] = raw.split(";").map((part) => part.trim());
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      const expired = value === "" || attributes.some((attribute) => /^max-age=0$/i.test(attribute) || /^expires=thu, 01 jan 1970/i.test(attribute));
      if (expired) this.values.delete(name);
      else this.values.set(name, value);
    }
  }
}

async function reservePort() {
  const socket = createServer();
  await new Promise<void>((done, reject) => { socket.once("error", reject); socket.listen(0, "127.0.0.1", () => done()); });
  const address = socket.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((done) => socket.close(() => done()));
  return address.port;
}

test("Google sign-in creates only customers, never sellers, and routes other roles to their portal", { timeout: 300_000 }, async (t) => {
  const guard = guardedVerifyUrl();
  if ("skip" in guard) return t.skip(`NOT VERIFIED: ${guard.skip}`);
  if ("refuse" in guard) throw new Error(`Refusing to run: ${guard.refuse}.`);

  const prisma = new PrismaClient({ datasources: { db: { url: guard.url } } });
  let server: ChildProcess | undefined;
  let fake: FakeGoogle | undefined;
  const originalNextEnv = await readFile(new URL("../next-env.d.ts", import.meta.url), "utf8").catch(() => "");
  const originalTsconfig = await readFile(new URL("../tsconfig.json", import.meta.url), "utf8");
  const tag = randomUUID().replace(/-/g, "").slice(0, 12).toLowerCase();
  const domain = `google-signin-${tag}.invalid`;
  const email = (local: string) => `${local}@${domain}`;

  try {
    let where: Array<{ db: string; port: number }>;
    try {
      where = await prisma.$queryRaw<Array<{ db: string; port: number }>>`SELECT current_database() AS db, inet_server_port() AS port`;
    } catch {
      return t.skip("NOT VERIFIED: verify database on 127.0.0.1:5433 is unreachable");
    }
    assert.ok(where[0]?.db.includes("verify"), "connected database name must contain \"verify\"");
    assert.equal(Number(where[0]?.port), 5433, "connected server port must be 5433");
    const tables = await prisma.$queryRaw<Array<{ ga: string | null; glt: string | null }>>`SELECT to_regclass('public."GoogleAccount"')::text AS ga, to_regclass('public."GoogleLinkTransaction"')::text AS glt`;
    if (!tables[0]?.ga || !tables[0]?.glt) return t.skip("NOT VERIFIED: verify database lacks the Google OAuth tables (migrations not applied)");

    const createUser = async (address: string, role: "CUSTOMER" | "VENDOR" | "ADMIN", isActive = true) => prisma.user.create({
      data: {
        email: address,
        passwordHash: await bcrypt.hash(PASSWORD, 10),
        role,
        isActive,
        emailVerifiedAt: new Date(),
        ...(role === "CUSTOMER" ? { customerProfile: { create: { firstName: "Signin", lastName: "Fixture" } }, cart: { create: {} } } : {}),
        ...(role === "VENDOR" ? { vendorProfile: { create: { displayName: "Signin Seller" } } } : {}),
      },
    });

    const port = await reservePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    fake = await startFakeGoogle({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: `${baseUrl}/api/auth/google/callback` });
    server = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(port)], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: guard.url,
        SESSION_SECRET,
        GOOGLE_CLIENT_ID: CLIENT_ID,
        GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
        BAGATI_ALLOW_OAUTH_TEST_ENDPOINTS: "1",
        BAGATI_GOOGLE_OAUTH_TEST_ISSUER: fake.issuer,
        BAGATI_NEXT_DIST_DIR: DIST_DIR,
        NEXT_TELEMETRY_DISABLED: "1",
        NODE_ENV: "development",
      },
      stdio: "ignore",
      windowsHide: true,
    });
    const deadline = Date.now() + 180_000;
    for (;;) {
      if (server.exitCode !== null) throw new Error("Temporary BAGATI server exited before becoming ready.");
      try {
        const response = await fetch(baseUrl, { redirect: "manual", signal: AbortSignal.timeout(5_000) });
        if (response.headers.get("x-bagati-application") === "bagati-marketplace") break;
      } catch { /* still compiling */ }
      if (Date.now() > deadline) throw new Error("BAGATI server identity was not confirmed before timeout.");
      await delay(500);
    }

    const get = (path: string, jar?: Jar) => fetch(new URL(path, baseUrl), { headers: jar?.header() ? { cookie: jar.header() } : {}, redirect: "manual", cache: "no-store" });
    const fakeGoogle = fake;
    async function google(input: { intent: "customer" | "vendor"; mode: "login" | "register"; identity: FakeGoogleIdentity; next?: string; tamper?: FakeGoogleTamper }) {
      const jar = new Jar();
      const query = new URLSearchParams({ intent: input.intent, mode: input.mode, ...(input.next ? { next: input.next } : {}) });
      const start = await get(`/api/auth/google/start?${query}`, jar);
      assert.equal(start.status, 307, `start ${query}`);
      jar.absorb(start);
      const authorization = new URL(start.headers.get("location") ?? "");
      assert.equal(authorization.origin, fakeGoogle.issuer);
      const code = fakeGoogle.issueCode({
        nonce: authorization.searchParams.get("nonce") ?? "",
        codeChallenge: authorization.searchParams.get("code_challenge") ?? "",
        identity: input.identity,
        tamper: input.tamper,
      });
      const callback = await get(`/api/auth/google/callback?${new URLSearchParams({ state: authorization.searchParams.get("state") ?? "", code })}`, jar);
      assert.equal(callback.status, 307);
      jar.absorb(callback);
      return { location: new URL(callback.headers.get("location") ?? "", baseUrl), jar };
    }
    const result = (location: URL) => ({ path: location.pathname, oauth: location.searchParams.get("oauth"), portal: location.searchParams.get("portal") });

    await t.test("new customer: first Google sign-in on the customer login page creates a verified CUSTOMER", async () => {
      const identity = { sub: `new-${tag}`, email: email("new"), givenName: "Yeni", familyName: "Musteri" };
      const { location, jar } = await google({ intent: "customer", mode: "login", identity, next: "/checkout" });
      assert.equal(location.pathname, "/checkout");
      const user = await prisma.user.findUniqueOrThrow({ where: { email: identity.email }, include: { googleAccount: true, customerProfile: true, vendorProfile: true } });
      assert.equal(user.role, "CUSTOMER");
      assert.ok(user.emailVerifiedAt);
      assert.equal(user.passwordAuthEnabled, false);
      assert.equal(user.googleAccount?.googleSub, identity.sub);
      assert.ok(user.customerProfile);
      assert.equal(user.vendorProfile, null);
      assert.equal((await get("/account", jar)).status, 200);
    });

    await t.test("returning customer is signed in without a second account", async () => {
      const identity = { sub: `new-${tag}`, email: email("new") };
      const { location, jar } = await google({ intent: "customer", mode: "register", identity });
      assert.equal(location.pathname, "/account");
      assert.equal(await prisma.user.count({ where: { email: identity.email } }), 1);
      assert.equal((await get("/account", jar)).status, 200);
    });

    await t.test("seller page without a seller account never creates one", async () => {
      const identity = { sub: `noseller-${tag}`, email: email("noseller") };
      const { location, jar } = await google({ intent: "vendor", mode: "login", identity });
      assert.deepEqual(result(location), { path: "/vendor/login", oauth: "seller-not-found", portal: null });
      assert.equal(await prisma.user.count({ where: { email: identity.email } }), 0);
      assert.equal(jar.has("bagati_session"), false);
    });

    await t.test("Google seller registration is refused at the start route", async () => {
      const start = await get("/api/auth/google/start?intent=vendor&mode=register");
      assert.equal(start.status, 307);
      const location = new URL(start.headers.get("location") ?? "", baseUrl);
      assert.deepEqual(result(location), { path: "/vendor/login", oauth: "invalid", portal: null });
      assert.equal(start.headers.getSetCookie().some((cookie) => cookie.startsWith("bagati_google_oauth=")), false);
    });

    await t.test("other-role email gets the correct portal and no password prompt", async () => {
      const seller = await createUser(email("seller"), "VENDOR");
      const onCustomerPage = await google({ intent: "customer", mode: "login", identity: { sub: `seller-${tag}`, email: seller.email } });
      assert.deepEqual(result(onCustomerPage.location), { path: "/login", oauth: "account-exists", portal: "vendor" });
      const customer = await createUser(email("customer"), "CUSTOMER");
      const onSellerPage = await google({ intent: "vendor", mode: "login", identity: { sub: `customer-${tag}`, email: customer.email } });
      assert.deepEqual(result(onSellerPage.location), { path: "/vendor/login", oauth: "account-exists", portal: "customer" });
      assert.equal(await prisma.googleLinkTransaction.count({ where: { userId: { in: [seller.id, customer.id] } } }), 0);
      assert.equal(await prisma.googleAccount.count({ where: { userId: { in: [seller.id, customer.id] } } }), 0);
    });

    await t.test("existing same-role password account links only after the password is confirmed", async () => {
      const customer = await createUser(email("linkme"), "CUSTOMER");
      const { location, jar } = await google({ intent: "customer", mode: "login", identity: { sub: `linkme-${tag}`, email: customer.email } });
      assert.equal(location.pathname, "/auth/google/link");
      assert.equal(jar.has("bagati_session"), false);
      assert.equal(await prisma.googleAccount.count({ where: { userId: customer.id } }), 0);
      const confirm = await fetch(new URL("/api/auth/google/link", baseUrl), { method: "POST", headers: { cookie: jar.header(), origin: baseUrl, "content-type": "application/json" }, body: JSON.stringify({ password: PASSWORD }), redirect: "manual" });
      assert.equal(confirm.status, 200);
      assert.equal((await prisma.googleAccount.findUniqueOrThrow({ where: { userId: customer.id } })).googleSub, `linkme-${tag}`);
    });

    await t.test("admin email is never signed in or linked through Google", async () => {
      const admin = await createUser(email("admin"), "ADMIN");
      for (const intent of ["customer", "vendor"] as const) {
        const { location, jar } = await google({ intent, mode: "login", identity: { sub: `admin-${intent}-${tag}`, email: admin.email } });
        assert.equal(result(location).oauth, "account-exists");
        assert.equal(result(location).portal, "admin");
        assert.equal(jar.has("bagati_session"), false);
      }
      assert.equal(await prisma.googleLinkTransaction.count({ where: { userId: admin.id } }), 0);
      assert.equal(await prisma.googleAccount.count({ where: { userId: admin.id } }), 0);
    });

    await t.test("inactive accounts get account-inactive, linked or matched by email", async () => {
      const inactive = await createUser(email("inactive"), "CUSTOMER", false);
      const byEmail = await google({ intent: "customer", mode: "login", identity: { sub: `inactive-${tag}`, email: inactive.email } });
      assert.equal(result(byEmail.location).oauth, "account-inactive");
      await prisma.googleAccount.create({ data: { googleSub: `inactive-linked-${tag}`, userId: inactive.id } });
      const linked = await google({ intent: "customer", mode: "login", identity: { sub: `inactive-linked-${tag}`, email: inactive.email } });
      assert.equal(result(linked.location).oauth, "account-inactive");
      assert.equal(linked.jar.has("bagati_session"), false);
    });

    await t.test("wrong role: a Google identity linked to a seller is sent to the seller portal", async () => {
      const seller = await createUser(email("linkedseller"), "VENDOR");
      await prisma.googleAccount.create({ data: { googleSub: `linkedseller-${tag}`, userId: seller.id } });
      const { location, jar } = await google({ intent: "customer", mode: "login", identity: { sub: `linkedseller-${tag}`, email: seller.email } });
      assert.deepEqual(result(location), { path: "/login", oauth: "wrong-role", portal: "vendor" });
      assert.equal(jar.has("bagati_session"), false);
      const asSeller = await google({ intent: "vendor", mode: "login", identity: { sub: `linkedseller-${tag}`, email: seller.email } });
      assert.equal(asSeller.location.pathname, "/vendor");
    });

    await t.test("unverified Google email creates nothing and gets its own message code", async () => {
      const identity = { sub: `unverified-${tag}`, email: email("unverified") };
      const { location, jar } = await google({ intent: "customer", mode: "register", identity, tamper: "unverified-email" });
      assert.deepEqual(result(location), { path: "/register", oauth: "email-unverified", portal: null });
      assert.equal(await prisma.user.count({ where: { email: identity.email } }), 0);
      assert.equal(jar.has("bagati_session"), false);
    });

    await t.test("no Google path created a seller", async () => {
      const created = await prisma.user.findMany({ where: { email: { endsWith: `@${domain}` }, passwordAuthEnabled: false }, select: { role: true } });
      assert.ok(created.length >= 1);
      assert.ok(created.every((user) => user.role === "CUSTOMER"));
    });
  } finally {
    if (server && server.exitCode === null) {
      server.kill();
      const stopBy = Date.now() + 10_000;
      while (server.exitCode === null && Date.now() < stopBy) await delay(100);
    }
    await fake?.close();
    try {
      const users = await prisma.user.findMany({ where: { email: { endsWith: `@${domain}` } }, select: { id: true } });
      const ids = users.map((user) => user.id);
      if (ids.length) {
        await prisma.googleLinkTransaction.deleteMany({ where: { userId: { in: ids } } });
        await prisma.googleAccount.deleteMany({ where: { userId: { in: ids } } });
        await prisma.user.deleteMany({ where: { id: { in: ids } } });
      }
      await prisma.emailOutbox.deleteMany({ where: { recipient: { endsWith: `@${domain}` } } });
    } catch { /* Unreachable database: nothing was written. */ }
    await prisma.$disconnect();
    await rm(resolve(DIST_DIR), { recursive: true, force: true });
    if (originalNextEnv) await writeFile(new URL("../next-env.d.ts", import.meta.url), originalNextEnv);
    await writeFile(new URL("../tsconfig.json", import.meta.url), originalTsconfig);
  }
});
