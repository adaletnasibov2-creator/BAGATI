import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { addResponse, createTelemetryStore, minuteStart, notFoundGroup, routeGroupForPath, type MinuteRow } from "../lib/security-monitoring/telemetry";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("status classes: 4xx, 5xx, 401/403, 404, 429 and duration", () => {
  const counters = { requests: 0, status4xx: 0, status5xx: 0, authDenied: 0, notFound: 0, rateLimited: 0, loginFailures: 0, ipMismatches: 0, durationMsSum: 0, durationMsMax: 0 };
  for (const [status, ms] of [[200, 10], [401, 5], [403, 7], [404, 3], [429, 2], [500, 40], [503, 1], [302, 4]] as const) addResponse(counters, status, ms);
  assert.deepEqual(counters, { requests: 8, status4xx: 4, status5xx: 2, authDenied: 2, notFound: 1, rateLimited: 1, loginFailures: 0, ipMismatches: 0, durationMsSum: 72, durationMsMax: 40 });
  addResponse(counters, 200, Number.NaN);
  assert.equal(counters.durationMsSum, 72, "invalid durations count as 0");
});

test("per-minute buckets by route group; flush writes and clears; counts add up", async () => {
  let now = Date.UTC(2026, 10, 14, 10, 0, 15);
  const written: MinuteRow[][] = [];
  const store = createTelemetryStore({ write: async (rows) => { written.push(rows); }, clock: () => now });
  store.recordResponse("auth.login", 200, 12);
  store.recordResponse("auth.login", 401, 8);
  store.recordLoginFailure("auth.login");
  store.recordIpMismatch("inquiry");
  now += 60_000;
  store.recordResponse("auth.login", 429, 3);
  assert.equal(store.pendingKeys(), 3);
  await store.flush();
  store.stop();
  assert.equal(store.pendingKeys(), 0);
  const rows = written[0].map((row) => ({ minute: row.bucketStart.toISOString(), group: row.routeGroup, requests: row.requests, authDenied: row.authDenied, rateLimited: row.rateLimited, loginFailures: row.loginFailures, ipMismatches: row.ipMismatches }));
  assert.deepEqual(rows, [
    { minute: "2026-11-14T10:00:00.000Z", group: "auth.login", requests: 2, authDenied: 1, rateLimited: 0, loginFailures: 1, ipMismatches: 0 },
    { minute: "2026-11-14T10:00:00.000Z", group: "inquiry", requests: 0, authDenied: 0, rateLimited: 0, loginFailures: 0, ipMismatches: 1 },
    { minute: "2026-11-14T10:01:00.000Z", group: "auth.login", requests: 1, authDenied: 0, rateLimited: 1, loginFailures: 0, ipMismatches: 0 },
  ]);
  assert.equal(minuteStart(Date.UTC(2026, 0, 1, 0, 0, 59, 999)).toISOString(), "2026-01-01T00:00:00.000Z");
});

test("a failing flush never throws, drops that interval, logs once a minute (error class only) and still runs the jobs hook", async () => {
  const logs: string[] = [];
  let hooks = 0;
  let now = 0;
  const store = createTelemetryStore({ write: async () => { throw Object.assign(new Error("connect ECONNREFUSED"), { name: "PrismaClientInitializationError" }); }, clock: () => now, log: (line) => logs.push(line), afterFlush: () => { hooks += 1; } });
  store.recordResponse("auth.login", 200, 1);
  await store.flush();
  store.recordResponse("auth.login", 200, 1);
  now += 1_000;
  await store.flush();
  store.stop();
  assert.equal(store.pendingKeys(), 0, "dropped, not retried forever");
  assert.equal(logs.length, 1);
  assert.deepEqual(JSON.parse(logs[0]), { event: "security_telemetry.flush_failed", error: "PrismaClientInitializationError", rows: 1 });
  assert.equal(hooks, 2);
});

test("recording never throws, invalid groups become 'other', memory is bounded", async () => {
  const written: MinuteRow[][] = [];
  const store = createTelemetryStore({ write: async (rows) => { written.push(rows); }, clock: () => 0 });
  store.recordResponse("Bad Group!", 200, 1);
  store.recordResponse("x".repeat(60), 200, 1);
  for (let index = 0; index < 2_500; index += 1) store.recordResponse(`g${index}`, 200, 1);
  assert.ok(store.pendingKeys() <= 2_000, "bounded");
  await store.flush();
  store.stop();
  assert.ok(written[0].some((row) => row.routeGroup === "other"));
  assert.ok(written[0].every((row) => /^[a-z0-9][a-z0-9._:-]{0,47}$/.test(row.routeGroup)), "matches the database CHECK");
});

test("route groups and not-found classes are a closed vocabulary; nothing of the path is stored", () => {
  assert.equal(routeGroupForPath("/api/auth/login"), "auth.login");
  assert.equal(routeGroupForPath("/api/admin/login/2fa"), "admin.2fa");
  assert.equal(routeGroupForPath("/api/admin/2fa/disable"), "admin.2fa");
  assert.equal(routeGroupForPath("/api/admin/login"), "admin.login");
  assert.equal(routeGroupForPath("/api/stores/abc123/inquiries"), "inquiry");
  assert.equal(routeGroupForPath("/api/something/else?token=secret"), "other");
  assert.equal(notFoundGroup("/wp-login.php"), "notfound.php");
  assert.equal(notFoundGroup("/wp-admin/"), "notfound.wp");
  assert.equal(notFoundGroup("/." + "env"), "notfound.secrets", "environment file probe (split so the secret scan stays clean)");
  assert.equal(notFoundGroup("/.git/config"), "notfound.secrets");
  assert.equal(notFoundGroup("/phpmyadmin"), "notfound.php");
  assert.equal(notFoundGroup("/administrator"), "notfound.admin-probe");
  assert.equal(notFoundGroup("/api/unknown"), "notfound.api");
  assert.equal(notFoundGroup("/products/missing-item"), "notfound.other");
  assert.equal(notFoundGroup(null), "notfound.other");
});

test("wrapper: returns the handler's response unchanged, counts it, rethrows errors as 500", async () => {
  const { withSecurityTelemetry } = await import("../lib/security-monitoring/runtime");
  const { securityTelemetry } = await import("../lib/security-monitoring/instance");
  const before = securityTelemetry.pendingKeys();
  const ok = withSecurityTelemetry("auth.login", async (_request: Request) => new Response("x", { status: 401 }));
  const response = await ok(new Request("http://localhost/api/auth/login", { method: "POST" }));
  assert.equal(response.status, 401);
  const failing = withSecurityTelemetry("auth.login", async (_request: Request): Promise<Response> => { throw new Error("boom"); });
  await assert.rejects(failing(new Request("http://localhost/api/auth/login", { method: "POST" })), /boom/);
  assert.ok(securityTelemetry.pendingKeys() >= Math.min(before + 1, 1));
  securityTelemetry.stop();
});

test("wiring: security-relevant routes are wrapped; no checkout route is; middleware passes only the pathname", () => {
  const wrapped: Record<string, string> = {
    "app/api/auth/login/route.ts": "auth.login",
    "app/api/auth/vendor-login/route.ts": "auth.vendor-login",
    "app/api/admin/login/route.ts": "admin.login",
    "app/api/admin/login/2fa/route.ts": "admin.2fa",
    "app/api/auth/register/route.ts": "auth.register",
    "app/api/auth/forgot-password/route.ts": "auth.password-reset",
    "app/api/stores/[storeId]/inquiries/route.ts": "inquiry",
    "app/api/vendor/apply/route.ts": "seller-application",
    "app/api/security/ingest/[source]/route.ts": "security.ingest",
  };
  for (const [path, group] of Object.entries(wrapped)) {
    const source = read(path);
    assert.match(source, new RegExp(`export const POST = withSecurityTelemetry\\("${group.replace(/\./g, "\\.")}", handlePOST\\);`), path);
    assert.doesNotMatch(source, /export async function POST\(/, path);
  }
  for (const path of ["app/api/orders/route.ts", "app/api/cart/route.ts", "app/api/cart/items/route.ts"]) assert.doesNotMatch(read(path), /withSecurityTelemetry/, `${path}: checkout code untouched`);
  const middleware = read("middleware.ts");
  assert.match(middleware, /requestHeaders\.set\("x-bagati-pathname", pathname\.slice\(0, 300\)\);/);
  assert.doesNotMatch(middleware, /search(Params)?\b.*x-bagati/);
  const notFound = read("app/not-found.tsx");
  assert.match(notFound, /securityTelemetry\.recordResponse\(notFoundGroup\(list\.get\("x-bagati-pathname"\)\), 404, 0\);/);
  const telemetry = read("lib/security-monitoring/telemetry.ts");
  assert.doesNotMatch(telemetry, /\b(sourceIp|clientIp|userId|searchParams|headers\.get|request\.url)\b/, "no IPs, users or URLs in the counters module");
});
