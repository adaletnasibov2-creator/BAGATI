/**
 * Admin login per-IP limits against the isolated verification PostgreSQL cluster, through the real route handler.
 *
 * Safety: uses ONLY BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL and refuses unless the host is loopback, the port is
 * exactly 5433 and the database name contains "verify". DATABASE_URL is overwritten in-process before lib/prisma is
 * imported; .env is never read. A throwaway SESSION_SECRET makes every rate-limit key unique to this run. Telemetry
 * is intercepted in-process (nothing is flushed). Fixture rows are removed in `finally`. Skips (NOT VERIFIED) when
 * the cluster is unreachable; it never migrates.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";

const VERIFY_URL_ENV = "BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL";
const TEST_IPS = ["203.0.113.71", "203.0.113.72", "203.0.113.73"];

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

test("admin login: per-IP limit, shared stricter unknown-IP limit, per-account limit, window reset, telemetry group", { timeout: 180_000 }, async (t) => {
  const guard = guardedVerifyUrl();
  if ("skip" in guard) return t.skip(`NOT VERIFIED: ${guard.skip}`);
  if ("refuse" in guard) throw new Error(`Refusing to run: ${guard.refuse}.`);
  process.env.DATABASE_URL = guard.url;
  process.env.SESSION_SECRET = randomBytes(32).toString("hex");
  delete process.env.BAGATI_ADMIN_2FA_REQUIRED;
  delete process.env.BAGATI_TRUST_CLOUDFLARE_IP;

  const prisma = new PrismaClient({ datasources: { db: { url: guard.url } } });
  const tag = randomUUID().replace(/-/g, "").slice(0, 10);
  const startedAt = new Date(Date.now() - 1000);
  const keys: string[] = [];
  let adminId = "";
  try {
    try { await prisma.$queryRaw`SELECT 1`; } catch { return t.skip("NOT VERIFIED: verify database on 127.0.0.1:5433 is unreachable"); }
    const [where] = await prisma.$queryRaw<{ db: string; port: number }[]>`SELECT current_database() AS db, inet_server_port() AS port`;
    assert.ok(where.db.includes("verify"));
    assert.equal(Number(where.port), 5433);

    const { NextRequest } = await import("next/server");
    const bcrypt = (await import("bcryptjs")).default;
    const { securityTelemetry } = await import("../lib/security-monitoring/instance");
    const { authRateLimitKey } = await import("../lib/auth-rate-limit");
    const { adminLoginIpBucket, ADMIN_LOGIN_IP_RATE_LIMIT, ADMIN_LOGIN_UNKNOWN_IP_RATE_LIMIT } = await import("../lib/admin-login-rate-limit");
    const { POST } = await import("../app/api/admin/login/route");

    // Telemetry spy: count per route group in-process; nothing reaches the database.
    const loginFailures = new Map<string, number>();
    const responses: Array<{ group: string; status: number }> = [];
    securityTelemetry.recordLoginFailure = (group: string) => { loginFailures.set(group, (loginFailures.get(group) ?? 0) + 1); };
    securityTelemetry.recordResponse = (group: string, status: number) => { responses.push({ group, status }); };

    const password = `Verify-${tag}-password`;
    const admin = await prisma.user.create({ data: { email: `entry-${tag}@verify.invalid`, passwordHash: await bcrypt.hash(password, 10), role: "ADMIN", emailVerifiedAt: new Date() } });
    adminId = admin.id;

    const attempt = (body: { email: string; password: string }, ip?: string, extra: Record<string, string> = {}) => POST(new NextRequest("http://localhost:3000/api/admin/login", {
      method: "POST",
      headers: { host: "localhost:3000", "content-type": "application/json", ...(ip ? { "cf-connecting-ip": ip } : {}), ...extra },
      body: JSON.stringify(body),
    }));
    const wrongPassword = randomUUID();
    const stranger = (index: number) => ({ email: `nobody-${tag}-${index}@verify.invalid`, password: wrongPassword });
    const bucketKey = (ip: string | null) => adminLoginIpBucket(new Headers(ip ? { "cf-connecting-ip": ip } : {}), ip !== null).key;
    const expireWindow = (key: string) => prisma.$executeRaw(Prisma.sql`UPDATE "AuthRateLimit" SET "windowStartedAt" = "windowStartedAt" - interval '16 minutes' WHERE "keyHash" = ${key}`);
    keys.push(bucketKey(TEST_IPS[0]), bucketKey(TEST_IPS[1]), bucketKey(TEST_IPS[2]), bucketKey(null), authRateLimitKey("login", admin.email));
    for (let index = 0; index < 40; index += 1) keys.push(authRateLimitKey("login", stranger(index).email));

    await t.test("per IP: 20 attempts in the window, then 429 with an Azerbaijani message and Retry-After; another IP is unaffected", async () => {
      process.env.BAGATI_TRUST_CLOUDFLARE_IP = "true";
      for (let index = 0; index < ADMIN_LOGIN_IP_RATE_LIMIT.limit; index += 1) {
        assert.equal((await attempt(stranger(index), TEST_IPS[0])).status, 401, `attempt ${index + 1}`);
      }
      const limited = await attempt(stranger(20), TEST_IPS[0]);
      assert.equal(limited.status, 429);
      assert.equal(limited.headers.get("retry-after"), "900");
      assert.deepEqual(await limited.json(), { error: "Çox sayda giriş cəhdi edildi. 15 dəqiqə sonra yenidən yoxlayın.", code: "RATE_LIMITED" });
      assert.equal((await attempt(stranger(21), TEST_IPS[1])).status, 401, "a different IP still reaches the password check");
      // Even the right password is refused from the limited IP inside the window...
      assert.equal((await attempt({ email: admin.email, password }, TEST_IPS[0])).status, 429);
      // ...and accepted once the window has passed: no permanent lockout.
      await expireWindow(bucketKey(TEST_IPS[0]));
      const ok = await attempt({ email: admin.email, password }, TEST_IPS[0]);
      assert.equal(ok.status, 200);
      const rows = await prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM "AuthRateLimit" WHERE "keyHash" = ${bucketKey(TEST_IPS[0])}`);
      assert.equal(rows[0].n, 0, "a correct admin password clears this IP's bucket");
      await prisma.authSession.deleteMany({ where: { userId: admin.id } });
    });

    await t.test("unknown client IP: one shared bucket of 10 (flag off, missing header, header mismatch)", async () => {
      delete process.env.BAGATI_TRUST_CLOUDFLARE_IP;
      for (let index = 0; index < ADMIN_LOGIN_UNKNOWN_IP_RATE_LIMIT.limit; index += 1) {
        const ip = index % 2 === 0 ? TEST_IPS[2] : undefined; // flag off: the header is ignored either way
        assert.equal((await attempt(stranger(22 + index), ip)).status, 401, `attempt ${index + 1}`);
      }
      assert.equal((await attempt(stranger(32), TEST_IPS[2])).status, 429, "11th unknown-IP attempt");
      process.env.BAGATI_TRUST_CLOUDFLARE_IP = "true";
      assert.equal((await attempt(stranger(33), TEST_IPS[2], { "x-real-ip": "198.51.100.9" })).status, 429, "mismatching headers count as unknown and share the bucket");
      assert.equal((await attempt(stranger(34), TEST_IPS[2])).status, 401, "the same client with a trusted IP has its own bucket");
      await expireWindow(bucketKey(null));
      delete process.env.BAGATI_TRUST_CLOUDFLARE_IP;
      assert.equal((await attempt(stranger(35))).status, 401, "after the window the shared bucket starts again");
    });

    await t.test("the per-account limit is kept: 10 wrong passwords for the admin from different IPs, then 429", async () => {
      process.env.BAGATI_TRUST_CLOUDFLARE_IP = "true";
      await prisma.$executeRaw(Prisma.sql`DELETE FROM "AuthRateLimit" WHERE "keyHash" = ANY(${keys})`);
      for (let index = 0; index < 10; index += 1) {
        const ip = `198.51.100.${100 + index}`;
        keys.push(bucketKey(ip));
        assert.equal((await attempt({ email: admin.email, password: wrongPassword }, ip)).status, 401);
      }
      keys.push(bucketKey("198.51.100.120"));
      const limited = await attempt({ email: admin.email, password: wrongPassword }, "198.51.100.120");
      assert.equal(limited.status, 429);
      assert.match((await limited.json()).error, /Çox sayda giriş cəhdi edildi/);
    });

    await t.test("failed admin logins are counted under the admin.login route group, with their 401/429 responses", () => {
      assert.ok((loginFailures.get("admin.login") ?? 0) >= 40, "password failures counted as admin.login");
      assert.deepEqual([...loginFailures.keys()], ["admin.login"], "not mixed into customer or seller login groups");
      assert.ok(responses.every((item) => item.group === "admin.login"));
      assert.ok(responses.some((item) => item.status === 429) && responses.some((item) => item.status === 401));
      // In the database the events carry the admin login path, which the new rule counts.
      return prisma.securityEvent.count({ where: { path: "/api/admin/login", eventType: "LOGIN_FAILURE", occurredAt: { gte: startedAt } } })
        .then((count) => assert.ok(count >= 40, `LOGIN_FAILURE events on /api/admin/login: ${count}`))
        .catch((error) => { if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw error; });
    });
  } finally {
    delete process.env.BAGATI_TRUST_CLOUDFLARE_IP;
    if (keys.length) await prisma.$executeRaw(Prisma.sql`DELETE FROM "AuthRateLimit" WHERE "keyHash" = ANY(${keys})`).catch(() => undefined);
    if (adminId) {
      await prisma.authSession.deleteMany({ where: { userId: adminId } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: adminId } }).catch(() => undefined);
    }
    await prisma.securityEvent.deleteMany({ where: { path: "/api/admin/login", occurredAt: { gte: startedAt }, OR: [{ sourceIp: null }, { sourceIp: { in: TEST_IPS } }, { sourceIp: { startsWith: "198.51.100." } }] } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});
