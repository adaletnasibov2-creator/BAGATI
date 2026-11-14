import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import { adminSectionSource } from "./admin-section-source";
import {
  ADMIN_IDLE_TIMEOUT_MS, ADMIN_SESSION_TTL_SECONDS, DEFAULT_SESSION_TTL_SECONDS, isSessionIdleExpired, sessionTtlSeconds, shouldWriteLastSeen, summarizeUserAgent, tracksSessionActivity,
} from "../lib/session-policy";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const STATE_CHANGING_ROUTES = [
  "app/api/admin/login/2fa/route.ts",
  "app/api/admin/2fa/setup/route.ts",
  "app/api/admin/2fa/activate/route.ts",
  "app/api/admin/2fa/disable/route.ts",
  "app/api/admin/sessions/route.ts",
];

test("every new state-changing route checks the same origin first, then ADMIN authorization", () => {
  for (const path of STATE_CHANGING_ROUTES) {
    const source = read(path);
    // Security Center phase 1: the handler is exported through the telemetry wrapper; its body is unchanged.
    assert.match(source, /(export async function POST|async function handlePOST)\(request: NextRequest\) \{\s*const crossSite = csrfRejection\(request\);\s*if \(crossSite\) return crossSite;/, path);
    if (source.includes("async function handlePOST(")) assert.match(source, /export const POST = withSecurityTelemetry\("admin\.(2fa|login)", handlePOST\);/, path);
    assert.doesNotMatch(source, /export async function (GET|PUT|PATCH|DELETE)/, path);
    assert.match(source, /readJsonBodyLimited\(request, 1_024\)|status: 403/, path);
  }
  // Signed-in admin routes.
  for (const path of ["app/api/admin/2fa/disable/route.ts", "app/api/admin/sessions/route.ts"]) {
    assert.match(read(path), /const admin = await requireRole\("ADMIN"\);\s*if \(!admin\) return NextResponse\.json\(\{ error: "İcazə yoxdur" \}, \{ status: 403/, path);
  }
  // Enrollment: a signed-in ADMIN, or the forced-enrollment challenge issued to an ADMIN after the password.
  for (const path of ["app/api/admin/2fa/setup/route.ts", "app/api/admin/2fa/activate/route.ts"]) {
    assert.match(read(path), /const actor = await resolveEnrollmentActor\(request\);[^\n]*\n\s*if \(!actor\) return NextResponse\.json\(\{ error: "İcazə yoxdur" \}, \{ status: 403/, path);
  }
  const lib = read("lib/admin-2fa.ts");
  assert.match(lib, /export async function resolveEnrollmentActor[\s\S]*?const admin = await requireRole\("ADMIN"\);[\s\S]*?readChallenge\(request, "enroll"\)/);
  // The challenge is only honoured for an active ADMIN whose password has not changed since it was issued.
  assert.match(lib, /if \(!user \|\| user\.role !== "ADMIN" \|\| !user\.isActive \|\| passwordFingerprint\(user\.passwordHash\) !== payload\.pwf\) return null;/);
  assert.match(read("app/api/admin/login/2fa/route.ts"), /const admin = await readChallenge\(request, "code"\);\s*if \(!admin\) return/);
});

test("new admin pages require ADMIN", () => {
  for (const path of ["app/admin/security/page.tsx", "app/admin/security/sessions/page.tsx"]) {
    assert.match(read(path), /const admin = await requireRole\("ADMIN"\);\s*if \(!admin\) redirect\("\/admin\/login"\)/, path);
  }
  assert.doesNotMatch(adminSectionSource(), /route==="security"/, "old catch-all branch removed");
  const shell = read("components/admin-shell.tsx");
  assert.match(shell, /\["\/admin\/security\/sessions", "Aktiv sessiyalar", MonitorSmartphone\]/);
  assert.match(shell, /\["\/admin\/security", "Hesab təhlükəsizliyi", ShieldCheck\]/);
});

test("cross-origin POSTs to every new route are rejected before any session or database access", async () => {
  const { NextRequest } = await import("next/server");
  for (const path of STATE_CHANGING_ROUTES) {
    const route = await import(`../${path.replace(/\.ts$/, "")}`) as { POST: (request: InstanceType<typeof NextRequest>) => Promise<Response>; GET?: unknown };
    assert.equal(route.GET, undefined, `${path} exports no GET`);
    const url = `http://localhost:3000/${path.replace(/^app\//, "").replace(/\/route\.ts$/, "")}`;
    const response = await route.POST(new NextRequest(url, { method: "POST", headers: { host: "localhost:3000", origin: "https://evil.example", "content-type": "application/json" }, body: "{}" }));
    assert.equal(response.status, 403, path);
    assert.equal((await response.json()).code, "CROSS_SITE_REQUEST", path);
  }
});

test("the password step creates no admin session while a second factor is pending", () => {
  const route = read("app/api/admin/login/route.ts");
  const stepCheck = route.indexOf("adminLoginNextStep(");
  const sessionCreate = route.indexOf("await createSession(user.id)");
  assert.ok(stepCheck > 0 && sessionCreate > stepCheck, "next-step decision happens before createSession");
  const pending = route.slice(stepCheck, sessionCreate);
  assert.match(pending, /if \(step === "code" \|\| step === "enroll"\) \{[\s\S]*?response\.cookies\.set\(await challengeCookie\(user\.id, user\.passwordHash, step\)\);\s*return response;/);
  assert.match(pending, /if \(step === "blocked-key-missing"\) \{[\s\S]*?return NextResponse\.json/);
  assert.doesNotMatch(pending, /createSession/);
});

test("the challenge cookie is HttpOnly, SameSite=Strict, scoped to /api/admin and is not a session token", () => {
  const lib = read("lib/admin-2fa.ts");
  assert.match(lib, /const CHALLENGE_PATH = "\/api\/admin";/);
  assert.match(lib, /httpOnly: true, sameSite: "strict" as const, secure: await requestCookieSecure\(\), path: CHALLENGE_PATH/);
  assert.match(lib, /code: "bagati-admin-2fa-code", enroll: "bagati-admin-2fa-enroll"/);
  assert.match(read("lib/auth.ts"), /audience: "bagati-session"/, "sessions only accept the session audience");
});

/** Every place that can create a session. A new caller must be reviewed for the admin second factor. */
test("only reviewed code paths create sessions; customer, vendor and Google logins refuse ADMIN", () => {
  const callers: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry) && /\bcreateSession\(/.test(readFileSync(full, "utf8"))) callers.push(relative(root, full).replaceAll("\\", "/"));
    }
  };
  walk(resolve(root, "app"));
  assert.deepEqual(callers.sort(), [
    "app/api/account/security/password/route.ts",
    "app/api/admin/2fa/activate/route.ts",
    "app/api/admin/login/2fa/route.ts",
    "app/api/admin/login/route.ts",
    "app/api/auth/google/callback/route.ts",
    "app/api/auth/google/link/route.ts",
    "app/api/auth/login/route.ts",
    "app/api/auth/vendor-login/route.ts",
  ]);
  assert.match(read("app/api/auth/login/route.ts"), /if \(user\.role !== "CUSTOMER"\)/);
  assert.match(read("lib/email-verification.ts"), /export function mayUseVendorLogin\(role: Role\) \{\s*return role === Role\.VENDOR;/);
  assert.match(read("lib/google-link.ts"), /return role === "CUSTOMER" \|\| role === "VENDOR";/);
  assert.match(read("lib/google-oauth-decision.ts"), /return intent === "vendor" \? "VENDOR" : "CUSTOMER";/);
  // Password change: requires the signed-in user (already past 2FA), revokes every session, issues a fresh one.
  const password = read("app/api/account/security/password/route.ts");
  assert.match(password, /authSession\.updateMany\(\{ where: \{ userId: user\.id, revokedAt: null \}/);
});

test("2FA audit entries and security events carry no secrets", () => {
  const lib = read("lib/admin-2fa.ts");
  const auditCalls = lib.match(/audit\([^;]*;/g) ?? [];
  assert.ok(auditCalls.length >= 6);
  for (const call of auditCalls) assert.doesNotMatch(call, /secret|codeHash|recoveryCodes?:\s*codes\s*[,}]|hashes|password[^"]|input\.code|value\.code|normalized/i, call);
  for (const action of ["ADMIN_2FA_ENROLLED", "ADMIN_2FA_DISABLED", "ADMIN_2FA_FAILED", "ADMIN_2FA_LOCKED", "ADMIN_2FA_RECOVERY_CODE_USED"]) assert.match(lib, new RegExp(`"${action}"`));
  const sessions = read("lib/admin-sessions.ts");
  assert.match(sessions, /"ADMIN_SESSION_REVOKED"/);
  assert.match(sessions, /"ADMIN_SESSIONS_REVOKED"/);
  assert.match(sessions, /entityId: sessionReference\(sessionId\)/, "only a session id prefix is audited");
  assert.match(lib, /captureApplicationSecurityEvent\(\{ request, eventType: next\?\.lockedNow \? "RATE_LIMIT_VIOLATION" : "LOGIN_FAILURE", path: CODE_PATH \}\)/);
});

test("admin sessions last 12 hours with a 2-hour idle timeout; other roles keep 7 days", () => {
  assert.equal(ADMIN_SESSION_TTL_SECONDS, 12 * 3600);
  assert.equal(sessionTtlSeconds("ADMIN"), 12 * 3600);
  assert.equal(sessionTtlSeconds("VENDOR"), DEFAULT_SESSION_TTL_SECONDS);
  assert.equal(sessionTtlSeconds("CUSTOMER"), 7 * 24 * 3600);
  assert.equal(tracksSessionActivity("ADMIN"), true);
  assert.equal(tracksSessionActivity("CUSTOMER"), false);
  const now = new Date("2026-11-13T12:00:00Z");
  const createdAt = new Date(now.getTime() - 5 * 3600_000);
  assert.equal(isSessionIdleExpired({ role: "ADMIN", lastSeenAt: new Date(now.getTime() - ADMIN_IDLE_TIMEOUT_MS + 1000), createdAt, now }), false);
  assert.equal(isSessionIdleExpired({ role: "ADMIN", lastSeenAt: new Date(now.getTime() - ADMIN_IDLE_TIMEOUT_MS - 1000), createdAt, now }), true);
  assert.equal(isSessionIdleExpired({ role: "ADMIN", lastSeenAt: null, createdAt, now }), true, "falls back to createdAt");
  assert.equal(isSessionIdleExpired({ role: "VENDOR", lastSeenAt: null, createdAt: new Date(0), now }), false, "no idle timeout for other roles");
  assert.equal(shouldWriteLastSeen(null, now), true);
  assert.equal(shouldWriteLastSeen(new Date(now.getTime() - 60_000), now), false);
  assert.equal(shouldWriteLastSeen(new Date(now.getTime() - 5 * 60_000), now), true);
  const auth = read("lib/auth.ts");
  assert.match(auth, /const ttlSeconds = sessionTtlSeconds\(role\);/);
  assert.match(auth, /return sessionCookie\(token, ttlSeconds, await requestCookieSecure\(\)\);/);
  assert.match(auth, /isSessionIdleExpired\(/);
  assert.match(auth, /adminMayUseSession\(\{ required: isAdmin2faRequired\(\), enrolled: Boolean\(user\.adminTwoFactor\?\.enrolledAt\) \}\)/);
});

test("session metadata is display-safe: masked IP and a short browser summary only", () => {
  assert.equal(summarizeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"), "Chrome 140 · Windows");
  assert.equal(summarizeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"), "Safari 18 · iOS");
  assert.equal(summarizeUserAgent("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/139.0 Safari/537.36 Edg/139.0"), "Edge 139 · Windows");
  assert.equal(summarizeUserAgent(""), null);
  assert.ok((summarizeUserAgent("x".repeat(5000)) ?? "").length < 120);
  const auth = read("lib/auth.ts");
  assert.match(auth, /ipMasked: ip \? maskIpAddress\(ip\) : null/);
  assert.match(auth, /userAgent: summarizeUserAgent\(list\.get\("user-agent"\)\)/);
});

test("every session revocation path writes an audit entry (regression: forced enrollment revoked sessions silently)", () => {
  const activate = read("app/api/admin/2fa/activate/route.ts");
  assert.match(activate, /revokeOtherOwnSessions\(actor\.userId, await currentSessionId\(\), "2fa-enrolled"\)/);
  assert.match(activate, /revokeOtherOwnSessions\(actor\.userId, null, "2fa-enrolled"\)/);
  assert.doesNotMatch(activate, /revokeUserSessions\(/, "the unaudited helper is not used directly");
  const sessions = read("lib/admin-sessions.ts");
  assert.match(sessions, /export async function revokeOtherOwnSessions[\s\S]*?revokeUserSessions\(userId, currentSessionId\);[\s\S]*?action: "ADMIN_SESSIONS_REVOKED"/);
  assert.match(read("lib/admin-2fa.ts"), /"ADMIN_2FA_DISABLED", \{ method: factor\.method, revokedOtherSessions: revoked\.count \}/);
});
