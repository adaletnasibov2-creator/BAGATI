/**
 * Admin entry point hardening: no public link to the admin login, noindex on the admin surface, per-IP limits on
 * admin password and 2FA attempts, and the "admin login failure burst" Security Center rule. No database.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { loginPortalPath, publicLoginPortalLink } from "../lib/login-portal";
import { ADMIN_X_ROBOTS_TAG, isAdminSurface } from "../lib/admin-surface";
import {
  ADMIN_2FA_UNKNOWN_IP_RATE_LIMIT, ADMIN_LOGIN_IP_RATE_LIMIT, ADMIN_LOGIN_UNKNOWN_IP_RATE_LIMIT,
  admin2faIpBucket, adminLoginIpBucket, adminRateLimitedResponseParts,
} from "../lib/admin-login-rate-limit";
import { ADMIN_2FA_IP_RATE_LIMIT, ADMIN_2FA_USER_RATE_LIMIT } from "../lib/admin-2fa-policy";
import { authRateLimitKey, LOGIN_RATE_LIMIT } from "../lib/auth-rate-limit";
import { ADMIN_LOGIN_PATHS, getAlertRule, SECURITY_ALERT_RULES, TWO_FACTOR_PATHS } from "../lib/security-monitoring/rules";
import { createTelemetryStore, routeGroupForPath, type MinuteRow } from "../lib/security-monitoring/telemetry";

process.env.SESSION_SECRET ??= randomBytes(32).toString("hex");

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const normalized = (path: string) => path.replace(/\\/g, "/");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root, dir))) {
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(normalized(path));
  }
  return out;
}

/** Admin-only code (rendered only inside /admin or for a signed-in ADMIN). Everything else is public. */
function adminOnly(path: string) {
  return path.startsWith("app/admin/") || path.startsWith("app/api/admin/") || /^components\/admin-[^/]+\.tsx$/.test(path);
}

// ---------------------------------------------------------------------------------------------------------------
// 1. No public link to the admin login
// ---------------------------------------------------------------------------------------------------------------

test("no public page, header, footer or menu links to /admin/login or says \"Admin girişi\"", () => {
  const files = [...sourceFiles("app"), ...sourceFiles("components")].filter((path) => !adminOnly(path));
  assert.ok(files.length > 50, "scanned the public app and components");
  const offenders = files.filter((path) => /\/admin\/login|Admin girişi(?!ndən)|Admin girişinə/.test(read(path)));
  assert.deepEqual(offenders, [], "public files must not link to or name the admin login");
  for (const path of ["components/login-form.tsx", "components/vendor-login-form.tsx", "components/google-oauth-button.tsx", "components/header.tsx", "components/mobile-menu.tsx", "components/customer-footer.tsx", "components/sticky-header.tsx", "components/mobile-bottom-nav.tsx"]) {
    assert.ok(files.includes(path), `${path} is part of the scan`);
  }
});

test("wrong-portal hints on public pages link only to the customer or seller login", () => {
  assert.equal(publicLoginPortalLink("admin"), null);
  assert.deepEqual(publicLoginPortalLink("vendor"), { href: "/vendor/login", label: "Satıcı girişinə keç" });
  assert.deepEqual(publicLoginPortalLink("customer"), { href: "/login", label: "Müştəri girişinə keç" });
  assert.equal(publicLoginPortalLink("owner"), null);
  assert.equal(publicLoginPortalLink(null), null);
  for (const path of ["components/login-form.tsx", "components/vendor-login-form.tsx", "components/google-oauth-button.tsx"]) {
    const source = read(path);
    assert.match(source, /publicLoginPortalLink\(/, `${path}: uses the public link helper`);
    assert.doesNotMatch(source, /loginPortalLinkLabel/, `${path}: no generic portal label (it includes the admin one)`);
  }
});

test("/admin/login still works when typed directly", () => {
  assert.ok(existsSync(join(root, "app/admin/login/page.tsx")));
  assert.match(read("app/admin/login/page.tsx"), /<AdminLoginForm\/>/);
  assert.equal(loginPortalPath("admin"), "/admin/login", "admin pages keep their own redirect target");
  const middleware = read("middleware.ts");
  assert.doesNotMatch(middleware, /\/admin\/login/, "middleware neither blocks nor rewrites the admin login");
  assert.match(read("components/admin-login-form.tsx"), /fetch\("\/api\/admin\/login"/);
});

// ---------------------------------------------------------------------------------------------------------------
// 2. noindex (metadata + X-Robots-Tag), not robots.txt
// ---------------------------------------------------------------------------------------------------------------

test("admin surface: /admin and /api/admin with every sub-path, nothing else", () => {
  for (const path of ["/admin", "/admin/", "/admin/login", "/admin/security-center", "/api/admin", "/api/admin/login", "/api/admin/login/2fa", "/api/admin/security/live"]) {
    assert.equal(isAdminSurface(path), true, path);
  }
  for (const path of ["/", "/administrator", "/admins", "/login", "/vendor/login", "/api/auth/login", "/api/administrator", "/products/admin"]) {
    assert.equal(isAdminSurface(path), false, path);
  }
  assert.equal(ADMIN_X_ROBOTS_TAG, "noindex, nofollow, noarchive");
});

test("middleware sets X-Robots-Tag on admin pages and APIs (also on a CSRF rejection), and not on public pages", async () => {
  const { middleware } = await import("../middleware");
  const headerFor = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => middleware(new NextRequest(url, init)).headers.get("x-robots-tag");
  assert.equal(headerFor("http://localhost:3000/admin/login"), ADMIN_X_ROBOTS_TAG);
  assert.equal(headerFor("http://localhost:3000/admin"), ADMIN_X_ROBOTS_TAG);
  assert.equal(headerFor("http://localhost:3000/admin/security-center?tab=live"), ADMIN_X_ROBOTS_TAG);
  assert.equal(headerFor("http://localhost:3000/api/admin/security/live", { headers: { host: "localhost:3000" } }), ADMIN_X_ROBOTS_TAG);
  const crossSite = middleware(new NextRequest("http://localhost:3000/api/admin/login", { method: "POST", headers: { host: "localhost:3000", origin: "https://evil.example", "sec-fetch-site": "cross-site" } }));
  assert.equal(crossSite.status, 403, "cross-site admin POST is rejected by the middleware");
  assert.equal(crossSite.headers.get("x-robots-tag"), ADMIN_X_ROBOTS_TAG);
  for (const url of ["http://localhost:3000/", "http://localhost:3000/login", "http://localhost:3000/vendor/login", "http://localhost:3000/products"]) {
    assert.equal(headerFor(url), null, url);
  }
});

test("admin layout sets robots metadata noindex/nofollow; no admin page overrides it", async () => {
  const { metadata } = await import("../app/admin/layout");
  const robots = metadata.robots as { index: boolean; follow: boolean; googleBot: { index: boolean; follow: boolean } };
  assert.equal(robots.index, false);
  assert.equal(robots.follow, false);
  assert.equal(robots.googleBot.index, false);
  const overriding = sourceFiles("app/admin").filter((path) => path !== "app/admin/layout.tsx" && /robots\s*:/.test(read(path)));
  assert.deepEqual(overriding, []);
});

test("the admin path is not advertised in robots.txt", () => {
  for (const path of ["public/robots.txt", "app/robots.ts", "app/robots.txt"]) {
    if (existsSync(join(root, path))) assert.doesNotMatch(read(path), /admin/i, `${path} must not name the admin path`);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// 3. Per-IP limits on admin password and 2FA attempts
// ---------------------------------------------------------------------------------------------------------------

const trusted = (ip: string, extra: Record<string, string> = {}) => new Headers({ "cf-connecting-ip": ip, ...extra });

test("admin password attempts: one bucket per trusted client IP", () => {
  const a = adminLoginIpBucket(trusted("203.0.113.10"), true);
  const b = adminLoginIpBucket(trusted("203.0.113.11"), true);
  assert.equal(a.scope, "ip");
  assert.equal(a.limit, ADMIN_LOGIN_IP_RATE_LIMIT.limit);
  assert.equal(a.windowMs, 15 * 60 * 1000);
  assert.notEqual(a.key, b.key, "different IPs, different buckets");
  assert.equal(a.key, adminLoginIpBucket(trusted("::ffff:203.0.113.10"), true).key, "IPv4-mapped IPv6 is the same client");
  assert.notEqual(a.key, authRateLimitKey("login", "ip:203.0.113.10"), "scoped: not shared with the per-account login limit");
  assert.notEqual(a.key, authRateLimitKey("admin-2fa", "ip:203.0.113.10"), "scoped: not shared with the 2FA limit");
  assert.match(a.key, /^[0-9a-f]{64}$/, "HMAC: the IP itself is not stored");
});

test("unknown client IP falls back to ONE shared, stricter bucket (flag off, missing header, header mismatch)", () => {
  const flagOff = adminLoginIpBucket(trusted("203.0.113.10"), false);
  const missing = adminLoginIpBucket(new Headers(), true);
  const invalid = adminLoginIpBucket(trusted("not-an-ip"), true);
  const mismatch = adminLoginIpBucket(trusted("203.0.113.10", { "x-real-ip": "198.51.100.7" }), true);
  for (const bucket of [flagOff, missing, invalid, mismatch]) {
    assert.equal(bucket.scope, "unknown-ip");
    assert.equal(bucket.key, flagOff.key, "all unknown-IP requests share the same global bucket");
    assert.equal(bucket.limit, ADMIN_LOGIN_UNKNOWN_IP_RATE_LIMIT.limit);
  }
  assert.ok(ADMIN_LOGIN_UNKNOWN_IP_RATE_LIMIT.limit < ADMIN_LOGIN_IP_RATE_LIMIT.limit, "stricter than per IP");
  assert.ok(ADMIN_LOGIN_UNKNOWN_IP_RATE_LIMIT.limit >= LOGIN_RATE_LIMIT.limit, "the real admin still gets the per-account attempts");
  assert.equal(adminLoginIpBucket(trusted("203.0.113.10", { "x-real-ip": "203.0.113.10" }), true).scope, "ip", "matching headers stay trusted");
});

test("2FA code attempts: known IP keeps the existing per-IP bucket; unknown IP uses a shared stricter bucket", () => {
  const known = admin2faIpBucket(trusted("203.0.113.20"), ADMIN_2FA_IP_RATE_LIMIT, true);
  assert.equal(known.key, authRateLimitKey("admin-2fa", "ip:203.0.113.20"), "unchanged key: existing windows carry over");
  assert.equal(known.limit, ADMIN_2FA_IP_RATE_LIMIT.limit);
  const unknownA = admin2faIpBucket(new Headers(), ADMIN_2FA_IP_RATE_LIMIT, true);
  const unknownB = admin2faIpBucket(trusted("203.0.113.20", { "x-real-ip": "198.51.100.1" }), ADMIN_2FA_IP_RATE_LIMIT, true);
  assert.equal(unknownA.scope, "unknown-ip");
  assert.equal(unknownA.key, unknownB.key);
  assert.notEqual(unknownA.key, adminLoginIpBucket(new Headers(), false).key, "2FA and password unknown-IP buckets are separate");
  assert.equal(unknownA.limit, ADMIN_2FA_UNKNOWN_IP_RATE_LIMIT.limit);
  assert.ok(ADMIN_2FA_UNKNOWN_IP_RATE_LIMIT.limit < ADMIN_2FA_IP_RATE_LIMIT.limit, "stricter than per IP");
  assert.ok(ADMIN_2FA_UNKNOWN_IP_RATE_LIMIT.limit >= ADMIN_2FA_USER_RATE_LIMIT.limit, "does not undercut the per-account limit");
});

test("limits are fixed windows with an Azerbaijani message naming the wait (no permanent lockout)", () => {
  for (const limit of [ADMIN_LOGIN_IP_RATE_LIMIT, ADMIN_LOGIN_UNKNOWN_IP_RATE_LIMIT, ADMIN_2FA_UNKNOWN_IP_RATE_LIMIT]) {
    assert.ok(limit.windowMs > 0 && limit.windowMs <= 60 * 60 * 1000, "bounded window");
  }
  const parts = adminRateLimitedResponseParts(15 * 60 * 1000);
  assert.equal(parts.error, "Çox sayda giriş cəhdi edildi. 15 dəqiqə sonra yenidən yoxlayın.");
  assert.equal(parts.retryAfterSeconds, "900");
  assert.equal(adminRateLimitedResponseParts(10_000).error, "Çox sayda giriş cəhdi edildi. 1 dəqiqə sonra yenidən yoxlayın.");
  // The shared store resets a bucket once its window has passed (no permanent lock state anywhere).
  const store = read("lib/auth-rate-limit.ts");
  assert.match(store, /WHEN "AuthRateLimit"\."windowStartedAt" <= \$\{new Date\(now\.getTime\(\) - windowMs\)\} THEN 1/);
});

test("admin login route: per-IP limit before the per-account limit; correct password clears this IP's bucket", () => {
  const route = read("app/api/admin/login/route.ts");
  const ipCheck = route.indexOf("consumeAuthRateLimit(ipBucket.key, ipBucket.limit, ipBucket.windowMs)");
  const accountCheck = route.indexOf("consumeAuthRateLimit(rateKey, LOGIN_RATE_LIMIT.limit, LOGIN_RATE_LIMIT.windowMs)");
  const passwordCheck = route.indexOf("bcrypt.compare(parsed.data.password, user.passwordHash)");
  assert.ok(ipCheck > 0 && accountCheck > ipCheck && passwordCheck > accountCheck, "IP limit, then account limit, then the password");
  assert.match(route, /const ipBucket = adminLoginIpBucket\(request\.headers\);/);
  assert.match(route, /status: 429, headers: \{ "Cache-Control": "no-store", "Retry-After": limited\.retryAfterSeconds \}/);
  assert.match(route, /if \(ipBucket\.scope === "ip"\) await clearAuthRateLimit\(ipBucket\.key\);/);
  const clear = route.indexOf('if (ipBucket.scope === "ip")');
  assert.ok(clear > route.indexOf('if (user.role !== "ADMIN")'), "only an ADMIN with the correct password clears the IP bucket");
  const twoFactor = read("lib/admin-2fa.ts");
  assert.match(twoFactor, /const ipBucket = admin2faIpBucket\(request\.headers, ADMIN_2FA_IP_RATE_LIMIT\);/);
  assert.doesNotMatch(twoFactor, /: true;\s*\n\s*return userOk && ipOk/, "no free pass when the IP is unknown");
  assert.match(read("app/api/admin/login/2fa/route.ts"), /case "rate-limited": \{[\s\S]*?adminRateLimitedResponseParts[\s\S]*?"Retry-After"/);
});

// ---------------------------------------------------------------------------------------------------------------
// 4. Security Center: admin login failure burst rule and its own route group
// ---------------------------------------------------------------------------------------------------------------

test("rule \"admin login failure burst\": CRITICAL, 5 per 10 min, cooldown 30 min, editable like the others", () => {
  const rule = getAlertRule("admin_login_failure_burst");
  assert.ok(rule);
  assert.equal(rule.severity, "CRITICAL");
  assert.equal(rule.metric, "events.adminLoginFailure");
  assert.deepEqual(rule.defaults, { enabled: true, threshold: 5, windowMinutes: 10, cooldownMinutes: 30 });
  assert.match(rule.key, /^[a-z][a-z0-9_]{1,47}$/, "matches the SecurityAlertRule CHECK");
  assert.match(rule.label, /Admin girişində/);
  assert.equal(SECURITY_ALERT_RULES.filter((item) => item.key === rule.key).length, 1);
  assert.deepEqual([...ADMIN_LOGIN_PATHS], ["/api/admin/login"]);
  assert.ok(!ADMIN_LOGIN_PATHS.some((path) => (TWO_FACTOR_PATHS as readonly string[]).includes(path)), "2FA failures stay in their own rule");
  const jobs = read("lib/security-monitoring/jobs.ts");
  assert.match(jobs, /rule\.metric === "events\.adminLoginFailure"[\s\S]*?path: \{ in: \[\.\.\.ADMIN_LOGIN_PATHS\] \}/);
  // Editable: the rules API and UI list SECURITY_ALERT_RULES generically and validate keys with getAlertRule.
  const admin = read("lib/security-monitoring/admin.ts");
  assert.match(admin, /return SECURITY_ALERT_RULES\.map\(/);
  assert.match(admin, /const rule = getAlertRule\(input\.key\);/);
});

test("failed admin logins are counted under their own route group (admin.login), separate from other logins", async () => {
  assert.equal(routeGroupForPath("/api/admin/login"), "admin.login");
  assert.equal(routeGroupForPath("/api/admin/login/2fa"), "admin.2fa");
  const written: MinuteRow[][] = [];
  const store = createTelemetryStore({ write: async (rows) => { written.push(rows); }, clock: () => Date.UTC(2026, 10, 14, 10, 0, 0) });
  store.recordLoginFailure(routeGroupForPath("/api/admin/login"));
  store.recordLoginFailure(routeGroupForPath("/api/admin/login"));
  store.recordLoginFailure(routeGroupForPath("/api/auth/login"));
  await store.flush();
  store.stop();
  const byGroup = Object.fromEntries(written[0].map((row) => [row.routeGroup, row.loginFailures]));
  assert.deepEqual(byGroup, { "admin.login": 2, "auth.login": 1 });
  const route = read("app/api/admin/login/route.ts");
  assert.equal((route.match(/eventType: "LOGIN_FAILURE", path: "\/api\/admin\/login"/g) ?? []).length, 3, "absent, inactive and wrong password are all recorded");
  assert.match(route, /export const POST = withSecurityTelemetry\("admin\.login", handlePOST\);/);
});

test("checkout, cart and order code is untouched by this change", () => {
  for (const path of ["app/api/orders/route.ts", "app/api/cart/route.ts", "app/api/cart/items/route.ts"]) {
    const source = read(path);
    assert.doesNotMatch(source, /admin-login-rate-limit|admin-surface/, path);
  }
});
