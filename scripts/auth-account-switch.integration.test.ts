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
import { PrismaClient, type Role } from "@prisma/client";

const TEST_DATABASE_NAME = "bagati_auth_test";
const TEST_SESSION_SECRET = "bagati-isolated-account-switch-test-secret-32";
const DIST_DIR = ".next-auth-switch-verify";
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

const password = "Isolated-Account-Switch-123!";
const userIds: string[] = [];
let cityId: string | undefined;
let storeId: string | undefined;
let server: ChildProcess | undefined;
let baseUrl = "";
let originalNextEnv = "";
let originalTsconfig = "";

class Jar {
  private values = new Map<string, string>();

  header() {
    return [...this.values.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  get(name: string) {
    return this.values.get(name);
  }

  copy() {
    const jar = new Jar();
    jar.values = new Map(this.values);
    return jar;
  }

  seed(name: string, value: string) {
    this.values.set(name, value);
  }

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

function sessionClaims(token: string) {
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) as { sub?: unknown; jti?: unknown };
  assert.equal(typeof payload.sub, "string");
  assert.equal(typeof payload.jti, "string");
  return { userId: payload.sub as string, sessionId: payload.jti as string };
}

async function request(path: string, init: RequestInit = {}, jar?: Jar) {
  const headers = new Headers(init.headers);
  const cookie = jar?.header();
  if (cookie) headers.set("cookie", cookie);
  if (init.method && init.method !== "GET" && init.method !== "HEAD" && !headers.has("origin")) headers.set("origin", baseUrl);
  return fetch(new URL(path, baseUrl), { ...init, headers, cache: "no-store", redirect: "manual" });
}

async function login(jar: Jar, path: string, email: string, expectedStatus = 200) {
  const response = await request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  }, jar);
  const body = await response.text();
  assert.equal(response.status, expectedStatus, body);
  jar.absorb(response);
  return response;
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
    env: {
      ...process.env,
      DATABASE_URL: testUrl.toString(),
      SESSION_SECRET: TEST_SESSION_SECRET,
      BAGATI_NEXT_DIST_DIR: DIST_DIR,
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_ENV: "development",
    },
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

async function createUser(email: string, role: Role, displayName: string) {
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role,
      isActive: true,
      emailVerifiedAt: new Date(),
      ...(role === "CUSTOMER" ? { customerProfile: { create: { firstName: displayName, lastName: "Fixture" } }, cart: { create: {} } } : {}),
      ...(role === "VENDOR" ? { vendorProfile: { create: { displayName, sellerType: "REGISTERED_COMPANY", legalName: displayName, voen: "TEST0000001", legalAddress: "Test legal address" } } } : {}),
    },
    include: { vendorProfile: true },
  });
  userIds.push(user.id);
  return user;
}

test("email login, logout, and account switching stay isolated to bagati_auth_test", { timeout: 240_000 }, async () => {
  originalNextEnv = await readFile(new URL("../next-env.d.ts", import.meta.url), "utf8");
  originalTsconfig = await readFile(new URL("../tsconfig.json", import.meta.url), "utf8");
  assert.equal(testUrl.hostname, "localhost");
  assert.equal(testUrl.port, "5432");
  assert.equal(testUrl.pathname, `/${TEST_DATABASE_NAME}`);
  const identity = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(identity[0]?.name, TEST_DATABASE_NAME, "refusing to write outside the dedicated test database");

  const tag = randomUUID().replace(/-/g, "").slice(0, 12).toLowerCase();
  try {
    const customerA = await createUser(`switch-customer-a-${tag}@auth-test.invalid`, "CUSTOMER", `CustomerA${tag}`);
    const customerB = await createUser(`switch-customer-b-${tag}@auth-test.invalid`, "CUSTOMER", `CustomerB${tag}`);
    const seller = await createUser(`switch-seller-${tag}@auth-test.invalid`, "VENDOR", `Seller${tag}`);
    const adminA = await createUser(`switch-admin-a-${tag}@auth-test.invalid`, "ADMIN", `AdminA${tag}`);
    const adminB = await createUser(`switch-admin-b-${tag}@auth-test.invalid`, "ADMIN", `AdminB${tag}`);
    cityId = (await prisma.city.create({ data: { name: `Switch test ${tag}`, slug: `switch-test-city-${tag}` } })).id;
    const store = await prisma.store.create({
      data: { vendorId: seller.vendorProfile!.id, cityId, name: `Switch Store ${tag}`, slug: `switch-store-${tag}` },
    });
    storeId = store.id;
    const { existingAccountPortal } = await import("../lib/existing-account");
    assert.equal(await existingAccountPortal(customerA.email), "customer");
    assert.equal(await existingAccountPortal(customerA.email.toUpperCase()), "customer");
    assert.equal(await existingAccountPortal(seller.email), "vendor");
    assert.equal(await existingAccountPortal(adminA.email), "admin");
    assert.equal(await existingAccountPortal(`missing-${tag}@auth-test.invalid`), null);

    await startServer();

    async function expectWrongPortal(path: string, email: string, portal: string, message: RegExp) {
      const response = await request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await response.json() as { code?: string; portal?: string; error?: string };
      assert.equal(response.status, 403, JSON.stringify(body));
      assert.equal(body.code, "WRONG_PORTAL");
      assert.equal(body.portal, portal);
      assert.match(body.error ?? "", message);
      assert.equal(response.headers.getSetCookie().some((cookie) => cookie.startsWith("bagati_session=") && !/max-age=0/i.test(cookie)), false);
    }
    await expectWrongPortal("/api/auth/login", seller.email, "vendor", /satıcı girişindən/);
    await expectWrongPortal("/api/auth/login", adminA.email, "admin", /idarəçi girişindən/);
    await expectWrongPortal("/api/auth/vendor-login", customerA.email, "customer", /müştəri girişindən/);
    await expectWrongPortal("/api/auth/vendor-login", adminA.email, "admin", /idarəçi girişindən/);
    await expectWrongPortal("/api/admin/login", customerA.email, "customer", /müştəri girişindən/);
    await expectWrongPortal("/api/admin/login", seller.email, "vendor", /satıcı girişindən/);
    const sellerGoogle = await (await request("/login?oauth=account-exists&portal=vendor")).text();
    assert.match(sellerGoogle, /satıcı girişindən açılan BAGATI hesabına aiddir/);
    assert.match(sellerGoogle, /Hesablar avtomatik birləşdirilmir/);
    assert.match(sellerGoogle, /href="\/vendor\/login"/);
    assert.match(sellerGoogle, /Satıcı girişinə keç/);
    const customerGoogle = await (await request("/vendor/login?oauth=account-exists&portal=customer")).text();
    assert.match(customerGoogle, /müştəri girişindən açılan BAGATI hesabına aiddir/);
    assert.match(customerGoogle, /href="\/login"/);
    const adminGoogle = await (await request("/login?oauth=account-exists&portal=admin")).text();
    assert.match(adminGoogle, /admin hesabına aiddir/);
    assert.match(adminGoogle, /Google bağlama dəstəklənmir/);
    assert.match(adminGoogle, /href="\/admin\/login"/);
    const unknownGoogle = await (await request("/login?oauth=account-exists")).text();
    assert.match(unknownGoogle, /Mövcud hesabınıza uyğun giriş bölməsini seçin/);
    assert.match(unknownGoogle, /href="\/vendor\/login"/);
    assert.match(unknownGoogle, /href="\/admin\/login"/);
    const noAccount = await (await request("/login?oauth=not-registered")).text();
    assert.match(noAccount, /BAGATI hesabı tapılmadı/);

    const sessionsBefore = await prisma.authSession.count();
    const failed = await request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: customerA.email, password: "wrong-password-123456" }),
    });
    assert.equal(failed.status, 401);
    assert.equal(failed.headers.getSetCookie().some((cookie) => cookie.startsWith("bagati_session=") && !/max-age=0/i.test(cookie)), false);
    assert.equal(await prisma.authSession.count(), sessionsBefore);

    const customerJar = new Jar();
    await login(customerJar, "/api/auth/login", customerA.email);
    const customerAToken = customerJar.get("bagati_session");
    assert.ok(customerAToken);
    const customerASession = sessionClaims(customerAToken);
    assert.equal(customerASession.userId, customerA.id);
    const profileA = await request("/api/account/profile", {}, customerJar);
    assert.equal(profileA.status, 200);
    assert.equal(((await profileA.json()) as { email: string }).email, customerA.email);
    const accountPage = await request("/account", {}, customerJar);
    assert.equal(accountPage.status, 200);
    assert.match(await accountPage.text(), new RegExp(`CustomerA${tag}`));
    const loginWhileA = await request("/login", {}, customerJar);
    assert.equal(loginWhileA.status, 200);
    assert.match(await loginWhileA.text(), new RegExp(customerA.email));
    assert.match(await (await request("/vendor/login", {}, customerJar)).text(), new RegExp(customerA.email));
    assert.notEqual((await request("/vendor", {}, customerJar)).status, 200);
    assert.notEqual((await request("/admin", {}, customerJar)).status, 200);

    await login(customerJar, "/api/auth/login", customerB.email);
    const customerBToken = customerJar.get("bagati_session");
    assert.ok(customerBToken);
    assert.notEqual(customerBToken, customerAToken);
    const customerBSession = sessionClaims(customerBToken);
    assert.equal(customerBSession.userId, customerB.id);
    assert.ok((await prisma.authSession.findUniqueOrThrow({ where: { id: customerASession.sessionId } })).revokedAt);
    const profileB = await request("/api/account/profile", {}, customerJar);
    assert.equal(((await profileB.json()) as { email: string }).email, customerB.email);
    assert.match(await (await request("/account", {}, customerJar)).text(), new RegExp(`CustomerB${tag}`));
    assert.doesNotMatch(await (await request("/account", {}, customerJar)).text(), new RegExp(`CustomerA${tag}`));
    const staleCustomer = new Jar();
    staleCustomer.seed("bagati_session", customerAToken);
    assert.equal((await request("/api/account/profile", {}, staleCustomer)).status, 401);

    await login(customerJar, "/api/auth/vendor-login", seller.email);
    const sellerToken = customerJar.get("bagati_session");
    assert.ok(sellerToken);
    assert.equal(sessionClaims(sellerToken).userId, seller.id);
    assert.ok((await prisma.authSession.findUniqueOrThrow({ where: { id: customerBSession.sessionId } })).revokedAt);
    assert.equal((await request("/api/account/profile", {}, customerJar)).status, 401);
    const vendorPage = await request("/vendor", {}, customerJar);
    assert.equal(vendorPage.status, 200);
    const vendorHtml = await vendorPage.text();
    assert.match(vendorHtml, new RegExp(`Switch Store ${tag}`));
    assert.doesNotMatch(vendorHtml, new RegExp(`CustomerB${tag}`));
    assert.notEqual((await request("/admin", {}, customerJar)).status, 200);
    assert.equal((await request("/api/vendor/stores", {}, staleCustomer)).status, 403);

    const sellerSession = sessionClaims(sellerToken);
    await login(customerJar, "/api/auth/login", customerA.email);
    const returnedCustomer = customerJar.get("bagati_session");
    assert.ok(returnedCustomer);
    assert.equal(sessionClaims(returnedCustomer).userId, customerA.id);
    assert.ok((await prisma.authSession.findUniqueOrThrow({ where: { id: sellerSession.sessionId } })).revokedAt);
    assert.equal(((await (await request("/api/account/profile", {}, customerJar)).json()) as { email: string }).email, customerA.email);
    assert.notEqual((await request("/vendor", {}, customerJar)).status, 200);
    assert.equal((await request("/api/vendor/stores", {}, customerJar)).status, 403);

    const otherTab = customerJar.copy();
    const crossSite = await request("/api/auth/logout", { method: "POST", headers: { origin: "https://evil.example" } }, customerJar);
    assert.equal(crossSite.status, 403);
    assert.equal((await prisma.authSession.findUniqueOrThrow({ where: { id: sessionClaims(returnedCustomer).sessionId } })).revokedAt, null);
    const logout = await request("/api/auth/logout", { method: "POST" }, customerJar);
    assert.equal(logout.status, 200);
    const deletion = logout.headers.getSetCookie().find((cookie) => cookie.startsWith("bagati_session="));
    assert.ok(deletion);
    assert.match(deletion, /Expires=Thu, 01 Jan 1970/i);
    assert.match(deletion, /Max-Age=0/);
    assert.match(deletion, /HttpOnly/i);
    assert.match(deletion, /Path=\//);
    assert.match(deletion, /SameSite=lax/i);
    assert.doesNotMatch(deletion, /Domain=/i);
    assert.doesNotMatch(deletion, /Secure/i);
    customerJar.absorb(logout);
    assert.equal(customerJar.get("bagati_session"), undefined);
    assert.ok((await prisma.authSession.findUniqueOrThrow({ where: { id: sessionClaims(returnedCustomer).sessionId } })).revokedAt);
    for (const path of ["/vendor", `/vendor/${storeId}`, "/orders", "/account", "/admin"]) {
      assert.notEqual((await request(path, {}, customerJar)).status, 200, path);
      assert.notEqual((await request(path, {}, otherTab)).status, 200, `stale tab ${path}`);
    }
    assert.equal((await request("/api/account/profile", {}, otherTab)).status, 401);
    const anonymousLogout = await request("/api/auth/logout", { method: "POST" });
    assert.equal(anonymousLogout.status, 200);
    assert.match(anonymousLogout.headers.getSetCookie().find((cookie) => cookie.startsWith("bagati_session=")) ?? "", /Max-Age=0/);

    await login(customerJar, "/api/auth/vendor-login", seller.email);
    assert.equal((await request("/vendor", {}, customerJar)).status, 200);
    const sellerLogout = await request("/api/auth/logout", { method: "POST" }, customerJar);
    assert.equal(sellerLogout.status, 200);
    customerJar.absorb(sellerLogout);
    assert.notEqual((await request("/vendor", {}, customerJar)).status, 200);
    await login(customerJar, "/api/auth/vendor-login", seller.email);
    const sellerAgain = await request("/vendor", {}, customerJar);
    assert.equal(sellerAgain.status, 200);
    assert.match(await sellerAgain.text(), new RegExp(`Switch Store ${tag}`));
    const sellerLogoutAgain = await request("/api/auth/logout", { method: "POST" }, customerJar);
    assert.equal(sellerLogoutAgain.status, 200);
    customerJar.absorb(sellerLogoutAgain);
    await login(customerJar, "/api/auth/login", customerA.email);
    const refreshedAccount = await request("/account", {}, customerJar);
    assert.equal(refreshedAccount.status, 200);
    assert.match(await refreshedAccount.text(), new RegExp(`CustomerA${tag}`));
    const refreshedAgain = await request("/account", {}, customerJar);
    assert.equal(refreshedAgain.status, 200);

    const adminJar = new Jar();
    await login(adminJar, "/api/admin/login", adminA.email);
    const adminAToken = adminJar.get("bagati_session");
    assert.ok(adminAToken);
    const adminASession = sessionClaims(adminAToken);
    assert.match(await (await request("/admin", {}, adminJar)).text(), new RegExp(adminA.email));
    assert.match(await (await request("/admin/login", {}, adminJar)).text(), new RegExp(adminA.email));
    assert.equal((await request("/api/account/profile", {}, adminJar)).status, 401);
    assert.equal((await request("/api/vendor/stores", {}, adminJar)).status, 403);
    await login(adminJar, "/api/admin/login", adminB.email);
    const adminBToken = adminJar.get("bagati_session");
    assert.ok(adminBToken);
    assert.notEqual(adminBToken, adminAToken);
    assert.equal(sessionClaims(adminBToken).userId, adminB.id);
    assert.ok((await prisma.authSession.findUniqueOrThrow({ where: { id: adminASession.sessionId } })).revokedAt);
    const adminPage = await (await request("/admin", {}, adminJar)).text();
    assert.match(adminPage, new RegExp(adminB.email));
    assert.doesNotMatch(adminPage, new RegExp(adminA.email));
    const oldAdmin = new Jar();
    oldAdmin.seed("bagati_session", adminAToken);
    assert.notEqual((await request("/admin", {}, oldAdmin)).status, 200);
    const adminLogout = await request("/api/auth/logout", { method: "POST" }, adminJar);
    assert.equal(adminLogout.status, 200);
    adminJar.absorb(adminLogout);
    assert.notEqual((await request("/admin", {}, adminJar)).status, 200);
    assert.notEqual((await request("/admin", {}, adminJar)).status, 200);
  } finally {
    await stopServer();
    if (storeId) await prisma.store.deleteMany({ where: { id: storeId } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (cityId) await prisma.city.deleteMany({ where: { id: cityId } });
    await prisma.$disconnect();
    await rm(resolve(DIST_DIR), { recursive: true, force: true });
    if (originalNextEnv) await writeFile(new URL("../next-env.d.ts", import.meta.url), originalNextEnv);
    if (originalTsconfig) await writeFile(new URL("../tsconfig.json", import.meta.url), originalTsconfig);
  }
});
