import "dotenv/config";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import bcrypt from "bcryptjs";
import { PrismaClient, type Role } from "@prisma/client";

const TEST_DATABASE_NAME = "bagati_auth_test";
const TEST_SESSION_SECRET = "bagati-isolated-account-switch-browser-secret";
const DIST_DIR = ".next-auth-switch-browser";
const STOP_FILE = resolve(".auth-switch-browser-stop");
const FIXTURE_FILE = resolve(".auth-switch-browser-fixture.json");
const configuredUrl = process.env.DATABASE_URL;
if (!configuredUrl) throw new Error("DATABASE_URL is missing; refusing browser fixture setup.");
const parsedConfiguredUrl = new URL(configuredUrl);
if (parsedConfiguredUrl.hostname !== "localhost" || parsedConfiguredUrl.port !== "5432" || parsedConfiguredUrl.pathname !== "/bagati") {
  throw new Error("Browser fixture requires the expected local BAGATI database configuration; refusing to write.");
}
const testUrl = new URL(parsedConfiguredUrl);
testUrl.pathname = `/${TEST_DATABASE_NAME}`;
process.env.DATABASE_URL = testUrl.toString();
process.env.SESSION_SECRET = TEST_SESSION_SECRET;
const prisma = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
const password = "Isolated-Account-Browser-123!";
const userIds: string[] = [];
let cityId: string | undefined;
let storeId: string | undefined;
let server: ChildProcess | undefined;
let originalNextEnv = "";
let originalTsconfig = "";

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

async function reservePort() {
  const socket = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const address = socket.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a port.");
  await new Promise<void>((done) => socket.close(() => done()));
  return address.port;
}

async function cleanup() {
  if (server && server.exitCode === null) {
    server.kill();
    const deadline = Date.now() + 10_000;
    while (server.exitCode === null && Date.now() < deadline) await delay(100);
  }
  if (storeId) await prisma.store.deleteMany({ where: { id: storeId } });
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  if (cityId) await prisma.city.deleteMany({ where: { id: cityId } });
  await prisma.$disconnect();
  await rm(resolve(DIST_DIR), { recursive: true, force: true });
  await rm(FIXTURE_FILE, { force: true });
  await rm(STOP_FILE, { force: true });
  if (originalNextEnv) await writeFile(new URL("../next-env.d.ts", import.meta.url), originalNextEnv);
  if (originalTsconfig) await writeFile(new URL("../tsconfig.json", import.meta.url), originalTsconfig);
}

async function main() {
  originalNextEnv = await readFile(new URL("../next-env.d.ts", import.meta.url), "utf8");
  originalTsconfig = await readFile(new URL("../tsconfig.json", import.meta.url), "utf8");
  const identity = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  if (identity[0]?.name !== TEST_DATABASE_NAME) throw new Error("Refusing to write outside the dedicated test database.");

const tag = randomUUID().replace(/-/g, "").slice(0, 12).toLowerCase();
try {
  const customerA = await createUser(`browser-customer-a-${tag}@auth-test.invalid`, "CUSTOMER", `BrowserA${tag}`);
  const customerB = await createUser(`browser-customer-b-${tag}@auth-test.invalid`, "CUSTOMER", `BrowserB${tag}`);
  const seller = await createUser(`browser-seller-${tag}@auth-test.invalid`, "VENDOR", `BrowserSeller${tag}`);
  const adminA = await createUser(`browser-admin-a-${tag}@auth-test.invalid`, "ADMIN", `BrowserAdminA${tag}`);
  const adminB = await createUser(`browser-admin-b-${tag}@auth-test.invalid`, "ADMIN", `BrowserAdminB${tag}`);
  cityId = (await prisma.city.create({ data: { name: `Browser switch ${tag}`, slug: `browser-switch-city-${tag}` } })).id;
  storeId = (await prisma.store.create({
    data: { vendorId: seller.vendorProfile!.id, cityId, name: `Browser Store ${tag}`, slug: `browser-store-${tag}` },
  })).id;
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
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
  let ready = false;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error("Temporary BAGATI server exited before becoming ready.");
    try {
      const response = await fetch(baseUrl, { redirect: "manual", signal: AbortSignal.timeout(3_000) });
      if (response.status === 200 && response.headers.get("x-bagati-application") === "bagati-marketplace") {
        ready = true;
        break;
      }
    } catch { /* still compiling */ }
    await delay(500);
  }
  if (!ready) throw new Error("Known BAGATI server identity was not confirmed before timeout.");
  await writeFile(FIXTURE_FILE, JSON.stringify({
    baseUrl,
    password,
    customerA: { email: customerA.email, name: `BrowserA${tag}` },
    customerB: { email: customerB.email, name: `BrowserB${tag}` },
    seller: { email: seller.email, name: `BrowserSeller${tag}`, store: `Browser Store ${tag}` },
    adminA: { email: adminA.email },
    adminB: { email: adminB.email },
  }));
  console.log(`FIXTURE_READY ${baseUrl}`);
  while (server.exitCode === null) {
    try {
      await readFile(STOP_FILE);
      break;
    } catch { /* keep serving */ }
    await delay(500);
  }
} finally {
  await cleanup();
  console.log("FIXTURE_STOPPED");
}
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Browser fixture failed.");
  process.exitCode = 1;
});
