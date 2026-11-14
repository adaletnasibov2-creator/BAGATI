/**
 * Maintenance mode: allow-list, 503 responses, the cached/fail-open state reader and the middleware.
 * fetch is always stubbed: no test reaches the network.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { isMaintenanceExempt, maintenanceHtml, maintenanceResponse, MAINTENANCE_RETRY_AFTER_SECONDS } from "../lib/maintenance";
import { maintenanceState, MAINTENANCE_STATE_TTL_MS, resetMaintenanceStateCache } from "../lib/maintenance-state";
import { MAINTENANCE_MESSAGE_DEFAULT } from "../lib/maintenance-defaults";

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");

const ALLOWED = [
  "/admin", "/admin/login", "/admin/settings", "/admin/stores/abc",
  "/api/admin", "/api/admin/login", "/api/admin/login/2fa", "/api/admin/settings/maintenance.enabled",
  "/api/ready", "/api/health", "/api/maintenance-state", "/api/auth/logout",
  "/api/payments/epoint/callback", "/api/payments/epoint/initiate", "/api/payments/epoint/reconcile",
  "/api/security/ingest/cloudflare",
  "/_next/static/chunks/main.js", "/favicon.ico", "/images/home/slide.webp", "/uploads/vendors/x/logo.png", "/robots.txt",
];
const BLOCKED = [
  "/", "/products", "/products/abc", "/stores/x", "/cart", "/checkout", "/orders", "/account", "/login", "/register",
  "/vendor", "/vendor/login", "/vendor/apply", "/terms", "/contact",
  "/api/cart", "/api/orders", "/api/auth/login", "/api/auth/vendor-login", "/api/auth/register", "/api/vendor/stores", "/api/products",
  "/admins", "/administrator", "/api/administrator", "/api/paymentsx", "/api/readyx", "/products/item.v2",
];

test("allow-list: admin, admin APIs and login, payment callbacks, readiness, logout, static files", () => {
  for (const path of ALLOWED) assert.equal(isMaintenanceExempt(path), true, path);
});

test("everything else is blocked: customer and seller pages and APIs, look-alike paths", () => {
  for (const path of BLOCKED) assert.equal(isMaintenanceExempt(path), false, path);
  // Only real static asset types are exempt; a dotted dynamic path is not.
  assert.equal(isMaintenanceExempt("/api/cart.json"), true, "a .json file name is treated as static (no API route ends in .json)");
  assert.equal(isMaintenanceExempt("/stores/my.store"), false);
});

test("responses: 503 with Retry-After and no caching; JSON for APIs, HTML page otherwise; message escaped", async () => {
  const page = maintenanceResponse("/products", "Sabah 10:00-a qədər <script>alert(1)</script>");
  assert.equal(page.status, 503);
  assert.equal(page.headers.get("retry-after"), String(MAINTENANCE_RETRY_AFTER_SECONDS));
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.match(page.headers.get("content-type") ?? "", /text\/html/);
  const html = await page.text();
  assert.match(html, /<html lang="az">/);
  assert.match(html, /Texniki işlər aparılır/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  const api = maintenanceResponse("/api/cart", "Texniki iş");
  assert.equal(api.status, 503);
  assert.deepEqual(await api.json(), { error: "Texniki iş", code: "MAINTENANCE" });
  assert.match(maintenanceHtml('"&\''), /&quot;&amp;&#39;/);
});

test("state: default off, cached for 10 s, fails open, keeps the last known state on later failures", async () => {
  resetMaintenanceStateCache();
  let calls = 0;
  const on: typeof fetch = async () => { calls += 1; return Response.json({ enabled: true, message: "Bağlıyıq" }); };
  assert.deepEqual(await maintenanceState("http://localhost:3000", on, 1_000), { enabled: true, message: "Bağlıyıq" });
  await maintenanceState("http://localhost:3000", on, 1_000 + MAINTENANCE_STATE_TTL_MS - 1);
  assert.equal(calls, 1, "cached within the TTL");
  const failing: typeof fetch = async () => { throw new Error("network"); };
  assert.equal((await maintenanceState("http://localhost:3000", failing, 1_000 + MAINTENANCE_STATE_TTL_MS)).enabled, true, "last known state kept");
  resetMaintenanceStateCache();
  assert.deepEqual(await maintenanceState("http://localhost:3000", failing, 5_000), { enabled: false, message: MAINTENANCE_MESSAGE_DEFAULT }, "fail-open: never takes the site down");
  resetMaintenanceStateCache();
  const bad: typeof fetch = async () => Response.json({ enabled: "yes" });
  assert.equal((await maintenanceState("http://localhost:3000", bad, 9_000)).enabled, false, "malformed answer = off");
  resetMaintenanceStateCache();
  const off: typeof fetch = async () => Response.json({ enabled: false, message: "x" });
  assert.equal((await maintenanceState("http://localhost:3000", off, 9_000)).enabled, false, "default off");
});

async function withState(enabled: boolean, run: (middleware: (request: NextRequest) => Promise<Response>) => Promise<void>) {
  const { middleware } = await import("../middleware");
  resetMaintenanceStateCache();
  const realFetch = globalThis.fetch;
  let stateCalls = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    stateCalls += 1;
    assert.match(String(input instanceof Request ? input.url : input), /\/api\/maintenance-state$/, "only the state endpoint is fetched");
    return Response.json({ enabled, message: "Bir saatlıq texniki iş" });
  }) as typeof fetch;
  try { await run(middleware as (request: NextRequest) => Promise<Response>); }
  finally { globalThis.fetch = realFetch; resetMaintenanceStateCache(); }
  return stateCalls;
}

const request = (path: string, method = "GET") => new NextRequest(`http://localhost:3000${path}`, { method, headers: { host: "localhost:3000", ...(method === "GET" ? {} : { origin: "http://localhost:3000" }) } });

test("middleware, maintenance OFF (default): nothing changes", async () => {
  await withState(false, async (middleware) => {
    for (const path of ["/", "/products", "/vendor", "/admin/login"]) assert.notEqual((await middleware(request(path))).status, 503, path);
    assert.notEqual((await middleware(request("/api/cart", "POST"))).status, 503);
  });
});

test("middleware, maintenance ON: customer and seller pages and APIs get 503; each allowed path passes", async () => {
  const calls = await withState(true, async (middleware) => {
    const home = await middleware(request("/"));
    assert.equal(home.status, 503);
    assert.match(await home.text(), /Bir saatlıq texniki iş/);
    for (const path of ["/products", "/checkout", "/vendor", "/login", "/vendor/login"]) assert.equal((await middleware(request(path))).status, 503, path);
    const cart = await middleware(request("/api/cart", "POST"));
    assert.equal(cart.status, 503);
    assert.equal((await cart.json()).code, "MAINTENANCE");
    for (const path of ["/api/orders", "/api/auth/login", "/api/auth/vendor-login"]) assert.equal((await middleware(request(path, "POST"))).status, 503, path);
    for (const [path, method] of [["/admin", "GET"], ["/admin/login", "GET"], ["/api/admin/login", "POST"], ["/api/admin/login/2fa", "POST"], ["/api/ready", "GET"], ["/api/payments/epoint/callback", "POST"], ["/api/payments/epoint/reconcile", "POST"], ["/api/auth/logout", "POST"], ["/_next/static/x.js", "GET"], ["/images/home/a.webp", "GET"]] as const) {
      const response = await middleware(request(path, method));
      assert.notEqual(response.status, 503, path);
    }
    // Admin pages keep their noindex header.
    assert.equal((await middleware(request("/admin/login"))).headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
  });
  assert.ok(calls >= 1 && calls <= 2, "state read once and cached (not once per request)");
});

test("wiring: middleware checks before CSRF; the state endpoint is public and read-only; dashboard banner", () => {
  const middleware = read("middleware.ts");
  assert.match(middleware, /export async function middleware/);
  assert.ok(middleware.indexOf("isMaintenanceExempt(pathname)") < middleware.indexOf("csrfRejection(request)"));
  assert.ok(middleware.indexOf("canonicalHostRedirectUrl") < middleware.indexOf("isMaintenanceExempt(pathname)"), "host redirect first");
  assert.doesNotMatch(read("lib/maintenance-state.ts"), /@\/lib\/settings|prisma/, "Edge-safe: no settings registry or database import");
  const route = read("app/api/maintenance-state/route.ts");
  assert.match(route, /export async function GET\(\)/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.match(route, /enabled: enabled === true, message:/);
  const dashboard = read("app/admin/page.tsx");
  assert.match(dashboard, /\{maintenanceOn === true && <div role="alert" className="[^"]*bg-red-50/);
  assert.match(dashboard, /href="\/admin\/settings\?tab=maintenance"/);
});

test("fail-open is visible: last check recorded with a short reason; at most one warning per minute; failures cached 10 s", async () => {
  const { lastMaintenanceCheck, MAINTENANCE_WARNING_INTERVAL_MS, describeCheckFailure } = await import("../lib/maintenance-state");
  resetMaintenanceStateCache();
  assert.equal(lastMaintenanceCheck(), null);
  const warnings: string[] = [];
  const warn = (message: string) => { warnings.push(message); };
  let calls = 0;
  // What production hit: https://localhost:<port> against Next's plain-HTTP port.
  const tls: typeof fetch = async () => { calls += 1; throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ERR_SSL_WRONG_VERSION_NUMBER" } }); };
  let t = 100_000;
  assert.deepEqual(await maintenanceState("https://localhost:3000", tls, t, { source: "request", warn }), { enabled: false, message: MAINTENANCE_MESSAGE_DEFAULT });
  assert.deepEqual(lastMaintenanceCheck(), { ok: false, at: t, reason: "bağlantı xətası (ERR_SSL_WRONG_VERSION_NUMBER)", source: "request" });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /\[maintenance\] state check failed via request origin https:\/\/localhost:3000: bağlantı xətası \(ERR_SSL_WRONG_VERSION_NUMBER\)\. Failing open: maintenance treated as OFF\. Set BAGATI_INTERNAL_ORIGIN/);
  await maintenanceState("https://localhost:3000", tls, t + MAINTENANCE_STATE_TTL_MS - 1, { source: "request", warn });
  assert.equal(calls, 1, "a failed check is cached too (no retry storm)");
  for (t += MAINTENANCE_STATE_TTL_MS; t < 100_000 + MAINTENANCE_WARNING_INTERVAL_MS; t += MAINTENANCE_STATE_TTL_MS) await maintenanceState("https://localhost:3000", tls, t, { source: "request", warn });
  assert.equal(warnings.length, 1, "no second warning within the minute");
  await maintenanceState("https://localhost:3000", tls, 100_000 + MAINTENANCE_WARNING_INTERVAL_MS, { source: "request", warn });
  assert.equal(warnings.length, 2, "warned again after a minute");
  // Recovery is recorded.
  await maintenanceState("http://127.0.0.1:3000", async () => Response.json({ enabled: true, message: "x" }), 500_000, { source: "internal", warn });
  assert.deepEqual(lastMaintenanceCheck(), { ok: true, at: 500_000, reason: null, source: "internal" });
  // Reasons stay short and non-sensitive.
  resetMaintenanceStateCache();
  await maintenanceState("http://127.0.0.1:3000", async () => new Response("<html>challenge</html>", { status: 403 }), 1, { warn });
  assert.equal(lastMaintenanceCheck()?.reason, "HTTP 403");
  resetMaintenanceStateCache();
  await maintenanceState("http://127.0.0.1:3000", async () => new Response("not json", { status: 200 }), 1, { warn });
  assert.equal(lastMaintenanceCheck()?.reason, "cavab formatı yanlışdır");
  assert.equal(describeCheckFailure(Object.assign(new Error("x"), { name: "TimeoutError" })), "vaxt bitdi (1.5 s)");
  resetMaintenanceStateCache();
});

test("middleware: BAGATI_INTERNAL_ORIGIN is used for the state request even when the request origin is https://localhost", async () => {
  const { middleware } = await import("../middleware");
  const realFetch = globalThis.fetch; const realEnv = process.env.BAGATI_INTERNAL_ORIGIN;
  const seen: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => { seen.push(String(input instanceof Request ? input.url : input)); return Response.json({ enabled: true, message: "Bağlıyıq" }); }) as typeof fetch;
  // Behind the proxy Next gives the middleware "<X-Forwarded-Proto>://localhost:<port>" as the URL.
  const proxied = (path: string) => new NextRequest(`https://localhost:3000${path}`, { headers: { host: "shopbagati.com", "x-forwarded-proto": "https" } });
  try {
    resetMaintenanceStateCache();
    process.env.BAGATI_INTERNAL_ORIGIN = "http://127.0.0.1:3000";
    assert.equal((await middleware(proxied("/"))).status, 503);
    assert.deepEqual(seen, ["http://127.0.0.1:3000/api/maintenance-state"]);
    resetMaintenanceStateCache(); seen.length = 0;
    delete process.env.BAGATI_INTERNAL_ORIGIN;
    await middleware(proxied("/"));
    assert.deepEqual(seen, ["https://localhost:3000/api/maintenance-state"], "not set: the request origin, as before");
    resetMaintenanceStateCache(); seen.length = 0;
    process.env.BAGATI_INTERNAL_ORIGIN = "https://shopbagati.com";
    await middleware(proxied("/"));
    assert.deepEqual(seen, ["https://localhost:3000/api/maintenance-state"], "invalid value ignored");
  } finally {
    globalThis.fetch = realFetch; resetMaintenanceStateCache();
    if (realEnv === undefined) delete process.env.BAGATI_INTERNAL_ORIGIN; else process.env.BAGATI_INTERNAL_ORIGIN = realEnv;
  }
});

test("check header: ASCII round-trip, malformed values rejected; middleware sets it only for admin pages and strips client values", async () => {
  const { decodeMaintenanceCheck, encodeMaintenanceCheck, MAINTENANCE_CHECK_HEADER } = await import("../lib/maintenance-state");
  const failed = { ok: false, at: 1_731_600_000_000, reason: "bağlantı xətası (ERR_SSL_WRONG_VERSION_NUMBER)", source: "request" as const };
  const encoded = encodeMaintenanceCheck(failed);
  assert.match(encoded, /^[\x20-\x7e]+$/, "ASCII only (header-safe)");
  assert.deepEqual(decodeMaintenanceCheck(encoded), failed);
  assert.deepEqual(decodeMaintenanceCheck(encodeMaintenanceCheck({ ok: true, at: 5, reason: null, source: "internal" })), { ok: true, at: 5, reason: null, source: "internal" });
  for (const bad of [null, "", "1|internal", "2|internal|5|", "1|other|5|", "0|request|x|r", "0|request|5|%E0%A4%A", "0|request|5|a|b"]) assert.equal(decodeMaintenanceCheck(bad), null, String(bad));

  const { middleware } = await import("../middleware");
  const realFetch = globalThis.fetch;
  let forwarded: Headers | null = null;
  globalThis.fetch = (async () => Response.json({ enabled: false, message: "x" })) as typeof fetch;
  try {
    resetMaintenanceStateCache();
    const spoof = (path: string) => new NextRequest(`http://localhost:3000${path}`, { headers: { host: "localhost:3000", [MAINTENANCE_CHECK_HEADER]: "1|internal|1|" } });
    const admin = await middleware(spoof("/admin/settings"));
    forwarded = new Headers(); admin.headers.forEach((value, key) => { forwarded!.set(key, value); });
    const overridden = forwarded.get(`x-middleware-request-${MAINTENANCE_CHECK_HEADER}`);
    assert.ok(overridden && decodeMaintenanceCheck(overridden)?.source === "request", "admin page: set from the middleware's own check");
    assert.notEqual(overridden, "1|internal|1|", "client value replaced");
    const shop = await middleware(spoof("/products"));
    assert.equal(shop.headers.get(`x-middleware-request-${MAINTENANCE_CHECK_HEADER}`), null, "public page: client value stripped, nothing set");
    assert.match(shop.headers.get("x-middleware-override-headers") ?? "", /x-bagati-pathname/);
    assert.doesNotMatch(shop.headers.get("x-middleware-override-headers") ?? "", new RegExp(MAINTENANCE_CHECK_HEADER));
  } finally { globalThis.fetch = realFetch; resetMaintenanceStateCache(); }

  const settings = read("app/admin/_sections/settings.tsx");
  assert.match(settings, /decodeMaintenanceCheck\(\(await headers\(\)\)\.get\(MAINTENANCE_CHECK_HEADER\)\)/);
  assert.match(settings, /\{engineTab==="maintenance"&&<AdminMaintenanceCheck check=\{maintenanceCheck\}\/>\}/);
  const line = read("components/admin-maintenance-check.tsx");
  assert.match(line, /<b>Yoxlama işləyir\.<\/b>/);
  assert.match(line, /<b>Yoxlama işləmir: \{check\.reason\}<\/b>/);
});
