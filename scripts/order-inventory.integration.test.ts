import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import { Prisma, PrismaClient, type Role } from "@prisma/client";

const TEST_DATABASE_NAME = "bagati_auth_test";
const TEST_SESSION_SECRET = "bagati-isolated-order-inventory-test-session-secret";
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

const userIds: string[] = [];
const userEmails: string[] = [];
const storeIds: string[] = [];
const productIds: string[] = [];
const orderIds: string[] = [];
const addressIds: string[] = [];
const uploadedAssetUrls: string[] = [];
let cityId: string | undefined;
let categoryId: string | undefined;
let planId: string | undefined;
let createdPlan = false;
let server: ChildProcess | undefined;
let baseUrl = "";

const password = "Isolated-Order-Test-Password-123!";

function setCookie(response: Response) {
  const value = response.headers.getSetCookie().find((cookie) => cookie.startsWith("bagati_session="));
  assert.ok(value, "login response should set the BAGATI session cookie");
  return value.split(";", 1)[0];
}

async function request(path: string, init: RequestInit = {}, cookie?: string) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  if (init.method && init.method !== "GET") headers.set("origin", baseUrl);
  return fetch(new URL(path, baseUrl), { ...init, headers, cache: "no-store", redirect: "manual" });
}

async function login(path: string, email: string, cookie?: string) {
  const response = await request(path, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ email, password }),
  }, cookie);
  assert.equal(response.status, 200, `fixture ${path} login should succeed`);
  return setCookie(response);
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
    env: {
      ...process.env,
      DATABASE_URL: testUrl.toString(),
      SESSION_SECRET: TEST_SESSION_SECRET,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      BAGATI_STORAGE_DRIVER: "local",
      BAGATI_STORAGE_LOCAL_DURABLE: "true",
    },
    stdio: "ignore",
    windowsHide: true,
  });
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error("Temporary BAGATI server exited before becoming ready.");
    try {
      const response = await fetch(baseUrl, { redirect: "manual", signal: AbortSignal.timeout(2_000) });
      if (response.status === 200 && response.headers.get("x-bagati-application") === "bagati-marketplace") return;
    } catch { /* Wait until the local fixture server is ready. */ }
    await delay(300);
  }
  throw new Error("Known BAGATI server identity was not confirmed before timeout.");
}

async function createUser(email: string, role: Role, displayName: string) {
  userEmails.push(email);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role,
      isActive: true,
      emailVerifiedAt: new Date(),
      ...(role === "CUSTOMER"
        ? { customerProfile: { create: { firstName: displayName, lastName: "Fixture" } }, cart: { create: {} } }
        : {}),
      ...(role === "VENDOR"
        ? { vendorProfile: { create: { displayName, sellerType: "REGISTERED_COMPANY", legalName: displayName, voen: "TEST0000001", legalAddress: "Test legal address" } } }
        : {}),
    },
    include: { vendorProfile: true },
  });
  userIds.push(user.id);
  return user;
}

async function createStore(vendorId: string, suffix: string) {
  assert.ok(cityId && planId);
  const store = await prisma.store.create({
    data: {
      vendorId,
      cityId,
      name: `Order Test Store ${suffix}`,
      slug: `order-test-store-${suffix}`,
      status: "ACTIVE",
      isActive: true,
      legalInfoApproved: true,
      subscription: {
        create: {
          planId,
          status: "ACTIVE",
          startedAt: new Date(Date.now() - 60_000),
          currentPeriodStart: new Date(Date.now() - 60_000),
          currentPeriodEnd: new Date(Date.now() + 86_400_000),
        },
      },
    },
  });
  storeIds.push(store.id);
  return store;
}

async function createProduct(storeId: string, suffix: string, quantity: number) {
  assert.ok(categoryId);
  const product = await prisma.product.create({
    data: {
      storeId,
      categoryId,
      name: `Order Test Product ${suffix}`,
      slug: `order-test-product-${suffix}`,
      sku: `ORDER-${suffix}`,
      price: new Prisma.Decimal("10.00"),
      status: "ACTIVE",
      images: [],
      inventory: { create: { quantity, lowStockThreshold: 1 } },
    },
    include: { inventory: true },
  });
  productIds.push(product.id);
  return product;
}

async function createVariantProduct(storeId: string, suffix: string, quantity: number) {
  const product = await createProduct(storeId, suffix, 0);
  const variant = await prisma.productVariant.create({
    data: {
      productId: product.id,
      name: "Qırmızı / M",
      options: { Rəng: "Qırmızı", Ölçü: "M" },
      price: new Prisma.Decimal("20.00"),
      discountPrice: new Prisma.Decimal("15.00"),
    },
  });
  await prisma.inventory.create({ data: { productId: product.id, variantId: variant.id, quantity, lowStockThreshold: 1 } });
  return { product, variant };
}

async function addToCart(cookie: string, productId: string, quantity: number) {
  const response = await request("/api/cart/items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productId, quantity }),
  }, cookie);
  return response;
}

async function getCart(cookie: string) {
  return request("/api/cart", {}, cookie);
}

async function updateCartItem(cookie: string, itemId: string, quantity: number) {
  return request(`/api/cart/items/${itemId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ quantity }),
  }, cookie);
}

async function removeCartItem(cookie: string, itemId: string) {
  return request(`/api/cart/items/${itemId}`, { method: "DELETE" }, cookie);
}

async function placeOrder(cookie: string, addressId: string) {
  return request("/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ addressId }),
  }, cookie);
}

async function updateVendorOrder(cookie: string, storeId: string, storeOrderId: string, status: string) {
  return request(`/api/vendor/${storeId}/orders`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: storeOrderId, status }),
  }, cookie);
}

async function updateAdminOrder(cookie: string, orderId: string, status: string) {
  return request("/api/admin/orders", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: orderId, status }),
  }, cookie);
}

async function cleanFixtures() {
  if (userEmails.length) await prisma.emailOutbox.deleteMany({ where: { recipient: { in: userEmails } } });
  for (const storeId of storeIds) {
    for (const url of uploadedAssetUrls) {
      const prefix = `/uploads/vendors/${storeId}/`;
      if (!url.startsWith(prefix)) continue;
      const filename = url.slice(prefix.length);
      if (!/^[a-f0-9-]+\.(?:jpg|png|webp)$/i.test(filename)) throw new Error("Refusing to remove an unrecognized test asset path.");
      await unlink(join(process.cwd(), "public", "uploads", "vendors", storeId, filename)).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
    }
  }
  if (orderIds.length) await prisma.auditLog.deleteMany({ where: { entityType: "Order", entityId: { in: orderIds } } });
  if (productIds.length) await prisma.cartItem.deleteMany({ where: { productId: { in: productIds } } });
  if (orderIds.length) await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  if (productIds.length) await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  if (storeIds.length) await prisma.storeSubscription.deleteMany({ where: { storeId: { in: storeIds } } });
  if (storeIds.length) await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
  if (addressIds.length) await prisma.address.deleteMany({ where: { id: { in: addressIds } } });
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  if (planId && createdPlan) await prisma.subscriptionPlan.deleteMany({ where: { id: planId } });
  if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
  if (cityId) await prisma.city.deleteMany({ where: { id: cityId } });

  const [remainingUsers, remainingStores, remainingProducts, remainingOrders, remainingAddresses, remainingCities, remainingCategories, remainingPlans, remainingEmails] = await Promise.all([
    prisma.user.count({ where: { id: { in: userIds } } }),
    prisma.store.count({ where: { id: { in: storeIds } } }),
    prisma.product.count({ where: { id: { in: productIds } } }),
    prisma.order.count({ where: { id: { in: orderIds } } }),
    prisma.address.count({ where: { id: { in: addressIds } } }),
    cityId ? prisma.city.count({ where: { id: cityId } }) : 0,
    categoryId ? prisma.category.count({ where: { id: categoryId } }) : 0,
    planId ? prisma.subscriptionPlan.count({ where: { id: planId } }) : 0,
    userEmails.length ? prisma.emailOutbox.count({ where: { recipient: { in: userEmails } } }) : 0,
  ]);
  assert.deepEqual(
    [remainingUsers, remainingStores, remainingProducts, remainingOrders, remainingAddresses, remainingCities, remainingCategories, remainingPlans, remainingEmails],
    [0, 0, 0, 0, 0, 0, createdPlan ? 0 : 1, 0, 0],
    "isolated integration fixtures must be fully cleaned up",
  );
}

test("database-backed order and inventory flow uses only bagati_auth_test", { timeout: 180_000 }, async (t) => {
  assert.equal(testUrl.hostname, "localhost");
  assert.equal(testUrl.port, "5432");
  assert.equal(testUrl.pathname, `/${TEST_DATABASE_NAME}`);
  const identity = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(identity[0]?.name, TEST_DATABASE_NAME, "refusing to create fixtures outside the dedicated test database");

  const tag = randomUUID().replace(/-/g, "").slice(0, 12).toLowerCase();
  try {
    await prisma.$transaction(async (tx) => {
      cityId = (await tx.city.create({ data: { name: `Order test ${tag}`, slug: `order-test-city-${tag}` } })).id;
      categoryId = (await tx.category.create({ data: { name: `Order test ${tag}`, slug: `order-test-category-${tag}` } })).id;
      const basicPlan = await tx.subscriptionPlan.findUnique({ where: { slug: "basic" } });
      if (basicPlan?.isActive) {
        planId = basicPlan.id;
      } else if (!basicPlan) {
        planId = (await tx.subscriptionPlan.create({ data: { name: `Order test ${tag}`, slug: "basic", monthlyPrice: new Prisma.Decimal("0"), isActive: true } })).id;
        createdPlan = true;
      } else {
        throw new Error("The isolated integration database has an inactive BASIC plan; refusing to modify it.");
      }
    });

    const customerA = await createUser(`order-customer-a-${tag}@auth-test.invalid`, "CUSTOMER", `CustomerA${tag}`);
    const customerB = await createUser(`order-customer-b-${tag}@auth-test.invalid`, "CUSTOMER", `CustomerB${tag}`);
    const vendorA = await createUser(`order-vendor-a-${tag}@auth-test.invalid`, "VENDOR", `VendorA${tag}`);
    const vendorB = await createUser(`order-vendor-b-${tag}@auth-test.invalid`, "VENDOR", `VendorB${tag}`);
    const admin = await createUser(`order-admin-${tag}@auth-test.invalid`, "ADMIN", `Admin${tag}`);
    assert.ok(vendorA.vendorProfile && vendorB.vendorProfile);
    const storeA = await createStore(vendorA.vendorProfile.id, `${tag}-a`);
    const storeB = await createStore(vendorB.vendorProfile.id, `${tag}-b`);
    const deliveryAddress = await prisma.address.create({ data: { userId: customerA.id, cityId: cityId!, recipientName: `CustomerA${tag}`, phone: "000000000", line1: "Isolated test address", isDefault: true } });
    const addressB = await prisma.address.create({ data: { userId: customerB.id, cityId: cityId!, recipientName: `CustomerB${tag}`, phone: "000000000", line1: "Isolated test address", isDefault: true } });
    addressIds.push(deliveryAddress.id, addressB.id);
    const deliveryProduct = await createProduct(storeA.id, `${tag}-delivery`, 10);
    const cancelProduct = await createProduct(storeA.id, `${tag}-cancel`, 10);
    const concurrentCancelProduct = await createProduct(storeA.id, `${tag}-concurrent-cancel`, 10);
    const raceProduct = await createProduct(storeA.id, `${tag}-race`, 5);
    const variantStock = await createVariantProduct(storeA.id, `${tag}-variant`, 2);
    const tagForOrder = randomUUID().slice(0, 12);
    const foreignOrder = await prisma.order.create({
      data: {
        userId: customerB.id,
        subtotal: new Prisma.Decimal("1.00"),
        total: new Prisma.Decimal("1.00"),
        addressSnapshot: { recipientName: "Fixture", phone: "000000000", city: "Test", line1: "Test" },
        payments: { create: { amount: new Prisma.Decimal("1.00"), currency: "AZN", status: "PENDING" } },
        storeOrders: { create: { storeId: storeB.id, status: "NEW", subtotal: new Prisma.Decimal("1.00") } },
      },
      include: { storeOrders: true },
    });
    orderIds.push(foreignOrder.id);
    await startServer();
    const customerCookie = await login("/api/auth/login", customerA.email);
    const customerBCookie = await login("/api/auth/login", customerB.email);
    const vendorCookie = await login("/api/auth/vendor-login", vendorA.email);
    const foreignVendorCookie = await login("/api/auth/vendor-login", vendorB.email);
    const adminCookie = await login("/api/admin/login", admin.email);

    await t.test("store image uploads enforce ownership, MIME signature, decode, and size limits", async () => {
      const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 34, g: 96, b: 112 } } }).png().toBuffer();
      const upload = async (cookie: string, content: Blob, filename: string) => {
        const form = new FormData();
        form.set("file", new File([content], filename, { type: content.type }));
        return request(`/api/vendor/${storeA.id}/assets`, { method: "POST", body: form }, cookie);
      };

      assert.equal((await upload(foreignVendorCookie, new Blob([png], { type: "image/png" }), "foreign.png")).status, 403);
      assert.equal((await upload(vendorCookie, new Blob([png], { type: "text/plain" }), "unsupported.txt")).status, 415);
      assert.equal((await upload(vendorCookie, new Blob([png], { type: "image/jpeg" }), "mismatched.jpg")).status, 415);
      assert.equal((await upload(vendorCookie, new Blob([Buffer.from("corrupt image")], { type: "image/png" }), "corrupt.png")).status, 415);
      assert.equal((await upload(vendorCookie, new Blob([Buffer.alloc(5 * 1024 * 1024 + 1)], { type: "image/png" }), "oversized.png")).status, 413);

      const valid = await upload(vendorCookie, new Blob([png], { type: "image/png" }), "valid.png");
      assert.equal(valid.status, 201);
      const body = await valid.json() as { asset: { url: string; key: string } };
      assert.match(body.asset.url, new RegExp(`^/uploads/vendors/${storeA.id}/`));
      uploadedAssetUrls.push(body.asset.url);
      assert.equal((await request(`/uploads/vendors/${storeA.id}/not-an-image.svg`)).status, 404);
      assert.equal((await request(`/uploads/vendors/${storeA.id}/missing.png`)).status, 404);
      const served = await request(body.asset.url);
      assert.equal(served.status, 200);
      assert.match(served.headers.get("content-type") || "", /image\/png/);
      assert.equal((await served.arrayBuffer()).byteLength > 0, true);

      await prisma.product.update({ where: { id: deliveryProduct.id }, data: { images: [body.asset.url] } });
      const publicProduct = await request(`/api/products/${deliveryProduct.id}`);
      assert.equal(publicProduct.status, 200);
      const productBody = await publicProduct.json() as { item: { images: string[] } };
      assert.deepEqual(productBody.item.images, [body.asset.url]);
    });

    await t.test("seller product creation preserves the form response contract and variant inventory data", async () => {
      const payload = {
        name: `Seller-created product ${tag}`,
        price: 20,
        discountPrice: null,
        quantity: 0,
        lowStockThreshold: 7,
        categoryId,
        brandId: null,
        images: [],
        status: "ACTIVE",
        variants: [{
          name: "Qara / M",
          options: { Rəng: "Qara", Ölçü: "M" },
          sku: `VAR-${tag}`,
          isActive: true,
          price: 18,
          discountPrice: 15,
          images: [],
          quantity: 2,
          lowStockThreshold: 3,
        }, {
          name: "Mavi / L",
          options: { Rəng: "Mavi", Ölçü: "L" },
          sku: `VAR2-${tag}`,
          isActive: true,
          price: null,
          discountPrice: null,
          images: [],
          quantity: 40,
          lowStockThreshold: 2,
        }],
      };
      const response = await request(`/api/vendor/${storeA.id}/products`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }, vendorCookie);
      assert.equal(response.status, 201);
      const body = await response.json() as { product: { id: string } };
      assert.ok(body.product.id, "form redirect target is present in the API response");
      productIds.push(body.product.id);
      const saved = await prisma.product.findUniqueOrThrow({
        where: { id: body.product.id },
        include: { inventory: true, variants: { include: { inventory: true } } },
      });
      assert.equal(saved.inventory.length, 2);
      assert.ok(saved.inventory.every((row) => row.variantId !== null), "variant products use per-variant inventory rows");
      const variant = saved.variants.find((row) => row.sku === `VAR-${tag}`);
      const secondVariant = saved.variants.find((row) => row.sku === `VAR2-${tag}`);
      assert.ok(variant);
      assert.ok(secondVariant);
      assert.equal(Number(variant.price), 18);
      assert.equal(Number(variant.discountPrice), 15);
      assert.deepEqual(variant.images, []);
      assert.equal(variant.inventory[0]?.quantity, 2);
      assert.equal(variant.inventory[0]?.lowStockThreshold, 3);
      assert.equal(secondVariant.inventory[0]?.quantity, 40);
      assert.equal(secondVariant.inventory[0]?.lowStockThreshold, 2);
      const lowStockProducts = await request(`/api/vendor/${storeA.id}/products?stock=low`, {}, vendorCookie);
      assert.equal(lowStockProducts.status, 200);
      const lowStockBody = await lowStockProducts.json() as { items: Array<{ id: string }> };
      assert.ok(lowStockBody.items.some((item) => item.id === body.product.id), "an individually low variant is not hidden by aggregate stock");
      const outOfStockProducts = await request(`/api/vendor/${storeA.id}/products?stock=out`, {}, vendorCookie);
      const outOfStockBody = await outOfStockProducts.json() as { items: Array<{ id: string }> };
      assert.ok(!outOfStockBody.items.some((item) => item.id === body.product.id), "in-stock variants prevent an out-of-stock classification");
      const publicProduct = await request(`/api/products/${body.product.id}`);
      assert.equal(publicProduct.status, 200, "the active seller product is visible to buyers");
      const publicBody = await publicProduct.json() as { item: { variants: Array<{ id: string }> } };
      assert.equal(publicBody.item.variants.length, 2);

      const deliveredAt = new Date();
      const deliveredDate = deliveredAt.toISOString().slice(0, 10);
      const createdDates = [new Date(deliveredAt.getTime() - 7 * 86_400_000), deliveredAt];
      const subtotals = ["4.00", "3.00"];
      for (let index = 0; index < createdDates.length; index++) {
        const createdAt = createdDates[index]!;
        const subtotal = subtotals[index]!;
        const order = await prisma.order.create({
          data: {
            userId: customerA.id,
            status: "DELIVERED",
            subtotal: new Prisma.Decimal(subtotal),
            total: new Prisma.Decimal(subtotal),
            addressSnapshot: { recipientName: "Fixture", phone: "000000000", city: "Test", line1: "Test" },
            createdAt,
            payments: { create: { amount: new Prisma.Decimal(subtotal), currency: "AZN", status: "PAID" } },
            storeOrders: {
              create: {
                storeId: storeA.id,
                status: "DELIVERED",
                subtotal: new Prisma.Decimal(subtotal),
                createdAt,
                deliveredAt: index === 0 ? deliveredAt : null,
                items: {
                  create: {
                    productId: body.product.id,
                    variantId: variant.id,
                    productName: payload.name,
                    variantName: variant.name,
                    variantOptions: { Rəng: "Qara", Ölçü: "M" },
                    unitPrice: new Prisma.Decimal(subtotal),
                    quantity: 1,
                    lineTotal: new Prisma.Decimal(subtotal),
                  },
                },
              },
            },
          },
          select: { id: true },
        });
        orderIds.push(order.id);
      }
      const salesFrom = new Date(deliveredAt.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
      const salesTo = new Date(deliveredAt.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
      const salesResponse = await request(`/api/vendor/${storeA.id}/sales?from=${salesFrom}&to=${salesTo}`, {}, vendorCookie);
      assert.equal(salesResponse.status, 200);
      const sales = await salesResponse.json() as { orders: number; revenue: number; daily: Array<{ date: string; orders: number; revenue: number }> };
      assert.equal(sales.orders, 2, "new deliveredAt records and legacy null deliveredAt records are counted once");
      assert.equal(sales.revenue, 7);
      assert.ok(sales.daily.some((row) => row.date === deliveredDate && row.orders === 2 && row.revenue === 7));

      const editPageData = await request(`/api/vendor/${storeA.id}/products/${body.product.id}`, {}, vendorCookie);
      assert.equal(editPageData.status, 200, "the owner can load the product editor data");
      const foreignEditPageData = await request(`/api/vendor/${storeA.id}/products/${body.product.id}`, {}, foreignVendorCookie);
      assert.equal(foreignEditPageData.status, 403, "another store owner cannot load this product editor");
      const editedName = `Edited seller-created product ${tag}`;
      const editResponse = await request(`/api/vendor/${storeA.id}/products/${body.product.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: editedName,
          description: null,
          sku: null,
          price: 20,
          discountPrice: null,
          categoryId,
          brandId: null,
          images: [],
          status: "ACTIVE",
          variantsEnabled: true,
          variants: saved.variants.map((item) => ({
            id: item.id,
            name: item.name,
            sku: item.sku,
            options: item.options,
            isActive: item.isActive,
            price: item.price == null ? null : Number(item.price),
            discountPrice: item.discountPrice == null ? null : Number(item.discountPrice),
            images: item.images,
            quantity: item.inventory[0]?.quantity ?? 0,
            lowStockThreshold: item.inventory[0]?.lowStockThreshold ?? 5,
          })),
        }),
      }, vendorCookie);
      assert.equal(editResponse.status, 200);
      const editBody = await editResponse.json() as { product: { name: string } };
      assert.equal(editBody.product.name, editedName);
      const foreignEdit = await request(`/api/vendor/${storeA.id}/products/${body.product.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: editedName }),
      }, foreignVendorCookie);
      assert.equal(foreignEdit.status, 403, "another store owner cannot edit this product");
      const updatedPublicProduct = await request(`/api/products/${body.product.id}`);
      assert.equal((await updatedPublicProduct.json() as { item: { name: string } }).item.name, editedName);
      const archiveResponse = await request(`/api/vendor/${storeA.id}/products/${body.product.id}`, { method: "DELETE" }, vendorCookie);
      assert.equal(archiveResponse.status, 200);
      assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: body.product.id } })).status, "ARCHIVED");
      assert.equal((await request(`/api/products/${body.product.id}`)).status, 404, "archived products are no longer public");

      const duplicate = await request(`/api/vendor/${storeA.id}/products`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...payload,
          name: `Duplicate variants ${tag}`,
          variants: [payload.variants[0], { ...payload.variants[0], name: "Duplicate" }],
        }),
      }, vendorCookie);
      assert.equal(duplicate.status, 422, "duplicate combinations are rejected before persistence");
    });

    await t.test("customer cart quantity, removal errors, order ownership, and vendor store scope", async () => {
      assert.equal((await placeOrder(customerCookie, addressB.id)).status, 404);
      assert.equal((await addToCart(customerCookie, cancelProduct.id, 2)).status, 201);
      const cartResponse = await getCart(customerCookie);
      assert.equal(cartResponse.status, 200);
      const cartBody = await cartResponse.json() as { cart: { items: Array<{ id: string; quantity: number }> } };
      assert.equal(cartBody.cart.items.length, 1);
      assert.equal(cartBody.cart.items[0]?.quantity, 2);
      const cartItemId = cartBody.cart.items[0]!.id;
      assert.equal((await updateCartItem(customerCookie, cartItemId, 3)).status, 200);
      const updatedCart = await (await getCart(customerCookie)).json() as { cart: { items: Array<{ quantity: number }> } };
      assert.equal(updatedCart.cart.items[0]?.quantity, 3);
      assert.equal((await removeCartItem(customerCookie, cartItemId)).status, 200);
      const missingItem = await removeCartItem(customerCookie, cartItemId);
      assert.equal(missingItem.status, 404);
      assert.equal((await missingItem.json() as { error: string }).error, "Məhsul səbətdə tapılmadı.");

      const ownOrdersResponse = await request("/api/orders", {}, customerCookie);
      const ownOrders = await ownOrdersResponse.json() as { items: Array<{ id: string }> };
      assert.equal(ownOrdersResponse.status, 200);
      assert.ok(!ownOrders.items.some((order) => order.id === foreignOrder.id));
      const foreignDetail = await request(`/orders/${foreignOrder.id}`, {}, customerCookie);
      assert.equal(foreignDetail.status, 404);

      const sellerOrders = await request(`/api/vendor/${storeA.id}/orders`, {}, vendorCookie);
      assert.equal(sellerOrders.status, 200);
      const sellerOrderList = await sellerOrders.json() as { items: Array<{ order: { id: string } }> };
      assert.ok(!sellerOrderList.items.some((order) => order.order.id === foreignOrder.id));
    });

    await t.test("variant stock and server price determine the store order and immutable variant snapshot", async () => {
      const missingVariant = await addToCart(customerCookie, variantStock.product.id, 1);
      assert.equal(missingVariant.status, 422);
      const unavailableVariant = await request("/api/cart/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId: variantStock.product.id, variantId: "not-a-variant-of-this-product", quantity: 1 }),
      }, customerCookie);
      assert.equal(unavailableVariant.status, 422);
      const outOfStock = await request("/api/cart/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId: variantStock.product.id, variantId: variantStock.variant.id, quantity: 3 }),
      }, customerCookie);
      assert.equal(outOfStock.status, 409);
      const added = await request("/api/cart/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId: variantStock.product.id, variantId: variantStock.variant.id, quantity: 1, unitPrice: 0.01 }),
      }, customerCookie);
      assert.equal(added.status, 201);
      const cart = await (await getCart(customerCookie)).json() as { cart: { items: Array<{ id: string; effectivePrice: string; variantId: string }> } };
      assert.equal(cart.cart.items[0]?.effectivePrice, "15.00");
      assert.equal(cart.cart.items[0]?.variantId, variantStock.variant.id);

      const forgedPrice = await request("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addressId: deliveryAddress.id, expectedPrices: [{ cartItemId: cart.cart.items[0]!.id, unitPrice: 1 }] }),
      }, customerCookie);
      assert.equal(forgedPrice.status, 409);
      const response = await placeOrder(customerCookie, deliveryAddress.id);
      assert.equal(response.status, 201);
      const body = await response.json() as { order: { id: string; subtotal: string; storeOrders: Array<{ storeId: string; items: Array<{ variantId: string; variantName: string; variantOptions: Record<string, string>; unitPrice: string }> }> } };
      orderIds.push(body.order.id);
      assert.equal(Number(body.order.subtotal), 15);
      assert.equal(body.order.storeOrders[0]?.storeId, storeA.id);
      assert.equal(body.order.storeOrders[0]?.items[0]?.variantId, variantStock.variant.id);
      assert.equal(body.order.storeOrders[0]?.items[0]?.variantName, "Qırmızı / M");
      assert.deepEqual(body.order.storeOrders[0]?.items[0]?.variantOptions, { Rəng: "Qırmızı", Ölçü: "M" });
      assert.equal(Number(body.order.storeOrders[0]?.items[0]?.unitPrice), 15);
      assert.equal((await prisma.inventory.findFirstOrThrow({ where: { productId: variantStock.product.id, variantId: variantStock.variant.id } })).quantity, 1);
    });

    await t.test("checkout deducts stock once and pending payment blocks vendor/admin delivery", async () => {
      assert.equal((await addToCart(customerCookie, deliveryProduct.id, 2)).status, 201);
      const response = await placeOrder(customerCookie, deliveryAddress.id);
      assert.equal(response.status, 201);
      const body = await response.json() as { order: { id: string; status: string; addressSnapshot: { recipientName: string; phone: string; line1: string }; payments: Array<{ status: string }>; storeOrders: Array<{ id: string; status: string }> } };
      orderIds.push(body.order.id);
      const repeatedSubmission = await placeOrder(customerCookie, deliveryAddress.id);
      assert.equal(repeatedSubmission.status, 409);
      assert.equal(await prisma.order.count({ where: { id: body.order.id, userId: customerA.id } }), 1);
      assert.equal(body.order.status, "PENDING");
      assert.deepEqual(
        { recipientName: body.order.addressSnapshot.recipientName, phone: body.order.addressSnapshot.phone, line1: body.order.addressSnapshot.line1 },
        { recipientName: deliveryAddress.recipientName, phone: deliveryAddress.phone, line1: deliveryAddress.line1 },
      );
      assert.equal(body.order.payments[0]?.status, "PENDING");
      assert.equal(Number((await prisma.inventory.findFirstOrThrow({ where: { productId: deliveryProduct.id } })).quantity), 8);
      assert.equal(await prisma.inventoryAdjustment.count({ where: { inventory: { productId: deliveryProduct.id }, delta: -2 } }), 1);

      const storeOrderId = body.order.storeOrders[0]!.id;
      const vendorOrders = await request(`/api/vendor/${storeA.id}/orders`, {}, vendorCookie);
      assert.equal(vendorOrders.status, 200);
      const vendorOrderList = await vendorOrders.json() as { items: Array<{ id: string }> };
      assert.ok(vendorOrderList.items.some((item) => item.id === storeOrderId));
      for (const status of ["CONFIRMED", "PREPARING", "READY", "HANDED_TO_COURIER"]) {
        const transition = await updateVendorOrder(vendorCookie, storeA.id, storeOrderId, status);
        assert.equal(transition.status, 200, `vendor transition to ${status}`);
      }
      assert.equal((await updateVendorOrder(vendorCookie, storeA.id, storeOrderId, "DELIVERED")).status, 409);
      assert.equal((await updateAdminOrder(adminCookie, body.order.id, "DELIVERED")).status, 409);
      const current = await prisma.storeOrder.findUniqueOrThrow({ where: { id: storeOrderId }, include: { order: { include: { payments: true } } } });
      assert.equal(current.status, "HANDED_TO_COURIER");
      assert.equal(current.order.payments[0]?.status, "PENDING");
    });

    await t.test("admin cancellation restores its stock once; repeated cancellation does not over-restore", async () => {
      assert.equal((await addToCart(customerCookie, cancelProduct.id, 3)).status, 201);
      const response = await placeOrder(customerCookie, deliveryAddress.id);
      assert.equal(response.status, 201);
      const body = await response.json() as { order: { id: string; storeOrders: Array<{ id: string }> } };
      orderIds.push(body.order.id);
      assert.equal(Number((await prisma.inventory.findFirstOrThrow({ where: { productId: cancelProduct.id } })).quantity), 7);
      assert.equal((await updateAdminOrder(adminCookie, body.order.id, "CANCELLED")).status, 200);
      assert.equal(Number((await prisma.inventory.findFirstOrThrow({ where: { productId: cancelProduct.id } })).quantity), 10);
      assert.equal(await prisma.inventoryAdjustment.count({ where: { inventory: { productId: cancelProduct.id }, delta: 3 } }), 1);
      assert.equal((await updateAdminOrder(adminCookie, body.order.id, "CANCELLED")).status, 409);
      assert.equal((await updateVendorOrder(vendorCookie, storeA.id, body.order.storeOrders[0]!.id, "CANCELLED")).status, 409);
      assert.equal(Number((await prisma.inventory.findFirstOrThrow({ where: { productId: cancelProduct.id } })).quantity), 10);
      assert.equal(await prisma.inventoryAdjustment.count({ where: { inventory: { productId: cancelProduct.id }, delta: 3 } }), 1);
    });

    await t.test("concurrent admin/vendor cancellation restores the stock exactly once", async () => {
      assert.equal((await addToCart(customerCookie, concurrentCancelProduct.id, 4)).status, 201);
      const response = await placeOrder(customerCookie, deliveryAddress.id);
      assert.equal(response.status, 201);
      const body = await response.json() as { order: { id: string; storeOrders: Array<{ id: string }> } };
      orderIds.push(body.order.id);
      const results = await Promise.all([
        updateAdminOrder(adminCookie, body.order.id, "CANCELLED"),
        updateVendorOrder(vendorCookie, storeA.id, body.order.storeOrders[0]!.id, "CANCELLED"),
      ]);
      assert.equal(results.filter((result) => result.status === 200).length, 1);
      assert.equal(results.filter((result) => result.status === 409).length, 1);
      assert.equal(Number((await prisma.inventory.findFirstOrThrow({ where: { productId: concurrentCancelProduct.id } })).quantity), 10);
      assert.equal(await prisma.inventoryAdjustment.count({ where: { inventory: { productId: concurrentCancelProduct.id }, delta: 4 } }), 1);
    });

    await t.test("concurrent checkout requests cannot sell more stock than available", async () => {
      assert.equal((await addToCart(customerCookie, raceProduct.id, 4)).status, 201);
      assert.equal((await addToCart(customerBCookie, raceProduct.id, 4)).status, 201);
      const results = await Promise.all([
        placeOrder(customerCookie, deliveryAddress.id),
        placeOrder(customerBCookie, addressB.id),
      ]);
      const successful = results.filter((result) => result.status === 201);
      const rejected = results.filter((result) => result.status === 409);
      assert.equal(successful.length, 1);
      assert.equal(rejected.length, 1);
      const successfulBody = await successful[0]!.json() as { order: { id: string } };
      orderIds.push(successfulBody.order.id);
      assert.equal(Number((await prisma.inventory.findFirstOrThrow({ where: { productId: raceProduct.id } })).quantity), 1);
      assert.equal(await prisma.inventoryAdjustment.count({ where: { inventory: { productId: raceProduct.id }, delta: -4 } }), 1);
    });

    await t.test("vendor store ownership and admin role authorization remain enforced", async () => {
      const forbiddenVendorRoute = await updateVendorOrder(foreignVendorCookie, storeA.id, foreignOrder.storeOrders[0]!.id, "CANCELLED");
      assert.equal(forbiddenVendorRoute.status, 403);
      assert.equal((await updateVendorOrder(vendorCookie, storeB.id, foreignOrder.storeOrders[0]!.id, "CANCELLED")).status, 403);
      assert.equal((await updateAdminOrder(customerCookie, foreignOrder.id, "CANCELLED")).status, 403);
      assert.equal((await updateAdminOrder(vendorCookie, foreignOrder.id, "CANCELLED")).status, 403);
      assert.equal((await updateAdminOrder(adminCookie, foreignOrder.id, "CANCELLED")).status, 200);
    });
  } finally {
    if (server && server.exitCode === null) server.kill();
    try { await cleanFixtures(); } finally { await prisma.$disconnect(); }
  }
});
