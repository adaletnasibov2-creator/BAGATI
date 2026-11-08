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
import sharp from "sharp";
import { Prisma, PrismaClient, type Role } from "@prisma/client";

const TEST_DATABASE_NAME = "bagati_auth_test";
const TEST_SESSION_SECRET = "bagati-isolated-stock-session-test-secret-32";
const DIST_DIR = ".next-stock-session-verify";
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

const password = "Isolated-Stock-Session-123!";
const userIds: string[] = [];
const storeIds: string[] = [];
const productIds: string[] = [];
const uploadedFiles: string[] = [];
let cityId: string | undefined;
let categoryId: string | undefined;
let planId: string | undefined;
let createdPlan = false;
let server: ChildProcess | undefined;
let baseUrl = "";
let originalNextEnv = "";
let originalTsconfig = "";

function cookiePair(response: Response) {
  const value = response.headers.getSetCookie().find((cookie) => cookie.startsWith("bagati_session="));
  assert.ok(value, "response should set bagati_session");
  return value.split(";", 1)[0];
}

async function request(path: string, init: RequestInit = {}, cookie?: string) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  if (init.method && init.method !== "GET" && init.method !== "HEAD") headers.set("origin", baseUrl);
  return fetch(new URL(path, baseUrl), { ...init, headers, cache: "no-store", redirect: "manual" });
}

async function login(path: string, email: string) {
  const response = await request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, await response.text());
  return cookiePair(response);
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
      BAGATI_STORAGE_DRIVER: "local",
      BAGATI_STORAGE_LOCAL_DURABLE: "true",
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

function standardQuantity(product: { inventory?: Array<{ variantId: string | null; quantity: number }> }) {
  const row = product.inventory?.find((item) => item.variantId === null);
  assert.ok(row, "standard inventory row should exist");
  return row.quantity;
}

test("isolated stock updates and session revocation stay on bagati_auth_test", { timeout: 240_000 }, async () => {
  originalNextEnv = await readFile(new URL("../next-env.d.ts", import.meta.url), "utf8");
  originalTsconfig = await readFile(new URL("../tsconfig.json", import.meta.url), "utf8");
  assert.equal(testUrl.hostname, "localhost");
  assert.equal(testUrl.port, "5432");
  assert.equal(testUrl.pathname, `/${TEST_DATABASE_NAME}`);
  const identity = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(identity[0]?.name, TEST_DATABASE_NAME, "refusing to write outside the dedicated test database");

  const tag = randomUUID().replace(/-/g, "").slice(0, 12).toLowerCase();
  try {
    await prisma.$transaction(async (tx) => {
      cityId = (await tx.city.create({ data: { name: `Stock test ${tag}`, slug: `stock-test-city-${tag}` } })).id;
      categoryId = (await tx.category.create({ data: { name: `Stock test ${tag}`, slug: `stock-test-category-${tag}` } })).id;
      const basicPlan = await tx.subscriptionPlan.findUnique({ where: { slug: "basic" } });
      if (basicPlan?.isActive) planId = basicPlan.id;
      else if (!basicPlan) {
        planId = (await tx.subscriptionPlan.create({ data: { name: `Stock test ${tag}`, slug: "basic", monthlyPrice: new Prisma.Decimal("0"), isActive: true } })).id;
        createdPlan = true;
      } else throw new Error("The isolated integration database has an inactive BASIC plan; refusing to modify it.");
    });
    assert.ok(cityId && categoryId && planId);

    const customer = await createUser(`stock-customer-${tag}@auth-test.invalid`, "CUSTOMER", `Customer${tag}`);
    const vendor = await createUser(`stock-vendor-${tag}@auth-test.invalid`, "VENDOR", `Vendor${tag}`);
    const admin = await createUser(`stock-admin-${tag}@auth-test.invalid`, "ADMIN", `Admin${tag}`);
    const store = await prisma.store.create({
      data: {
        vendorId: vendor.vendorProfile!.id,
        cityId,
        name: `Stock Test Store ${tag}`,
        slug: `stock-test-store-${tag}`,
        status: "ACTIVE",
        isActive: true,
        legalInfoApproved: true,
        subscription: { create: { planId, status: "ACTIVE", startedAt: new Date(), currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 86_400_000) } },
      },
    });
    storeIds.push(store.id);
    await startServer();

    const wrong = await request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: customer.email, password: "wrong-password-123456" }) });
    assert.equal(wrong.status, 401);
    const customerCookie = await login("/api/auth/login", customer.email);
    const vendorOnCustomer = await request("/api/auth/vendor-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: customer.email, password }) });
    assert.equal(vendorOnCustomer.status, 401);
    const vendorCookie = await login("/api/auth/vendor-login", vendor.email);
    const adminOnVendor = await request("/api/auth/vendor-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: admin.email, password }) });
    assert.equal(adminOnVendor.status, 401);
    const adminCookie = await login("/api/admin/login", admin.email);

    assert.equal((await request("/orders", {}, customerCookie)).status, 200);
    assert.equal((await request("/vendor", {}, vendorCookie)).status, 200);
    assert.equal((await request("/admin", {}, adminCookie)).status, 200);
    assert.notEqual((await request("/vendor", {}, customerCookie)).status, 200);
    assert.notEqual((await request("/orders", {}, vendorCookie)).status, 200);
    assert.notEqual((await request("/admin", {}, vendorCookie)).status, 200);
    assert.notEqual((await request("/orders", {}, adminCookie)).status, 200);

    const created = await request(`/api/vendor/${store.id}/products`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: `Stock product ${tag}`, price: 15, categoryId, quantity: 14, lowStockThreshold: 2, status: "DRAFT", variantsEnabled: false, variants: [] }),
    }, vendorCookie);
    assert.equal(created.status, 201, await created.clone().text());
    const createdBody = await created.json() as { product: { id: string } };
    productIds.push(createdBody.product.id);
    const persistedCreate = await prisma.inventory.findFirstOrThrow({ where: { productId: createdBody.product.id, variantId: null } });
    assert.equal(persistedCreate.quantity, 14);

    const basePatch = { name: `Stock product ${tag}`, description: null, sku: null, price: 15, discountPrice: null, categoryId, brandId: null, images: [], status: "DRAFT", variantsEnabled: false, variants: [] };
    const renamed = await request(`/api/vendor/${store.id}/products/${createdBody.product.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...basePatch, name: `Renamed ${tag}` }),
    }, vendorCookie);
    assert.equal(renamed.status, 200, await renamed.clone().text());
    assert.equal((await prisma.inventory.findFirstOrThrow({ where: { id: persistedCreate.id } })).quantity, 14);

    const repriced = await request(`/api/vendor/${store.id}/products/${createdBody.product.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...basePatch, name: `Renamed ${tag}`, price: 21 }),
    }, vendorCookie);
    assert.equal(repriced.status, 200, await repriced.clone().text());
    assert.equal((await prisma.inventory.findFirstOrThrow({ where: { id: persistedCreate.id } })).quantity, 14);

    const emptied = await request(`/api/vendor/${store.id}/products/${createdBody.product.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...basePatch, name: `Renamed ${tag}`, price: 21, quantity: "" }),
    }, vendorCookie);
    assert.equal(emptied.status, 422);
    const missing = await request(`/api/vendor/${store.id}/products/${createdBody.product.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...basePatch, name: `Renamed ${tag}`, price: 21 }),
    }, vendorCookie);
    assert.equal(missing.status, 200);
    const invalid = await request(`/api/vendor/${store.id}/products/${createdBody.product.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...basePatch, name: `Renamed ${tag}`, price: 21, quantity: "1.5" }),
    }, vendorCookie);
    assert.equal(invalid.status, 422);
    assert.equal((await prisma.inventory.findFirstOrThrow({ where: { id: persistedCreate.id } })).quantity, 14);

    const zeroed = await request(`/api/vendor/${store.id}/products/${createdBody.product.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...basePatch, name: `Renamed ${tag}`, price: 21, quantity: 0 }),
    }, vendorCookie);
    assert.equal(zeroed.status, 200, await zeroed.clone().text());
    assert.equal((await prisma.inventory.findFirstOrThrow({ where: { id: persistedCreate.id } })).quantity, 0);
    const reloaded = await request(`/api/vendor/${store.id}/products/${createdBody.product.id}`, {}, vendorCookie);
    assert.equal(reloaded.status, 200);
    assert.equal(standardQuantity((await reloaded.json()).product), 0);

    const restocked = await request(`/api/vendor/${store.id}/inventory`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: persistedCreate.id, quantity: 9, lowStockThreshold: 2, reason: "Isolated stock correction" }),
    }, vendorCookie);
    assert.equal(restocked.status, 200, await restocked.clone().text());
    const blankInventory = await request(`/api/vendor/${store.id}/inventory`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: persistedCreate.id, quantity: "", reason: "Blank must fail" }),
    }, vendorCookie);
    assert.equal(blankInventory.status, 422);
    assert.equal((await prisma.inventory.findFirstOrThrow({ where: { id: persistedCreate.id } })).quantity, 9);

    const withVariant = await request(`/api/vendor/${store.id}/products/${createdBody.product.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...basePatch,
        name: `Renamed ${tag}`,
        price: 21,
        variantsEnabled: true,
        variants: [{ name: "Medium", sku: null, options: { size: "M" }, isActive: true, price: null, discountPrice: null, images: [], quantity: 6, lowStockThreshold: 1 }],
      }),
    }, vendorCookie);
    assert.equal(withVariant.status, 200, await withVariant.clone().text());
    const variantStock = await prisma.inventory.findFirstOrThrow({ where: { productId: createdBody.product.id, variantId: { not: null } } });
    assert.equal(variantStock.quantity, 6);
    const variantBlank = await request(`/api/vendor/${store.id}/products/${createdBody.product.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...basePatch,
        name: `Renamed ${tag}`,
        price: 21,
        variantsEnabled: true,
        variants: [{ id: variantStock.variantId, name: "Medium", sku: null, options: { size: "M" }, isActive: true, price: null, discountPrice: null, images: [], quantity: "", lowStockThreshold: 1 }],
      }),
    }, vendorCookie);
    assert.equal(variantBlank.status, 422);
    assert.equal((await prisma.inventory.findFirstOrThrow({ where: { id: variantStock.id } })).quantity, 6);

    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 20, g: 80, b: 60 } } }).jpeg().toBuffer();
    const form = new FormData();
    form.set("file", new File([new Uint8Array(image)], "fixture.jpg", { type: "image/jpeg" }));
    const uploaded = await request(`/api/vendor/${store.id}/assets`, { method: "POST", body: form }, vendorCookie);
    assert.equal(uploaded.status, 201, await uploaded.clone().text());
    const uploadedBody = await uploaded.json() as { asset?: { url?: string } };
    const uploadedUrl = uploadedBody.asset?.url;
    assert.match(uploadedUrl ?? "", new RegExp(`^/uploads/vendors/${store.id}/`));
    uploadedFiles.push(resolve("public", uploadedUrl!.slice(1)));

    for (const [cookie, path] of [[customerCookie, "/orders"], [vendorCookie, "/vendor"], [adminCookie, "/admin"]] as const) {
      const before = await prisma.authSession.count({ where: { userId: cookie === customerCookie ? customer.id : cookie === vendorCookie ? vendor.id : admin.id, revokedAt: null } });
      assert.equal(before, 1);
      const logout = await request("/api/auth/logout", { method: "POST" }, cookie);
      assert.equal(logout.status, 200);
      const deletion = logout.headers.getSetCookie().find((item) => item.startsWith("bagati_session="));
      assert.ok(deletion);
      assert.match(deletion, /Expires=Thu, 01 Jan 1970/i);
      assert.match(deletion, /Max-Age=0/);
      assert.match(deletion, /HttpOnly/i);
      assert.match(deletion, /Path=\//);
      const userId = cookie === customerCookie ? customer.id : cookie === vendorCookie ? vendor.id : admin.id;
      const session = await prisma.authSession.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: "desc" } });
      assert.ok(session.revokedAt);
      const again = await request(path, {}, cookie);
      assert.notEqual(again.status, 200);
      const refreshed = await request(path, {}, cookie);
      assert.notEqual(refreshed.status, 200);
    }

    const customerAgain = await login("/api/auth/login", customer.email);
    const vendorAgain = await login("/api/auth/vendor-login", vendor.email);
    const adminAgain = await login("/api/admin/login", admin.email);
    assert.equal((await request("/orders", {}, customerAgain)).status, 200);
    assert.equal((await request("/vendor", {}, vendorAgain)).status, 200);
    assert.equal((await request("/admin", {}, adminAgain)).status, 200);
    const vendorPage = await (await request("/vendor", {}, vendorAgain)).text();
    assert.match(vendorPage, new RegExp(`Stock Test Store ${tag}`));
    assert.doesNotMatch(vendorPage, new RegExp(`Customer${tag}`));
    assert.equal((await prisma.inventory.findFirstOrThrow({ where: { id: persistedCreate.id } })).quantity, 9);
  } finally {
    await stopServer();
    for (const file of uploadedFiles) await rm(file, { force: true });
    if (productIds.length) await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    if (storeIds.length) await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (createdPlan && planId) await prisma.subscriptionPlan.deleteMany({ where: { id: planId } });
    if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
    if (cityId) await prisma.city.deleteMany({ where: { id: cityId } });
    await prisma.$disconnect();
    await rm(resolve(DIST_DIR), { recursive: true, force: true });
    if (originalNextEnv) await writeFile(new URL("../next-env.d.ts", import.meta.url), originalNextEnv);
    if (originalTsconfig) await writeFile(new URL("../tsconfig.json", import.meta.url), originalTsconfig);
  }
});
