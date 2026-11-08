import "dotenv/config";
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

const TEST_DATABASE_NAME = "bagati_auth_test";
const TEST_SESSION_SECRET = "bagati-isolated-google-link-test-secret-32";
const DIST_DIR = ".next-google-link-verify";
const configuredUrl = process.env.DATABASE_URL;
if (!configuredUrl) throw new Error("DATABASE_URL is missing; refusing integration test setup.");
const parsedConfiguredUrl = new URL(configuredUrl);
if (parsedConfiguredUrl.hostname !== "localhost" || parsedConfiguredUrl.port !== "5432" || parsedConfiguredUrl.pathname !== "/bagati") {
  throw new Error("Integration tests require the expected local BAGATI database configuration; refusing to write.");
}
const testUrl = new URL(parsedConfiguredUrl);
testUrl.pathname = `/${TEST_DATABASE_NAME}`;
process.env.DATABASE_URL = testUrl.toString();
process.env.SESSION_SECRET = TEST_SESSION_SECRET;
const prisma = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });

const password = "Isolated-Google-Link-123!";
const userIds: string[] = [];
let server: ChildProcess | undefined;
let baseUrl = "";
let originalNextEnv = "";
let originalTsconfig = "";

class Jar {
  private values = new Map<string, string>();
  header() { return [...this.values.entries()].map(([name, value]) => `${name}=${value}`).join("; "); }
  seed(name: string, value: string) { this.values.set(name, value); }
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

async function request(path: string, init: RequestInit = {}, jar?: Jar) {
  const headers = new Headers(init.headers);
  const cookie = jar?.header();
  if (cookie) headers.set("cookie", cookie);
  if (init.method && init.method !== "GET" && init.method !== "HEAD" && !headers.has("origin")) headers.set("origin", baseUrl);
  return fetch(new URL(path, baseUrl), { ...init, headers, cache: "no-store", redirect: "manual" });
}

async function reservePort() {
  const socket = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const address = socket.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((done) => socket.close(() => done()));
  return address.port;
}

async function startServer() {
  const port = await reservePort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testUrl.toString(), SESSION_SECRET: TEST_SESSION_SECRET, BAGATI_NEXT_DIST_DIR: DIST_DIR, NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "development" },
    stdio: "ignore",
    windowsHide: true,
  });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error("Temporary BAGATI server exited before becoming ready.");
    try {
      const response = await fetch(baseUrl, { redirect: "manual", signal: AbortSignal.timeout(3_000) });
      if (response.status === 200 && response.headers.get("x-bagati-application") === "bagati-marketplace") return;
    } catch { /* The development server is still compiling. */ }
    await delay(500);
  }
  throw new Error("Known BAGATI server identity was not confirmed before timeout.");
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill();
  const deadline = Date.now() + 10_000;
  while (server.exitCode === null && Date.now() < deadline) await delay(100);
}

async function createUser(email: string, role: "CUSTOMER" | "VENDOR" | "ADMIN") {
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role,
      isActive: true,
      emailVerifiedAt: new Date(),
      ...(role === "CUSTOMER" ? { customerProfile: { create: { firstName: "Link", lastName: "Fixture" } }, cart: { create: {} } } : {}),
      ...(role === "VENDOR" ? { vendorProfile: { create: { displayName: "Link Seller", sellerType: "REGISTERED_COMPANY", legalName: "Link Seller", voen: `T${email.slice(0, 8)}`, legalAddress: "Test legal address" } } } : {}),
    },
  });
  userIds.push(user.id);
  return user;
}

test("secure Google linking requires the existing account password and rejects replay", { timeout: 240_000 }, async () => {
  originalNextEnv = await readFile(new URL("../next-env.d.ts", import.meta.url), "utf8");
  originalTsconfig = await readFile(new URL("../tsconfig.json", import.meta.url), "utf8");
  assert.equal(testUrl.pathname, `/${TEST_DATABASE_NAME}`);
  const identity = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(identity[0]?.name, TEST_DATABASE_NAME, "refusing to write outside the dedicated test database");
  const [googleLink, existingAccount] = await Promise.all([
    import("../lib/google-link"),
    import("../lib/existing-account"),
  ]);
  const table = await prisma.$queryRaw<Array<{ name: string | null }>>`SELECT to_regclass('public."GoogleLinkTransaction"')::text AS name`;
  if (!table[0]?.name) {
    const migration = await readFile(new URL("../prisma/migrations/20261104010000_google_link_transaction/migration.sql", import.meta.url), "utf8");
    for (const statement of migration.split(";").map((part) => part.trim()).filter(Boolean)) {
      await prisma.$executeRawUnsafe(statement);
    }
  }

  const tag = randomUUID().replace(/-/g, "").slice(0, 12).toLowerCase();
  try {
    const customer = await createUser(`link-customer-${tag}@auth-test.invalid`, "CUSTOMER");
    const other = await createUser(`link-other-${tag}@auth-test.invalid`, "CUSTOMER");
    const seller = await createUser(`link-seller-${tag}@auth-test.invalid`, "VENDOR");
    const admin = await createUser(`link-admin-${tag}@auth-test.invalid`, "ADMIN");
    assert.equal((await existingAccount.existingAccountIdentity(admin.email)).kind, "one");
    assert.equal(googleLink.isGoogleLinkableRole("ADMIN"), false);
    assert.equal(googleLink.isGoogleLinkableRole("CUSTOMER"), true);
    assert.equal(googleLink.isGoogleLinkableRole("VENDOR"), true);

    const upperEmail = `Link-Case-${tag}@auth-test.invalid`;
    const lowerEmail = upperEmail.toLowerCase();
    let ambiguous = false;
    try {
      await createUser(upperEmail, "CUSTOMER");
      await createUser(lowerEmail, "CUSTOMER");
      ambiguous = true;
    } catch {
      ambiguous = false;
    }
    if (ambiguous) assert.equal((await existingAccount.existingAccountIdentity(upperEmail)).kind, "ambiguous");

    const expiredToken = await googleLink.createGoogleLinkTransaction({ userId: other.id, googleSub: `expired-${tag}`, email: other.email });
    await prisma.googleLinkTransaction.updateMany({ where: { userId: other.id, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal(await googleLink.consumeGoogleLink(expiredToken, other), "expired");
    assert.equal(await prisma.googleAccount.count({ where: { userId: other.id } }), 0);

    const otherToken = await googleLink.createGoogleLinkTransaction({ userId: other.id, googleSub: `other-${tag}`, email: other.email });
    assert.equal(await googleLink.consumeGoogleLink(otherToken, { id: seller.id, email: seller.email, role: "VENDOR" }), "mismatch");
    assert.equal(await prisma.googleAccount.count({ where: { userId: seller.id } }), 0);
    assert.equal(await googleLink.consumeGoogleLink(otherToken, other), "linked");
    assert.equal((await prisma.googleAccount.findUniqueOrThrow({ where: { userId: other.id } })).googleSub, `other-${tag}`);
    assert.equal(await googleLink.consumeGoogleLink(otherToken, other), "reused");
    assert.equal(await googleLink.unlinkGoogleAccount(other.id), "unlinked");
    assert.equal(await prisma.googleAccount.count({ where: { userId: other.id } }), 0);
    await prisma.user.update({ where: { id: other.id }, data: { passwordAuthEnabled: false } });
    await prisma.googleAccount.create({ data: { googleSub: `locked-${tag}`, userId: other.id } });
    assert.equal(await googleLink.unlinkGoogleAccount(other.id), "password-required");
    assert.equal(await prisma.googleAccount.count({ where: { userId: other.id } }), 1);
    await prisma.user.update({ where: { id: other.id }, data: { passwordAuthEnabled: true } });

    const customerSub = `customer-${tag}`;
    const conflictToken = await googleLink.createGoogleLinkTransaction({ userId: seller.id, googleSub: customerSub, email: seller.email });
    await prisma.googleAccount.create({ data: { googleSub: customerSub, userId: customer.id } });
    assert.equal(await googleLink.consumeGoogleLink(conflictToken, seller), "conflict");
    assert.equal(await prisma.googleAccount.count({ where: { userId: seller.id } }), 0);
    assert.equal((await prisma.googleAccount.findUniqueOrThrow({ where: { userId: customer.id } })).googleSub, customerSub);
    await prisma.googleAccount.deleteMany({ where: { userId: customer.id } });

    await startServer();
    const plain = await request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: customer.email, password }) });
    assert.equal(plain.status, 200);
    const plainBody = await plain.json() as { googleLink?: string };
    assert.equal(plainBody.googleLink, undefined);
    const plainJar = new Jar();
    plainJar.absorb(plain);
    const logout = await request("/api/auth/logout", { method: "POST" }, plainJar);
    assert.equal(logout.status, 200);
    plainJar.absorb(logout);
    assert.equal((await request("/api/account/profile", {}, plainJar)).status, 401);

    const pending = await googleLink.createGoogleLinkTransaction({ userId: customer.id, googleSub: customerSub, email: customer.email });
    const wrongJar = new Jar();
    wrongJar.seed("bagati_google_link", pending);
    const wrong = await request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: customer.email, password: "wrong-password-123456" }) }, wrongJar);
    assert.equal(wrong.status, 401);
    assert.equal(await prisma.googleAccount.count({ where: { userId: customer.id } }), 0);
    assert.equal(await prisma.googleLinkTransaction.count({ where: { userId: customer.id, usedAt: null } }), 1);

    const jar = new Jar();
    jar.seed("bagati_google_link", pending);
    const linked = await request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: customer.email, password }) }, jar);
    const linkedBody = await linked.json() as { googleLink?: string };
    assert.equal(linked.status, 200, JSON.stringify(linkedBody));
    assert.equal(linkedBody.googleLink, "linked");
    assert.equal((await prisma.googleAccount.findUniqueOrThrow({ where: { googleSub: customerSub } })).userId, customer.id);
    assert.match(linked.headers.getSetCookie().find((cookie) => cookie.startsWith("bagati_google_link=")) ?? "", /Max-Age=0/);
    jar.absorb(linked);
    const session = jar.header();
    assert.match(session, /bagati_session=/);
    const stale = new Jar();
    stale.seed("bagati_session", session.split("bagati_session=")[1]?.split(";")[0] ?? "");
    const customerLogout = await request("/api/auth/logout", { method: "POST" }, jar);
    assert.equal(customerLogout.status, 200);
    assert.equal((await request("/api/account/profile", {}, stale)).status, 401);

    const sellerSub = `seller-${tag}`;
    const sellerToken = await googleLink.createGoogleLinkTransaction({ userId: seller.id, googleSub: sellerSub, email: seller.email });
    const sellerJar = new Jar();
    sellerJar.seed("bagati_google_link", sellerToken);
    const sellerLogin = await request("/api/auth/vendor-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: seller.email, password }) }, sellerJar);
    const sellerBody = await sellerLogin.json() as { googleLink?: string };
    assert.equal(sellerLogin.status, 200, JSON.stringify(sellerBody));
    assert.equal(sellerBody.googleLink, "linked");
    assert.equal((await prisma.googleAccount.findUniqueOrThrow({ where: { googleSub: sellerSub } })).userId, seller.id);
    sellerJar.absorb(sellerLogin);
    assert.equal((await request("/vendor", {}, sellerJar)).status, 200);
    assert.notEqual((await request("/admin", {}, sellerJar)).status, 200);

    const pendingLogin = await request("/login?oauth=link-pending");
    assert.equal(pendingLogin.status, 307);
    assert.match(pendingLogin.headers.get("location") || "", /\/auth\/google\/link$/);

    const confirm = await createUser(`link-confirm-${tag}@auth-test.invalid`, "CUSTOMER");
    const confirmToken = await googleLink.createGoogleLinkTransaction({ userId: confirm.id, googleSub: `confirm-${tag}`, email: confirm.email });
    const confirmJar = new Jar();
    confirmJar.seed("bagati_google_link", confirmToken);
    confirmJar.seed("bagati_google_link_next", "/admin");
    const page = await request("/auth/google/link", {}, confirmJar);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Google hesabını təsdiqləyin/);
    assert.equal(html.includes(confirm.id), false);
    assert.equal(html.includes(confirmToken), false);
    const preview = await request("/api/auth/google/link", {}, confirmJar);
    const previewBody = await preview.json() as { status?: string; emailHint?: string };
    assert.equal(preview.status, 200);
    assert.equal(previewBody.status, "ready");
    assert.match(previewBody.emailHint || "", /@auth-test\.invalid$/);
    assert.equal(JSON.stringify(previewBody).includes(confirm.id), false);
    assert.equal(JSON.stringify(previewBody).includes(confirmToken), false);
    const wrongConfirm = await request("/api/auth/google/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "wrong-password-123456" }) }, confirmJar);
    assert.equal(wrongConfirm.status, 401);
    assert.equal(await prisma.googleAccount.count({ where: { userId: confirm.id } }), 0);
    const confirmed = await request("/api/auth/google/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) }, confirmJar);
    const confirmedBody = await confirmed.json() as { redirect?: string };
    assert.equal(confirmed.status, 200, JSON.stringify(confirmedBody));
    assert.equal(confirmedBody.redirect, "/account");
    confirmJar.absorb(confirmed);
    assert.equal(confirmJar.header().includes("bagati_google_link="), false);
    assert.equal((await request("/account", {}, confirmJar)).status, 200);
    assert.notEqual((await request("/vendor", {}, confirmJar)).status, 200);
    const replayJar = new Jar();
    replayJar.seed("bagati_google_link", confirmToken);
    const replay = await request("/api/auth/google/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) }, replayJar);
    assert.equal(replay.status, 409);
    const expiredUser = await createUser(`link-stale-${tag}@auth-test.invalid`, "CUSTOMER");
    const staleToken = await googleLink.createGoogleLinkTransaction({ userId: expiredUser.id, googleSub: `stale-${tag}`, email: expiredUser.email });
    await prisma.googleLinkTransaction.updateMany({ where: { userId: expiredUser.id, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expiredJar = new Jar();
    expiredJar.seed("bagati_google_link", staleToken);
    assert.equal((await request("/api/auth/google/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) }, expiredJar)).status, 410);
    assert.equal(await prisma.googleAccount.count({ where: { userId: expiredUser.id } }), 0);
  } finally {
    await stopServer();
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    await rm(resolve(DIST_DIR), { recursive: true, force: true });
    if (originalNextEnv) await writeFile(new URL("../next-env.d.ts", import.meta.url), originalNextEnv);
    if (originalTsconfig) await writeFile(new URL("../tsconfig.json", import.meta.url), originalTsconfig);
  }
});
