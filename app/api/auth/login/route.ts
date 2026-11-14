import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { logAuthFailure, logAuthRejection } from "@/lib/auth-logging";
import { wrongPortalBody } from "@/lib/login-portal";
import { authRateLimitKey, clearAuthRateLimit, consumeAuthRateLimit, LOGIN_RATE_LIMIT } from "@/lib/auth-rate-limit";
import { loginSchema } from "@/lib/validation";
import { attachEmailVerificationContext, clearEmailVerificationContext, createEmailVerificationContext, emailVerificationRequired } from "@/lib/email-verification";
import { captureApplicationSecurityEvent } from "@/lib/security-events";
import { applyGoogleLink, expiredGoogleLinkCookie } from "@/lib/google-link";
import { withSecurityTelemetry } from "@/lib/security-monitoring/runtime";

async function handlePOST(request: NextRequest) {
  let data: unknown;
  try {
    data = await request.json();
  } catch {
    return NextResponse.json({ error: "Sorğu məlumatları yanlışdır." }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(data);
  if (!parsed.success) return NextResponse.json({ error: "E-poçt və ya şifrə yanlışdır." }, { status: 400 });
  const email = parsed.data.email.trim().toLowerCase();
  let rateKey: string;
  try {
    rateKey = authRateLimitKey("login", email);
    if (!await consumeAuthRateLimit(rateKey, LOGIN_RATE_LIMIT.limit, LOGIN_RATE_LIMIT.windowMs)) {
      await captureApplicationSecurityEvent({ request, eventType: "RATE_LIMIT_VIOLATION", path: "/api/auth/login" });
      return NextResponse.json({ error: "Çox sayda giriş cəhdi edildi. Bir müddət sonra yenidən yoxlayın." }, { status: 429, headers: { "Cache-Control": "no-store" } });
    }
  } catch (error) {
    logAuthFailure("login_rate_limit", error);
    return NextResponse.json({ error: "Giriş xidməti hazırda əlçatan deyil. Bir az sonra yenidən cəhd edin." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  let user;
  try { user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } }); }
  catch (error) {
    logAuthFailure("login_user_lookup", error);
    return NextResponse.json({ error: "Giriş xidməti hazırda əlçatan deyil. Bir az sonra yenidən cəhd edin." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const invalid = NextResponse.json({ error: "E-poçt və ya şifrə yanlışdır." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (!user) {
    logAuthRejection("customer_login", "absent");
    await captureApplicationSecurityEvent({ request, eventType: "LOGIN_FAILURE", path: "/api/auth/login" });
    return invalid;
  }
  if (!user.isActive) {
    logAuthRejection("customer_login", "inactive");
    await captureApplicationSecurityEvent({ request, eventType: "LOGIN_FAILURE", path: "/api/auth/login" });
    return invalid;
  }
  if (!user.passwordAuthEnabled || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    logAuthRejection("customer_login", user.passwordAuthEnabled ? "password-mismatch" : "password-disabled");
    await captureApplicationSecurityEvent({ request, eventType: "LOGIN_FAILURE", path: "/api/auth/login" });
    return invalid;
  }
  if (user.role !== "CUSTOMER") {
    logAuthRejection("customer_login", "wrong-portal", user.role);
    try { await clearAuthRateLimit(rateKey); }
    catch (error) { logAuthFailure("login_rate_limit_clear", error); }
    return NextResponse.json(wrongPortalBody(user.role), { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  try { await clearAuthRateLimit(rateKey); }
  catch (error) { logAuthFailure("login_rate_limit_clear", error); }

  if (emailVerificationRequired(user.role, user.emailVerifiedAt)) {
    const context = await createEmailVerificationContext(user.id, user.role);
    const verificationPath = "/verify-email";
    const response = NextResponse.json(
      { error: "Email ünvanınızı təsdiqləyin.", requiresEmailVerification: true, verificationPath },
      { status: 403 },
    );
    await attachEmailVerificationContext(response, context);
    return response;
  }

  let googleLink: string | null = null;
  let clearGoogleLink = false;
  try {
    const applied = await applyGoogleLink(request, user);
    googleLink = applied.result;
    clearGoogleLink = applied.clearCookie;
  } catch (error) {
    logAuthFailure("google_link_consume", error);
  }

  try {
    const session = await createSession(user.id);
    const response = NextResponse.json({ user: { id: user.id, email: user.email, role: user.role }, ...(googleLink ? { googleLink } : {}) }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(session);
    if (clearGoogleLink) response.cookies.set(expiredGoogleLinkCookie());
    await clearEmailVerificationContext(response);
    return response;
  } catch (error) {
    logAuthFailure("login_session_create", error);
    return NextResponse.json({ error: "Giriş tamamlana bilmədi. Bir az sonra yenidən cəhd edin." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

/** Security Center telemetry: status and duration counted under "auth.login" (never affects the response). */
export const POST = withSecurityTelemetry("auth.login", handlePOST);
