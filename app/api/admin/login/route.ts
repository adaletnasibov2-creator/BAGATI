import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { logAuthFailure, logAuthRejection } from "@/lib/auth-logging";
import { wrongPortalBody } from "@/lib/login-portal";
import { authRateLimitKey, clearAuthRateLimit, consumeAuthRateLimit, LOGIN_RATE_LIMIT } from "@/lib/auth-rate-limit";
import { clearEmailVerificationContext } from "@/lib/email-verification";
import { captureApplicationSecurityEvent } from "@/lib/security-events";
import { admin2faKeyStatus } from "@/lib/admin-2fa-crypto";
import { adminLoginNextStep, isAdmin2faRequired } from "@/lib/admin-2fa-policy";
import { challengeCookie } from "@/lib/admin-2fa";
import { withSecurityTelemetry } from "@/lib/security-monitoring/runtime";

const schema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(128) });
async function handlePOST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Sorğu məlumatı yanlışdır" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "E-poçt və ya şifrə yanlışdır" }, { status: 400 });
  const email = parsed.data.email.trim().toLowerCase();
  let rateKey: string;
  try {
    rateKey = authRateLimitKey("login", email);
    if (!await consumeAuthRateLimit(rateKey, LOGIN_RATE_LIMIT.limit, LOGIN_RATE_LIMIT.windowMs)) {
      await captureApplicationSecurityEvent({ request, eventType: "RATE_LIMIT_VIOLATION", path: "/api/admin/login" });
      return NextResponse.json({ error: "Çox sayda giriş cəhdi edildi. Bir müddət sonra yenidən yoxlayın." }, { status: 429, headers: { "Cache-Control": "no-store" } });
    }
  } catch (error) {
    logAuthFailure("admin_login_rate_limit", error);
    return NextResponse.json({ error: "Giriş xidməti hazırda əlçatan deyil. Bir az sonra yenidən cəhd edin." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  let user;
  try { user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } }); }
  catch (error) {
    logAuthFailure("admin_login_user_lookup", error);
    return NextResponse.json({ error: "Giriş xidməti hazırda əlçatan deyil. Bir az sonra yenidən cəhd edin." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const invalid = NextResponse.json({ error: "E-poçt və ya şifrə yanlışdır" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (!user) {
    logAuthRejection("admin_login", "absent");
    await captureApplicationSecurityEvent({ request, eventType: "LOGIN_FAILURE", path: "/api/admin/login" });
    return invalid;
  }
  if (!user.isActive) {
    logAuthRejection("admin_login", "inactive");
    await captureApplicationSecurityEvent({ request, eventType: "LOGIN_FAILURE", path: "/api/admin/login" });
    return invalid;
  }
  if (!user.passwordAuthEnabled || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    logAuthRejection("admin_login", user.passwordAuthEnabled ? "password-mismatch" : "password-disabled");
    await captureApplicationSecurityEvent({ request, eventType: "LOGIN_FAILURE", path: "/api/admin/login" });
    return invalid;
  }
  if (user.role !== "ADMIN") {
    logAuthRejection("admin_login", "wrong-portal", user.role);
    try { await clearAuthRateLimit(rateKey); }
    catch (error) { logAuthFailure("admin_login_rate_limit_clear", error); }
    return NextResponse.json(wrongPortalBody(user.role), { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  try { await clearAuthRateLimit(rateKey); }
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
    await clearEmailVerificationContext(response);
    return response;
  } catch (error) {
    logAuthFailure("admin_login_session_create", error);
    return NextResponse.json({ error: "Giriş tamamlana bilmədi. Bir az sonra yenidən cəhd edin." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

/** Security Center telemetry: status and duration counted under "admin.login" (never affects the response). */
export const POST = withSecurityTelemetry("admin.login", handlePOST);
