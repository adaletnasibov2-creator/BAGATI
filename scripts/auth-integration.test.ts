import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { Prisma, PrismaClient, Role } from "@prisma/client";
import { compareVerificationCode } from "../lib/email-verification";
import { formatLocalDateInput } from "../lib/admin-report-dates";
import { getStoreEntitlements } from "../lib/subscription-entitlements";
import { summarizeMonthlyStoreSales } from "../lib/store-monthly-sales";

const TEST_SESSION_SECRET = "bagati-isolated-auth-integration-test-session-secret";
const TEST_DATABASE_NAME = "bagati_auth_test";
const appDatabaseUrl = process.env.DATABASE_URL;
if (!appDatabaseUrl) throw new Error("DATABASE_URL is not configured; refusing to run auth integration tests.");
const appUrl = new URL(appDatabaseUrl);
if (appUrl.hostname !== "localhost" || appUrl.port !== "5432" || appUrl.pathname !== "/bagati") {
  throw new Error("Auth integration tests require the configured local bagati database so they can derive the isolated test database.");
}
const testUrl = new URL(appUrl);
testUrl.pathname = `/${TEST_DATABASE_NAME}`;
process.env.SESSION_SECRET = TEST_SESSION_SECRET;
process.env.DATABASE_URL = testUrl.toString();

const prisma = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
const fixtureUserIds: string[] = [];
const fixtureStoreIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureOrderIds: string[] = [];
const fixtureEmailAddresses: string[] = [];
let fixtureCityId: string | undefined;
let fixtureCategoryId: string | undefined;
let fixturePlanId: string | undefined;
let server: ChildProcess | undefined;
let baseUrl = "";

function assertNoSessionCookie(response: Response) {
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.some((cookie) => cookie.startsWith("bagati_session=") && !cookie.startsWith("bagati_session=;")), false);
}

function setCookieHeader(response: Response, name: string) {
  const cookie = response.headers.getSetCookie().find((item) => item.startsWith(`${name}=`));
  assert.ok(cookie, `expected ${name} response cookie`);
  return cookie;
}

function cookiePair(response: Response, name: string) {
  const cookie = setCookieHeader(response, name);
  return cookie.split(";", 1)[0];
}

function sessionFrom(response: Response) {
  const cookie = cookiePair(response, "bagati_session");
  assert.match(cookie, /^bagati_session=\S+$/);
  return cookie;
}

async function request(path: string, init: RequestInit = {}, cookie?: string) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  return fetch(new URL(path, baseUrl), { ...init, headers, cache: "no-store", redirect: "manual" });
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>;
}

async function login(path: string, email: string, password: string, cookie?: string) {
  return request(path, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ email, password }),
  }, cookie);
}

async function reservePort() {
  const socket = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    socket.once("error", reject);
    socket.listen(0, "localhost", () => resolvePromise());
  });
  const address = socket.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolvePromise) => socket.close(() => resolvePromise()));
  return address.port;
}

async function startServer() {
  const port = await reservePort();
  baseUrl = `http://localhost:${port}`;
  server = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "-H", "localhost", "-p", String(port)], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testUrl.toString(), SESSION_SECRET: TEST_SESSION_SECRET, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
    stdio: "ignore",
    windowsHide: true,
  });
  const startDeadline = Date.now() + 45_000;
  while (Date.now() < startDeadline) {
    if (server.exitCode !== null) throw new Error("Temporary BAGATI server exited before becoming ready.");
    try {
      const response = await fetch(baseUrl, { redirect: "manual", signal: AbortSignal.timeout(2_000) });
      if (response.status === 200) return;
    } catch { /* Wait for local server startup. */ }
    await delay(400);
  }
  throw new Error("Temporary BAGATI server did not become ready in time.");
}

async function createUser(input: { email: string; password: string; role: Role; active?: boolean; verified?: boolean; name: string }) {
  fixtureEmailAddresses.push(input.email);
  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash: await bcrypt.hash(input.password, 12),
      role: input.role,
      isActive: input.active ?? true,
      emailVerifiedAt: input.verified === false ? null : new Date(),
      ...(input.role === "CUSTOMER" ? { customerProfile: { create: { firstName: input.name, lastName: "Fixture" } }, cart: { create: {} } } : {}),
      ...(input.role === "VENDOR" ? { vendorProfile: { create: { displayName: input.name, sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: input.name, voen: "TEST00001" } } } : {}),
    },
    include: { vendorProfile: true },
  });
  fixtureUserIds.push(user.id);
  return user;
}

async function createStore(vendorProfileId: string, suffix: string) {
  assert.ok(fixtureCityId && fixturePlanId);
  const store = await prisma.store.create({
    data: {
      vendorId: vendorProfileId,
      cityId: fixtureCityId,
      name: `Auth Test Store ${suffix}`,
      slug: `auth-test-${suffix}`,
      status: "ACTIVE",
      isActive: true,
      legalInfoApproved: true,
      subscription: { create: { planId: fixturePlanId, status: "ACTIVE", startedAt: new Date(), currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 86_400_000) } },
    },
  });
  fixtureStoreIds.push(store.id);
  return store;
}

async function createProduct(storeId: string, suffix: string) {
  assert.ok(fixtureCategoryId);
  const product = await prisma.product.create({
    data: {
      storeId,
      categoryId: fixtureCategoryId,
      name: `Auth Test Product ${suffix}`,
      slug: `auth-test-${suffix}`,
      sku: `AUTH-${suffix}`,
      price: new Prisma.Decimal("10.00"),
      status: "ACTIVE",
      images: [],
      inventory: { create: { quantity: 5, lowStockThreshold: 1 } },
    },
  });
  fixtureProductIds.push(product.id);
  return product;
}

async function addOrder(customerId: string, storeId: string) {
  const order = await prisma.order.create({
    data: {
      userId: customerId,
      subtotal: new Prisma.Decimal("10.00"),
      total: new Prisma.Decimal("10.00"),
      addressSnapshot: { recipientName: "Test Customer", phone: "000000000", city: "Bakı", line1: "Test address" },
      storeOrders: { create: { storeId, status: "NEW", subtotal: new Prisma.Decimal("10.00") } },
    },
  });
  fixtureOrderIds.push(order.id);
  return order;
}

async function cleanFixtures() {
  if (fixtureEmailAddresses.length) await prisma.emailOutbox.deleteMany({ where: { recipient: { in: fixtureEmailAddresses } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: [...fixtureStoreIds, ...(fixtureCategoryId ? [fixtureCategoryId] : [])] } } });
  if (fixtureOrderIds.length) await prisma.order.deleteMany({ where: { id: { in: fixtureOrderIds } } });
  if (fixtureProductIds.length) await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  if (fixtureStoreIds.length) await prisma.store.deleteMany({ where: { id: { in: fixtureStoreIds } } });
  if (fixtureUserIds.length) await prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } });
  if (fixturePlanId) await prisma.subscriptionPlan.deleteMany({ where: { id: fixturePlanId } });
  if (fixtureCategoryId) await prisma.category.deleteMany({ where: { id: fixtureCategoryId } });
  if (fixtureCityId) await prisma.city.deleteMany({ where: { id: fixtureCityId } });
}

test("real auth and cross-account checks use isolated fixture database only", { timeout: 180_000 }, async (t) => {
  assert.equal(testUrl.hostname, "localhost");
  assert.equal(testUrl.port, "5432");
  assert.equal(testUrl.pathname, `/${TEST_DATABASE_NAME}`);
  const dbInfo = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(dbInfo[0]?.name, TEST_DATABASE_NAME, "refusing to write fixtures to any other database");

  const tag = randomUUID().replace(/-/g, "").slice(0, 10).toLowerCase();
  const wrongPassword = "Wrong-Test-Password-123!";
  const correctPassword = "Auth-Test-Password-123!";
  try {
    await prisma.$transaction(async (tx) => {
      fixtureCityId = (await tx.city.create({ data: { name: `Auth test ${tag}`, slug: `auth-test-city-${tag}` } })).id;
      fixtureCategoryId = (await tx.category.create({ data: { name: `Auth test ${tag}`, slug: `auth-test-category-${tag}` } })).id;
      fixturePlanId = (await tx.subscriptionPlan.create({ data: { name: `Auth test ${tag}`, slug: `auth-test-plan-${tag}`, monthlyPrice: new Prisma.Decimal("0"), isActive: true } })).id;
    });

    const customerA = await createUser({ email: `customer-a-${tag}@auth-test.invalid`, password: correctPassword, role: "CUSTOMER", name: `CustomerA${tag}` });
    const customerB = await createUser({ email: `customer-b-${tag}@auth-test.invalid`, password: correctPassword, role: "CUSTOMER", name: `CustomerB${tag}` });
    const passwordChangeUser = await createUser({ email: `password-change-${tag}@auth-test.invalid`, password: correctPassword, role: "CUSTOMER", name: `PasswordChange${tag}` });
    const pendingCustomer = await createUser({ email: `customer-pending-${tag}@auth-test.invalid`, password: correctPassword, role: "CUSTOMER", name: `Pending${tag}`, verified: false });
    const inactiveCustomer = await createUser({ email: `customer-inactive-${tag}@auth-test.invalid`, password: correctPassword, role: "CUSTOMER", name: `Inactive${tag}`, active: false });
    const vendorA = await createUser({ email: `vendor-a-${tag}@auth-test.invalid`, password: correctPassword, role: "VENDOR", name: `VendorA${tag}` });
    const vendorB = await createUser({ email: `vendor-b-${tag}@auth-test.invalid`, password: correctPassword, role: "VENDOR", name: `VendorB${tag}` });
    const admin = await createUser({ email: `admin-${tag}@auth-test.invalid`, password: correctPassword, role: "ADMIN", name: `Admin${tag}` });
    assert.ok(vendorA.vendorProfile && vendorB.vendorProfile);
    const storeA = await createStore(vendorA.vendorProfile.id, `${tag}-a`);
    const storeB = await createStore(vendorB.vendorProfile.id, `${tag}-b`);
    const productA = await createProduct(storeA.id, `${tag}-a`);
    const productB = await createProduct(storeB.id, `${tag}-b`);
    const orderB = await addOrder(customerB.id, storeB.id);

    await startServer();

    await t.test("login validates passwords, active state, email verification, and exact roles", async () => {
      const customerLogin = await login("/api/auth/login", customerA.email, correctPassword);
      assert.equal(customerLogin.status, 200);
      assert.equal((await json(customerLogin)).user.email, customerA.email);
      const customerCookie = sessionFrom(customerLogin);
      const sessionHeader = setCookieHeader(customerLogin, "bagati_session");
      assert.ok(/HttpOnly/i.test(sessionHeader), "session cookie must be HttpOnly");
      assert.ok(/SameSite=Lax/i.test(sessionHeader), "session cookie must use SameSite=Lax");
      assert.ok(/Path=\//i.test(sessionHeader), "session cookie must be scoped to root path");
      assert.ok(/Secure/i.test(sessionHeader), "production session cookie must be Secure");
      assert.ok(/Max-Age=604800/i.test(sessionHeader), "session cookie must expire in seven days");

      const badPassword = await login("/api/auth/login", customerA.email, wrongPassword);
      assert.equal(badPassword.status, 401); assertNoSessionCookie(badPassword);
      const inactiveLogin = await login("/api/auth/login", inactiveCustomer.email, correctPassword);
      assert.equal(inactiveLogin.status, 401); assertNoSessionCookie(inactiveLogin);
      const unverifiedLogin = await login("/api/auth/login", pendingCustomer.email, correctPassword);
      assert.equal(unverifiedLogin.status, 403); assertNoSessionCookie(unverifiedLogin);
      assert.equal((await json(unverifiedLogin)).requiresEmailVerification, true);
      assert.equal(await prisma.emailOutbox.count({ where: { recipient: pendingCustomer.email } }), 0, "unverified login must not send a verification email");
      assert.equal(await prisma.emailOutbox.count({ where: { recipient: customerA.email } }), 0, "verified login must not send a verification email");

      const wrongCustomerRole = await login("/api/auth/login", vendorA.email, correctPassword);
      assert.equal(wrongCustomerRole.status, 403);
      assert.equal((await json(wrongCustomerRole)).code, "WRONG_PORTAL");
      assertNoSessionCookie(wrongCustomerRole);
      const wrongVendorRole = await login("/api/auth/vendor-login", customerA.email, correctPassword);
      assert.equal(wrongVendorRole.status, 403);
      assert.equal((await json(wrongVendorRole)).code, "WRONG_PORTAL");
      assertNoSessionCookie(wrongVendorRole);
      const wrongAdminRole = await login("/api/admin/login", customerA.email, correctPassword);
      assert.equal(wrongAdminRole.status, 403);
      assert.equal((await json(wrongAdminRole)).code, "WRONG_PORTAL");
      assertNoSessionCookie(wrongAdminRole);

      const vendorLogin = await login("/api/auth/vendor-login", vendorA.email, correctPassword);
      assert.equal(vendorLogin.status, 200); assert.equal((await json(vendorLogin)).user.role, "VENDOR");
      const adminLogin = await login("/api/admin/login", admin.email, correctPassword);
      assert.equal(adminLogin.status, 200); assert.equal((await json(adminLogin)).user.role, "ADMIN");

      const sessions = await prisma.authSession.findMany({ where: { userId: customerA.id }, select: { id: true, revokedAt: true } });
      assert.ok(sessions.length >= 1);
      assert.match(sessionFrom(vendorLogin), /^bagati_session=/);
      assert.match(sessionFrom(adminLogin), /^bagati_session=/);
    });

    let customerCookie = "";
    let vendorCookie = "";
    let adminCookie = "";
    const customerLoginResponse = await login("/api/auth/login", customerA.email, correctPassword);
    customerCookie = sessionFrom(customerLoginResponse);
    const vendorLoginResponse = await login("/api/auth/vendor-login", vendorA.email, correctPassword);
    vendorCookie = sessionFrom(vendorLoginResponse);
    const adminLoginResponse = await login("/api/admin/login", admin.email, correctPassword);
    adminCookie = sessionFrom(adminLoginResponse);

    await t.test("password changes revoke other sessions and rotate the current session", async () => {
      const firstLogin = await login("/api/auth/login", passwordChangeUser.email, correctPassword);
      const firstCookie = sessionFrom(firstLogin);
      const firstClaims = JSON.parse(Buffer.from(firstCookie.split(".")[1]!, "base64url").toString("utf8")) as { jti: string };
      const secondLogin = await login("/api/auth/login", passwordChangeUser.email, correctPassword);
      const secondCookie = sessionFrom(secondLogin);
      const secondClaims = JSON.parse(Buffer.from(secondCookie.split(".")[1]!, "base64url").toString("utf8")) as { jti: string };

      const changed = await request("/api/account/security/password", {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ currentPassword: correctPassword, newPassword: "Changed-Password-For-Test-2026!" }),
      }, firstCookie);
      assert.equal(changed.status, 200);
      assert.match((await json(changed)).message, /digər aktiv sessiyalar bağlandı/i);
      const replacementCookie = sessionFrom(changed);
      const replacementClaims = JSON.parse(Buffer.from(replacementCookie.split(".")[1]!, "base64url").toString("utf8")) as { jti: string };

      const [firstSession, secondSession, replacementSession] = await Promise.all([
        prisma.authSession.findUniqueOrThrow({ where: { id: firstClaims.jti } }),
        prisma.authSession.findUniqueOrThrow({ where: { id: secondClaims.jti } }),
        prisma.authSession.findUniqueOrThrow({ where: { id: replacementClaims.jti } }),
      ]);
      assert.ok(firstSession.revokedAt);
      assert.ok(secondSession.revokedAt);
      assert.equal(replacementSession.revokedAt, null);
      assert.equal((await request("/api/cart", {}, firstCookie)).status, 401);
      assert.equal((await request("/api/cart", {}, secondCookie)).status, 401);
      assert.equal((await request("/api/cart", {}, replacementCookie)).status, 200);
      assert.equal((await login("/api/auth/login", passwordChangeUser.email, correctPassword)).status, 401);
      assert.equal((await login("/api/auth/login", passwordChangeUser.email, "Changed-Password-For-Test-2026!")).status, 200);
    });

    await t.test("admin-managed stores are created safely, approved without a paid plan, and archived without losing reports", async () => {
      const createBody = {
        vendorId: vendorA.vendorProfile!.id,
        cityId: fixtureCityId,
        name: `Admin Managed ${tag}`,
        address: "Isolated test address",
        description: "Test-only admin-managed store",
        managementReason: "Isolated admin store-management integration fixture",
      };
      for (const cookie of [undefined, customerCookie, vendorCookie]) {
        const deniedCreate = await request("/api/admin/stores", {
          method: "POST",
          headers: { "content-type": "application/json", origin: baseUrl },
          body: JSON.stringify(createBody),
        }, cookie);
        assert.equal(deniedCreate.status, 403);
      }

      const created = await request("/api/admin/stores", {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify(createBody),
      }, adminCookie);
      assert.equal(created.status, 201);
      const createdItem = (await json(created)).item as { id: string; status: string; isActive: boolean };
      fixtureStoreIds.push(createdItem.id);
      assert.equal(createdItem.status, "DRAFT");
      assert.equal(createdItem.isActive, false);
      let managedStore = await prisma.store.findUnique({
        where: { id: createdItem.id },
        select: { adminManaged: true, managedByAdminId: true, managementReason: true, subscription: { select: { id: true } } },
      });
      assert.deepEqual(managedStore, {
        adminManaged: true,
        managedByAdminId: admin.id,
        managementReason: createBody.managementReason,
        subscription: null,
      });
      assert.ok(await prisma.auditLog.findFirst({ where: { entityType: "Store", entityId: createdItem.id, action: "ADMIN_MANAGED_STORE_CREATE" } }));
      assert.equal((await getStoreEntitlements(createdItem.id, prisma)).eligible, false, "draft stores must not sell before approval");

      const deniedReview = await request(`/api/admin/stores/${createdItem.id}/review`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ action: "approve" }),
      }, vendorCookie);
      assert.equal(deniedReview.status, 403);
      await prisma.store.update({ where: { id: createdItem.id }, data: { status: "PENDING_REVIEW" } });
      const approved = await request(`/api/admin/stores/${createdItem.id}/review`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ action: "approve" }),
      }, adminCookie);
      assert.equal(approved.status, 200);
      const approvedStore = await prisma.store.findUnique({
        where: { id: createdItem.id },
        select: { adminManaged: true, status: true, isActive: true, legalInfoApproved: true, subscription: { select: { id: true } } },
      });
      assert.deepEqual(approvedStore, { adminManaged: true, status: "ACTIVE", isActive: true, legalInfoApproved: true, subscription: null });
      assert.equal((await getStoreEntitlements(createdItem.id, prisma)).eligible, true);
      const deniedActivation = await request(`/api/admin/stores/${createdItem.id}/activation`, {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ isActive: false, reason: "Integration test visibility off" }),
      }, vendorCookie);
      assert.equal(deniedActivation.status, 403);
      const deactivated = await request(`/api/admin/stores/${createdItem.id}/activation`, {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ isActive: false, reason: "Integration test visibility off" }),
      }, adminCookie);
      assert.equal(deactivated.status, 200);
      assert.equal((await prisma.store.findUniqueOrThrow({ where: { id: createdItem.id }, select: { isActive: true } })).isActive, false);
      assert.equal((await getStoreEntitlements(createdItem.id, prisma)).eligible, false);
      const reactivated = await request(`/api/admin/stores/${createdItem.id}/activation`, {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ isActive: true, reason: "Integration test visibility on" }),
      }, adminCookie);
      assert.equal(reactivated.status, 200);
      assert.equal((await prisma.store.findUniqueOrThrow({ where: { id: createdItem.id }, select: { isActive: true } })).isActive, true);
      assert.equal((await getStoreEntitlements(createdItem.id, prisma)).eligible, true);
      const publicStores = await request("/api/stores");
      assert.equal(publicStores.status, 200);
      assert.ok(((await json(publicStores)).items as Array<{ id: string }>).some((store) => store.id === createdItem.id));

      const reportOrder = await addOrder(customerA.id, createdItem.id);
      const orderDetail = await request(`/admin/orders/${reportOrder.id}`, {}, adminCookie);
      assert.equal(orderDetail.status, 200);
      const orderDetailHtml = await orderDetail.text();
      assert.match(orderDetailHtml, /İcazə verilən növbəti status/);
      assert.match(orderDetailHtml, /CONFIRMED/);
      assert.match(orderDetailHtml, /CANCELLED/);
      const deliveredAt = new Date();
      await prisma.$transaction([
        prisma.order.update({ where: { id: reportOrder.id }, data: { status: "DELIVERED" } }),
        prisma.storeOrder.updateMany({ where: { orderId: reportOrder.id, storeId: createdItem.id }, data: { status: "DELIVERED", deliveredAt } }),
      ]);
      const orderLine = await prisma.storeOrder.findUnique({ where: { orderId_storeId: { orderId: reportOrder.id, storeId: createdItem.id } } });
      assert.ok(orderLine);

      const deniedArchive = await request(`/api/admin/stores/${createdItem.id}/archive`, { method: "POST", headers: { origin: baseUrl } }, vendorCookie);
      assert.equal(deniedArchive.status, 403);
      const archived = await request(`/api/admin/stores/${createdItem.id}/archive`, { method: "POST", headers: { origin: baseUrl } }, adminCookie);
      assert.equal(archived.status, 200);
      assert.equal(await prisma.storeOrder.count({ where: { orderId: reportOrder.id, storeId: createdItem.id } }), 1);
      assert.ok(await prisma.auditLog.findFirst({ where: { entityType: "Store", entityId: createdItem.id, action: "STORE_DEACTIVATE_ARCHIVE" } }));

      const noCommissionRule = summarizeMonthlyStoreSales([{
        id: orderLine.id,
        storeId: createdItem.id,
        status: "DELIVERED",
        subtotal: orderLine.subtotal,
        commissionRateSnapshot: null,
        createdAt: orderLine.createdAt,
        deliveredAt,
        returnRequests: [],
      }]);
      assert.equal(noCommissionRule[0]?.orders, 1);
      assert.equal(noCommissionRule[0]?.commissionCents, null, "do not invent a commission rate");
      assert.equal(noCommissionRule[0]?.ordersWithoutRule, 1);

      const publicAfterArchive = await request("/api/stores");
      assert.equal(publicAfterArchive.status, 200);
      assert.equal(((await json(publicAfterArchive)).items as Array<{ id: string }>).some((store) => store.id === createdItem.id), false);
      const day = formatLocalDateInput(deliveredAt);
      const reportPage = await request(`/admin/reports?from=${day}&to=${day}&storeId=${createdItem.id}`, {}, adminCookie);
      assert.equal(reportPage.status, 200);
      const reportHtml = await reportPage.text();
      assert.ok(reportHtml.includes(createBody.name), "archived store remains visible in its historical report");
      assert.ok(reportHtml.includes("10.00 ₼"), "historical report includes the delivered order's sales");
      assert.ok(reportHtml.includes("Qayda yoxdur (1)"), "report does not invent a missing commission rule");
    });

    await t.test("admin visibility cannot promote a suspended store", async () => {
      await prisma.store.update({ where: { id: storeA.id }, data: { status: "SUSPENDED", isActive: false, legalInfoApproved: false } });
      await prisma.storeSubscription.update({ where: { storeId: storeA.id }, data: { status: "PENDING", currentPeriodStart: null, currentPeriodEnd: null } });
      await prisma.vendorProfile.update({ where: { id: vendorA.vendorProfile!.id }, data: { sellerType: null, legalName: null, voen: null, legalAddress: null } });
      assert.equal((await getStoreEntitlements(storeA.id, prisma)).eligible, false);
      assert.equal(((await json(await request("/api/stores"))).items as Array<{ id: string }>).some(item => item.id === storeA.id), false);
      assert.equal(((await json(await request(`/api/products?q=${encodeURIComponent(productA.name)}`))).items as Array<{ id: string }>).some(item => item.id === productA.id), false);

      const reason = "Explicit test admin visibility approval";
      for (const cookie of [undefined, customerCookie, vendorCookie]) {
        const denied = await request(`/api/admin/stores/${storeA.id}/activation`, {
          method: "PATCH",
          headers: { "content-type": "application/json", origin: baseUrl },
          body: JSON.stringify({ isActive: true, reason }),
        }, cookie);
        assert.equal(denied.status, 403);
      }
      const before = await prisma.storeSubscription.findUniqueOrThrow({ where: { storeId: storeA.id }, select: { planId: true, status: true, currentPeriodStart: true, currentPeriodEnd: true, accessSource: true } });
      const activationsBefore = await prisma.auditLog.count({ where: { entityType: "Store", entityId: storeA.id, action: "STORE_ACTIVATE" } });
      const activated = await request(`/api/admin/stores/${storeA.id}/activation`, {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ isActive: true, reason }),
      }, adminCookie);
      assert.equal(activated.status, 409);
      const after = await prisma.store.findUniqueOrThrow({ where: { id: storeA.id }, select: { status: true, isActive: true, legalInfoApproved: true, vendor: { select: { sellerType: true, legalName: true, voen: true } }, subscription: { select: { planId: true, status: true, currentPeriodStart: true, currentPeriodEnd: true, accessSource: true } } } });
      assert.deepEqual({ status: after.status, isActive: after.isActive, legalInfoApproved: after.legalInfoApproved }, { status: "SUSPENDED", isActive: false, legalInfoApproved: false });
      assert.deepEqual(after.vendor, { sellerType: null, legalName: null, voen: null });
      assert.deepEqual(after.subscription, before, "a rejected visibility change does not fabricate or change subscription/payment state");
      assert.equal((await getStoreEntitlements(storeA.id, prisma)).eligible, false);
      assert.equal(await prisma.auditLog.count({ where: { entityType: "Store", entityId: storeA.id, action: "STORE_ACTIVATE" } }), activationsBefore);

      assert.equal(((await json(await request("/api/stores"))).items as Array<{ id: string }>).some(item => item.id === storeA.id), false);
      assert.equal(((await json(await request(`/api/products?q=${encodeURIComponent(productA.name)}`))).items as Array<{ id: string }>).some(item => item.id === productA.id), false);
      assert.equal((await request(`/stores/${storeA.slug}`)).status, 404);
      const cartAttempt = await request("/api/cart/items", {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ productId: productA.id, quantity: 1 }),
      }, customerCookie);
      assert.notEqual(cartAttempt.status, 200);
      assert.equal(await prisma.cartItem.count({ where: { cart: { userId: customerA.id }, productId: productA.id } }), 0);
      assert.equal((await prisma.inventory.findFirstOrThrow({ where: { productId: productA.id, variantId: null } })).quantity, 5);
    });
    await t.test("customer and vendor data are scoped to the authenticated owner", async () => {
      const ordersResponse = await request("/api/orders", {}, customerCookie);
      assert.equal(ordersResponse.status, 200);
      const orderItems = (await json(ordersResponse)).items as Array<{ id: string }>;
      assert.equal(orderItems.some((item) => item.id === orderB.id), false);
      const privateOrderPage = await request(`/orders/${encodeURIComponent(orderB.id)}`, {}, customerCookie);
      assert.equal(privateOrderPage.status, 404);

      assert.equal((await request(`/api/vendor/${storeA.id}/profile`, {}, vendorCookie)).status, 200);
      assert.equal((await request(`/api/vendor/${storeB.id}/products`, {}, vendorCookie)).status, 403);
      assert.equal((await request(`/api/vendor/${storeB.id}/products/${productB.id}`, { method: "PATCH", headers: { "content-type": "application/json", origin: baseUrl }, body: JSON.stringify({ name: "forged" }) }, vendorCookie)).status, 403);
      const foreignAssetForm = new FormData();
      foreignAssetForm.set("file", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "foreign.png");
      assert.equal((await request(`/api/vendor/${storeB.id}/assets`, { method: "POST", body: foreignAssetForm }, vendorCookie)).status, 403);
      assert.equal((await request(`/api/vendor/${storeB.id}/assets`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: `/uploads/vendors/${storeB.id}/123e4567-e89b-12d3-a456-426614174000.jpg` }) }, vendorCookie)).status, 403);
      assert.equal((await request(`/api/vendor/${storeB.id}/profile`, { method: "PATCH", headers: { "content-type": "application/json", origin: baseUrl }, body: JSON.stringify({ name: "forged" }) }, vendorCookie)).status, 403);
      assert.equal((await request(`/api/vendor/${storeB.id}/orders`, {}, vendorCookie)).status, 403);
      assert.equal((await request(`/api/vendor/${storeB.id}/settings`, {}, vendorCookie)).status, 403);
      const ownProduct = await request(`/api/vendor/${storeA.id}/products/${productA.id}`, {}, vendorCookie);
      assert.equal(ownProduct.status, 200);
      assert.equal((await json(ownProduct)).product.id, productA.id);
    });

    await t.test("admin routes accept ADMIN and reject customer/vendor sessions", async () => {
      assert.equal((await request("/api/admin/email", {}, adminCookie)).status, 200);
      assert.equal((await request("/api/admin/email", {}, customerCookie)).status, 403);
      assert.equal((await request("/api/admin/email", {}, vendorCookie)).status, 403);
      const adminHtml = await request("/admin", {}, adminCookie);
      assert.equal(adminHtml.status, 200);
      for (const cookie of [undefined, customerCookie, vendorCookie]) {
        const deniedPage = await request("/admin", {}, cookie);
        assert.equal(deniedPage.status, 307);
        assert.match(deniedPage.headers.get("location") || "", /\/admin\/login/);
      }
    });

    await t.test("logout revokes sessions, and database expiry rejects otherwise-valid signed cookies", async () => {
      const freshCustomer = await login("/api/auth/login", customerA.email, correctPassword);
      const logoutCookie = sessionFrom(freshCustomer);
      const logout = await request("/api/auth/logout", { method: "POST", headers: { origin: baseUrl } }, logoutCookie);
      assert.equal(logout.status, 200, `logout response: ${JSON.stringify(await json(logout))}`);
      assert.ok(/Max-Age=0/i.test(setCookieHeader(logout, "bagati_session")), "logout expires the session cookie");
      const verificationCookieHeader = setCookieHeader(logout, "bagati_email_verification");
      const verificationCookieAttributes = verificationCookieHeader.split(";").slice(1).map((part) => part.trim().split("=", 1)[0]).join(", ");
      const verificationCookieExpires = /Expires=([^;]+)/i.exec(verificationCookieHeader)?.[1];
      const verificationCookieIsExpired = verificationCookieExpires !== undefined && Date.parse(verificationCookieExpires) <= Date.now();
      assert.ok(/Max-Age=0/i.test(verificationCookieHeader) || verificationCookieIsExpired, `logout expires verification context (attributes: ${verificationCookieAttributes})`);
      const logoutPayload = JSON.parse(Buffer.from(logoutCookie.split(".")[1], "base64url").toString("utf8")) as { jti: string };
      assert.ok((await prisma.authSession.findUnique({ where: { id: logoutPayload.jti } }))?.revokedAt);
      assert.equal((await request("/api/cart", {}, logoutCookie)).status, 401);

      const expiring = await login("/api/auth/login", customerB.email, correctPassword);
      const expiringCookie = sessionFrom(expiring);
      const expiringPayload = JSON.parse(Buffer.from(expiringCookie.split(".")[1], "base64url").toString("utf8")) as { jti: string };
      await prisma.authSession.update({ where: { id: expiringPayload.jti }, data: { expiresAt: new Date(Date.now() - 1_000) } });
      assert.equal((await request("/api/cart", {}, expiringCookie)).status, 401);
    });

    await t.test("protected routes reject session cookies that are not HS256-signed BAGATI tokens", async () => {
      const live = await login("/api/auth/login", customerA.email, correctPassword);
      const liveCookie = sessionFrom(live);
      const livePayload = JSON.parse(Buffer.from(liveCookie.split(".")[1], "base64url").toString("utf8")) as { sub: string; jti: string };
      assert.equal((await request("/api/cart", {}, liveCookie)).status, 200);
      const key = new TextEncoder().encode(TEST_SESSION_SECRET);
      const sign = (alg: string, claims: Record<string, string> = {}) => new SignJWT({ sub: livePayload.sub, jti: livePayload.jti })
        .setProtectedHeader({ alg }).setIssuer(claims.iss ?? "bagati").setAudience(claims.aud ?? "bagati-session").setIssuedAt().setExpirationTime("5m").sign(key);
      const asCookie = (token: string) => `bagati_session=${token}`;
      const hs256Control = await sign("HS256");
      assert.equal((await request("/api/cart", {}, asCookie(hs256Control))).status, 200);
      for (const [label, forged] of [
        ["HS384", await sign("HS384")],
        ["wrong issuer", await sign("HS256", { iss: "not-bagati" })],
        ["wrong audience", await sign("HS256", { aud: "email-verification" })],
        ["tampered signature", `${hs256Control}x`],
      ] as const) {
        assert.equal((await request("/api/cart", {}, asCookie(forged))).status, 401, label);
      }
    });

    await t.test("cross-site mutations are rejected and same-origin requests reach the handler", async () => {
      const customerLogin = await login("/api/auth/login", customerA.email, correctPassword);
      const cookie = sessionFrom(customerLogin);
      const body = JSON.stringify({});
      const post = (headers: Record<string, string>) => request("/api/cart/items", { method: "POST", headers: { "content-type": "application/json", ...headers }, body }, cookie);
      const blocked = await post({ origin: "https://evil.example" });
      assert.equal(blocked.status, 403);
      assert.equal((await json(blocked)).code, "CROSS_SITE_REQUEST");
      const spoofed = await post({ origin: baseUrl, "sec-fetch-site": "cross-site" });
      assert.equal(spoofed.status, 403);
      const sameOrigin = await post({ origin: baseUrl, "sec-fetch-site": "same-origin" });
      assert.equal(sameOrigin.status, 422);
      const sameSite = await post({ origin: baseUrl, "sec-fetch-site": "same-site" });
      assert.equal(sameSite.status, 422);
      const sameSiteForeign = await post({ origin: "https://evil.example", "sec-fetch-site": "same-site" });
      assert.equal(sameSiteForeign.status, 403);
      const headerless = await post({});
      assert.equal(headerless.status, 403);
      assert.equal((await json(headerless)).code, "CROSS_SITE_REQUEST");
      const crossSiteLogout = await request("/api/auth/logout", { method: "POST", headers: { origin: "https://evil.example" } }, cookie);
      assert.equal(crossSiteLogout.status, 403);
      assert.equal((await request("/api/cart", {}, cookie)).status, 200);
      const crossSiteAdmin = await request("/api/admin/email", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body }, adminCookie);
      assert.equal(crossSiteAdmin.status, 403);
      const ingest = await request("/api/security/ingest/apache", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body });
      assert.notEqual(ingest.status, 403);
    });

    await t.test("seller application return path and verification notice survive the login page", async () => {
      const anonymousApply = await request("/vendor/apply");
      assert.equal(anonymousApply.status, 307);
      assert.match(anonymousApply.headers.get("location") || "", /\/login\?next=%2Fvendor%2Fapply$/);
      const loginPage = await request("/login?next=%2Fvendor%2Fapply");
      assert.equal(loginPage.status, 200);
      assert.match(await loginPage.text(), /next=%2Fvendor%2Fapply/);
      assert.match(await (await request("/login?verified=1")).text(), /Email ünvanınız təsdiqləndi/);
      assert.match(await (await request("/vendor/login?verified=1")).text(), /Email ünvanınız təsdiqləndi/);
    });

    await t.test("login renders the signed-in header, refresh keeps it, and logout returns the public homepage", async () => {
      const signedIn = await login("/api/auth/login", customerA.email, correctPassword);
      const cookie = sessionFrom(signedIn);
      const home = await request("/", {}, cookie);
      const homeHtml = await home.text();
      assert.equal(home.status, 200);
      assert.match(homeHtml, new RegExp(customerA.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(homeHtml, /href="\/"/);
      const account = await request("/account", {}, cookie);
      assert.equal(account.status, 200);
      const refreshed = await request("/", {}, cookie);
      assert.match(await refreshed.text(), /Müştəri hesabı/);
      const loggedOut = await request("/api/auth/logout", { method: "POST", headers: { origin: baseUrl } }, cookie);
      assert.equal(loggedOut.status, 200);
      assert.ok(/Max-Age=0/i.test(setCookieHeader(loggedOut, "bagati_session")));
      const publicHome = await request("/");
      const publicHtml = await publicHome.text();
      assert.equal(publicHome.status, 200);
      assert.doesNotMatch(publicHtml, new RegExp(customerA.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(publicHtml, />Giriş</);
      assert.match(publicHtml, /href="\/"/);
      const staleAccount = await request("/account", {}, cookie);
      assert.equal(staleAccount.status, 307);
      assert.match(staleAccount.headers.get("location") || "", /\/login/);
      const vendorLogin = await login("/api/auth/vendor-login", vendorA.email, correctPassword);
      const vendorCookie = sessionFrom(vendorLogin);
      assert.match(await (await request("/", {}, vendorCookie)).text(), /Satıcı hesabı/);
      assert.equal((await request("/account", {}, vendorCookie)).status, 307);
      const vendorLogout = await request("/api/auth/logout", { method: "POST", headers: { origin: baseUrl } }, vendorCookie);
      assert.equal(vendorLogout.status, 200);
      assert.equal((await request("/vendor", {}, vendorCookie)).status, 307);
    });

    await t.test("login account switching revokes the prior identity and SSR menu uses database identity", async () => {
      const oldCustomer = await login("/api/auth/login", customerA.email, correctPassword);
      const oldCustomerCookie = sessionFrom(oldCustomer);
      const switched = await login("/api/auth/vendor-login", vendorA.email, correctPassword, oldCustomerCookie);
      assert.equal(switched.status, 200);
      const newVendorCookie = sessionFrom(switched);
      assert.equal((await request("/api/cart", {}, oldCustomerCookie)).status, 401);

      const switchedHome = await request("/", {}, newVendorCookie);
      assert.equal(switchedHome.status, 200);
      const switchedHtml = await switchedHome.text();
      assert.match(switchedHtml, new RegExp(`VendorA${tag}`));
      assert.doesNotMatch(switchedHtml, new RegExp(`CustomerA${tag}`));

      const logout = await request("/api/auth/logout", { method: "POST", headers: { origin: baseUrl } }, newVendorCookie);
      assert.equal(logout.status, 200, `account-switch logout response: ${JSON.stringify(await json(logout))}`);
      const signedOutHome = await request("/");
      assert.equal(signedOutHome.status, 200);
      const signedOutHtml = await signedOutHome.text();
      assert.doesNotMatch(signedOutHtml, new RegExp(`VendorA${tag}`));
      assert.match(signedOutHtml, /aria-label="Giriş"[^>]*href="\/login"/);
    });

    await t.test("customer and seller registration queue encrypted verification without sending email", async () => {
      for (const role of ["customer", "vendor"] as const) {
        const email = `${role}-registration-${tag}@auth-test.invalid`;
        fixtureEmailAddresses.push(email);
        const body = { email, password: correctPassword, firstName: `${role}Reg${tag}`, lastName: "Fixture", ...(role === "vendor" ? { phone: "0500000000" } : {}) };
        const path = role === "customer" ? "/api/auth/register" : "/api/auth/vendor-register";
        const first = await request(path, { method: "POST", headers: { "content-type": "application/json", origin: baseUrl }, body: JSON.stringify(body) });
        assert.equal(first.status, 202);
        const firstBody = await json(first);
        assert.equal(firstBody.requestAccepted, true);
        const verificationCookie = cookiePair(first, "bagati_email_verification");
        const createdUser = await prisma.user.findUnique({ where: { email }, include: { emailVerification: true } });
        assert.ok(createdUser);
        fixtureUserIds.push(createdUser.id);
        assert.equal(createdUser.role, role === "customer" ? "CUSTOMER" : "VENDOR");
        assert.equal(createdUser.emailVerifiedAt, null);
        assert.ok(createdUser.emailVerification);
        const queued = await prisma.emailOutbox.findFirst({ where: { recipient: email, template: "EMAIL_VERIFICATION" } });
        assert.ok(queued);
        assert.equal(queued.status, "PENDING");

        const duplicate = await request(path, { method: "POST", headers: { "content-type": "application/json", origin: baseUrl }, body: JSON.stringify(body) });
        assert.equal(duplicate.status, 202);
        assert.deepEqual(await json(duplicate), firstBody);
        const duplicateVerificationCookie = cookiePair(duplicate, "bagati_email_verification");
        assert.equal(await prisma.user.count({ where: { email } }), 1);
        assert.equal(await prisma.emailOutbox.count({ where: { recipient: email, template: "EMAIL_VERIFICATION" } }), 1);
        const wrongPasswordDuplicate = await request(path, {
          method: "POST",
          headers: { "content-type": "application/json", origin: baseUrl },
          body: JSON.stringify({ ...body, password: wrongPassword }),
        });
        assert.equal(wrongPasswordDuplicate.status, 202);
        assert.deepEqual(await json(wrongPasswordDuplicate), firstBody);

        const userId = createdUser.id;
        const throttledResend = await request("/api/auth/resend-verification", { method: "POST", headers: { origin: baseUrl } }, verificationCookie);
        assert.equal(throttledResend.status, 202);
        assert.equal(await prisma.emailOutbox.count({ where: { recipient: email, template: "EMAIL_VERIFICATION" } }), 1);
        await prisma.emailVerification.update({ where: { userId }, data: { lastSentAt: new Date(Date.now() - 61_000) } });
        const wrongPasswordCookie = cookiePair(wrongPasswordDuplicate, "bagati_email_verification");
        const wrongPasswordResend = await request("/api/auth/resend-verification", { method: "POST", headers: { origin: baseUrl } }, wrongPasswordCookie);
        assert.equal(wrongPasswordResend.status, 202);
        assert.equal(await prisma.emailOutbox.count({ where: { recipient: email, template: "EMAIL_VERIFICATION" } }), 1);
        const resend = await request("/api/auth/resend-verification", { method: "POST", headers: { origin: baseUrl } }, duplicateVerificationCookie);
        assert.equal(resend.status, 202);
        const queuedMessages = await prisma.emailOutbox.findMany({ where: { recipient: email, template: "EMAIL_VERIFICATION" }, orderBy: { createdAt: "asc" } });
        assert.equal(queuedMessages.length, 2);

        const { processEmailOutboxBatch } = await import("../lib/email-outbox-worker");
        const delivered: Array<{ template: string; code: string | undefined }> = [];
        const workerDatabase = {
          emailOutbox: {
            updateMany: (args: Prisma.EmailOutboxUpdateManyArgs) => prisma.emailOutbox.updateMany({
              ...args,
              where: { ...args.where, recipient: email },
            }),
            findMany: (args: Prisma.EmailOutboxFindManyArgs) => prisma.emailOutbox.findMany({
              ...args,
              where: { ...args.where, recipient: email },
            }),
            update: (args: Prisma.EmailOutboxUpdateArgs) => prisma.emailOutbox.update({
              ...args,
              where: { ...args.where, recipient: email },
            }),
          },
          emailVerification: prisma.emailVerification,
          user: prisma.user,
        };
        await prisma.emailOutbox.updateMany({
          where: { id: { in: queuedMessages.map((message) => message.id) }, status: "PENDING" },
          data: { availableAt: new Date(Date.now() - 1_000) },
        });
        const batch = await processEmailOutboxBatch(10, {
          prisma: workerDatabase as never,
          assertSmtpConfigured: () => undefined,
          sendTransactionalEmail: async (template, payload) => {
            delivered.push({ template, code: typeof payload.code === "string" ? payload.code : undefined });
          },
        });
        assert.deepEqual(batch, { processed: 2, sent: 1, failed: 1 });
        assert.equal(delivered.length, 1);
        assert.equal(delivered[0].template, "EMAIL_VERIFICATION");
        assert.match(delivered[0].code || "", /^\d{6}$/);
        const currentVerification = await prisma.emailVerification.findUnique({ where: { userId } });
        assert.ok(currentVerification);
        assert.equal(compareVerificationCode(delivered[0].code!, currentVerification.codeHash), true);
        const staleMessage = await prisma.emailOutbox.findUnique({ where: { id: queuedMessages[0].id }, select: { status: true, lastErrorCode: true, retrySafe: true } });
        assert.deepEqual(staleMessage, { status: "FAILED", lastErrorCode: "VERIFICATION_STALE", retrySafe: false });
        const currentMessage = await prisma.emailOutbox.findUnique({ where: { id: queuedMessages[1].id }, select: { status: true } });
        assert.equal(currentMessage?.status, "SENT");

        const verification = await request("/api/auth/verify-email", { method: "POST", headers: { "content-type": "application/json", origin: baseUrl }, body: JSON.stringify({ code: delivered[0].code }) }, verificationCookie);
        assert.equal(verification.status, 200);
        assert.ok((await prisma.user.findUnique({ where: { email }, select: { emailVerifiedAt: true } }))?.emailVerifiedAt);
        assert.ok(await prisma.emailOutbox.findFirst({ where: { recipient: email, template: role === "customer" ? "WELCOME_CUSTOMER" : "WELCOME_SELLER" } }));
        const verifiedLoginPath = role === "customer" ? "/api/auth/login" : "/api/auth/vendor-login";
        const verifiedLogin = await login(verifiedLoginPath, email, correctPassword);
        assert.equal(verifiedLogin.status, 200);
        assert.equal((await json(verifiedLogin)).user.role, role === "customer" ? "CUSTOMER" : "VENDOR");
      }
    });

    await t.test("verified and cross-role duplicate addresses cannot resume another account verification", async () => {
      const attempts = [
        { path: "/api/auth/register", email: customerA.email, expectedRole: "CUSTOMER" },
        { path: "/api/auth/vendor-register", email: customerA.email, expectedRole: "VENDOR" },
      ] as const;
      for (const attempt of attempts) {
        const response = await request(attempt.path, {
          method: "POST",
          headers: { "content-type": "application/json", origin: baseUrl },
          body: JSON.stringify({
            email: attempt.email,
            password: correctPassword,
            firstName: "Duplicate",
            lastName: "Fixture",
            phone: "0500000000",
          }),
        });
        assert.equal(response.status, 202);
        assert.deepEqual(await json(response), {
          requestAccepted: true,
          verificationPath: attempt.expectedRole === "CUSTOMER" ? "/verify-email" : "/vendor/verify-email",
        });
        const resend = await request("/api/auth/resend-verification", { method: "POST", headers: { origin: baseUrl } }, cookiePair(response, "bagati_email_verification"));
        assert.equal(resend.status, 202);
        assert.equal(await prisma.emailOutbox.count({ where: { recipient: attempt.email, template: "EMAIL_VERIFICATION" } }), 0);
      }
      assert.equal(await prisma.user.count({ where: { email: customerA.email } }), 1);
    });

  } finally {
    if (server && server.exitCode === null) server.kill();
    await cleanFixtures();
    await prisma.$disconnect();
  }
});
