import { NextRequest, NextResponse } from "next/server";
import { bodyTooLargeResponse, JSON_BODY_LIMITS, readJsonCapped } from "@/lib/json-body";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { findUserByLoginEmail } from "@/lib/login-user-lookup";
import { createSession } from "@/lib/auth";
import { logAuthFailure, logAuthRejection } from "@/lib/auth-logging";
import { wrongPortalBody } from "@/lib/login-portal";
import { clearAuthRateLimit, consumeAuthRateLimit, LOGIN_RATE_LIMIT, loginRateLimitKey } from "@/lib/auth-rate-limit";
import { equalizeLoginTiming } from "@/lib/login-timing";
import { auditAdminLoginFailure, auditAdminLogin } from "@/lib/admin-login-audit";
import { clearEmailVerificationContext } from "@/lib/email-verification";
import { captureApplicationSecurityEvent } from "@/lib/security-events";
import { admin2faKeyStatus } from "@/lib/admin-2fa-crypto";
import { adminLoginNextStep, isAdmin2faRequired } from "@/lib/admin-2fa-policy";
import { challengeCookie } from "@/lib/admin-2fa";
import { withSecurityTelemetry } from "@/lib/security-monitoring/runtime";
import { adminLoginIpBucket, adminRateLimitedResponseParts } from "@/lib/admin-login-rate-limit";

const schema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(128) });
async function handlePOST(request: NextRequest) {
  let body: unknown;
  try { body = await readJsonCapped(request, JSON_BODY_LIMITS.small); } catch (error) { return bodyTooLargeResponse(error) ?? NextResponse.json({ error: "Sorğu məlumatı yanlışdır" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "E-poçt və ya şifrə yanlışdır" }, { status: 400 });
  const email = parsed.data.email.trim().toLowerCase();
  let rateKey: string;
  const ipBucket = adminLoginIpBucket(request.headers);
  try {
    // Per client IP first (shared stricter bucket when the IP is unknown), so one IP over its limit does not also
    // use up the account's attempts. Fixed windows: never a permanent lockout.
    if (!await consumeAuthRateLimit(ipBucket.key, ipBucket.limit, ipBucket.windowMs)) {
      await captureApplicationSecurityEvent({ request, eventType: "RATE_LIMIT_VIOLATION", path: "/api/admin/login" });
      const limited = adminRateLimitedResponseParts(ipBucket.windowMs);
      return NextResponse.json({ error: limited.error, code: "RATE_LIMITED" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": limited.retryAfterSeconds } });
    }
    rateKey = loginRateLimitKey("admin", email);
    if (!await consumeAuthRateLimit(rateKey, LOGIN_RATE_LIMIT.limit, LOGIN_RATE_LIMIT.windowMs)) {
      await captureApplicationSecurityEvent({ request, eventType: "RATE_LIMIT_VIOLATION", path: "/api/admin/login" });
      return NextResponse.json({ error: "Çox sayda giriş cəhdi edildi. Bir müddət sonra yenidən yoxlayın." }, { status: 429, headers: { "Cache-Control": "no-store" } });
    }
  } catch (error) {
    logAuthFailure("admin_login_rate_limit", error);
    return NextResponse.json({ error: "Giriş xidməti hazırda əlçatan deyil. Bir az sonra yenidən cəhd edin." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  let user;
  try { user = await findUserByLoginEmail(prisma, email) /* unique-index lookup (lib/login-user-lookup.ts, SCALE-FIX-2 A8) */; }
  catch (error) {
    logAuthFailure("admin_login_user_lookup", error);
    return NextResponse.json({ error: "Giriş xidməti hazırda əlçatan deyil. Bir az sonra yenidən cəhd edin." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const invalid = NextResponse.json({ error: "E-poçt və ya şifrə yanlışdır" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (!user) {
    await equalizeLoginTiming(parsed.data.password);
    logAuthRejection("admin_login", "absent");
    await captureApplicationSecurityEvent({ request, eventType: "LOGIN_FAILURE", path: "/api/admin/login" });
    return invalid;
  }
  if (!user.isActive) {
    await equalizeLoginTiming(parsed.data.password);
    logAuthRejection("admin_login", "inactive");
    auditAdminLoginFailure(request, user, "admin", "inactive"); // SECURITY-PAGE-1: admin accounts only, background
    await captureApplicationSecurityEvent({ request, eventType: "LOGIN_FAILURE", path: "/api/admin/login" });
    return invalid;
  }
  if (!user.passwordAuthEnabled) await equalizeLoginTiming(parsed.data.password);
  if (!user.passwordAuthEnabled || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    logAuthRejection("admin_login", user.passwordAuthEnabled ? "password-mismatch" : "password-disabled");
    auditAdminLoginFailure(request, user, "admin", user.passwordAuthEnabled ? "password" : "password-disabled");
    await captureApplicationSecurityEvent({ request, eventType: "LOGIN_FAILURE", path: "/api/admin/login" });
    return invalid;
  }
  if (user.role !== "ADMIN") {
    logAuthRejection("admin_login", "wrong-portal", user.role);
    try { await clearAuthRateLimit(rateKey); }
    catch (error) { logAuthFailure("admin_login_rate_limit_clear", error); }
    return NextResponse.json(wrongPortalBody(user.role), { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  try {
    await clearAuthRateLimit(rateKey);
    // A correct ADMIN password also resets this IP's bucket; the shared unknown-IP bucket is left to its window.
    if (ipBucket.scope === "ip") await clearAuthRateLimit(ipBucket.key);
  }
  catch (error) { logAuthFailure("admin_login_rate_limit_clear", error); }
  // Second factor: no session is created until it passes. Admins without 2FA keep today's flow unless it is required.
  try {
    const twoFactor = await prisma.adminTwoFactor.findUnique({ where: { userId: user.id }, select: { enrolledAt: true } });
    const keyStatus = admin2faKeyStatus();
    const step = adminLoginNextStep({ enrolled: Boolean(twoFactor?.enrolledAt), required: isAdmin2faRequired(), keyStatus });
    if (step === "blocked-key-missing") {
      logAuthRejection("admin_login", "2fa-key-missing");
      return NextResponse.json({ error: "İki mərhələli təsdiq məcburidir, lakin server açarı konfiqurasiya edilməyib. Sistem administratoru ilə əlaqə saxlayın.", code: "ADMIN_2FA_KEY_MISSING" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    if (step === "code" || step === "enroll") {
      const response = NextResponse.json({ next: step, ...(step === "code" ? { totpAvailable: keyStatus === "configured" } : {}) }, { headers: { "Cache-Control": "no-store" } });
      response.cookies.set(await challengeCookie(user.id, user.passwordHash, step));
      return response;
    }
  } catch (error) {
    logAuthFailure("admin_login_2fa_lookup", error);
    return NextResponse.json({ error: "Giriş xidməti hazırda əlçatan deyil. Bir az sonra yenidən cəhd edin." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const session = await createSession(user.id);
    const response = NextResponse.json({ user: { id: user.id, email: user.email, role: user.role } }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(session);
    auditAdminLogin(request, user.id, session.value, "password"); // SECURITY-PAGE-1: background, never blocks the login
    await clearEmailVerificationContext(response);
    return response;
  } catch (error) {
    logAuthFailure("admin_login_session_create", error);
    return NextResponse.json({ error: "Giriş tamamlana bilmədi. Bir az sonra yenidən cəhd edin." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

/** Security Center telemetry: status and duration counted under "admin.login" (never affects the response). */
export const POST = withSecurityTelemetry("admin.login", handlePOST);
