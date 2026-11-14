import { NextRequest, NextResponse } from "next/server";
import { csrfRejection } from "@/lib/csrf";
import { createSession } from "@/lib/auth";
import { readJsonBodyLimited } from "@/lib/request-json";
import { expiredChallengeCookie, readChallenge, verifySecondFactor } from "@/lib/admin-2fa";
import { withSecurityTelemetry } from "@/lib/security-monitoring/runtime";
import { adminRateLimitedResponseParts } from "@/lib/admin-login-rate-limit";
import { ADMIN_2FA_IP_RATE_LIMIT } from "@/lib/admin-2fa-policy";

const headers = { "Cache-Control": "no-store" };

/**
 * Second login step for an enrolled ADMIN. Requires the challenge cookie from a correct password (readChallenge
 * re-checks role ADMIN, active account and unchanged password). The session is created only after a valid code.
 */
async function handlePOST(request: NextRequest) {
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  const admin = await readChallenge(request, "code");
  if (!admin) return NextResponse.json({ error: "Giriş mərhələsinin vaxtı bitib. Şifrə ilə yenidən daxil olun.", code: "CHALLENGE_EXPIRED" }, { status: 401, headers });
  const body = await readJsonBodyLimited(request, 1_024);
  const value = body.ok && body.value && typeof body.value === "object" ? body.value as Record<string, unknown> : null;
  if (!value) return NextResponse.json({ error: "Sorğu məlumatı yanlışdır" }, { status: 400, headers });

  const result = await verifySecondFactor(request, admin.id, { code: value.code, recoveryCode: value.recoveryCode });
  if (!result.ok) {
    switch (result.reason) {
      case "locked": {
        const minutes = result.lockedUntil ? Math.max(1, Math.ceil((result.lockedUntil.getTime() - Date.now()) / 60_000)) : 15;
        return NextResponse.json({ error: `Çox sayda yanlış kod daxil edildi. ${minutes} dəqiqə sonra yenidən cəhd edin.`, code: "LOCKED" }, { status: 423, headers });
      }
      case "rate-limited": {
        // Every 2FA code limit (per account, per IP, unknown-IP) uses the same 15-minute fixed window.
        const limited = adminRateLimitedResponseParts(ADMIN_2FA_IP_RATE_LIMIT.windowMs);
        return NextResponse.json({ error: limited.error, code: "RATE_LIMITED" }, { status: 429, headers: { ...headers, "Retry-After": limited.retryAfterSeconds } });
      }
      case "key-unavailable":
        return NextResponse.json({ error: "Autentifikator kodu hazırda yoxlanıla bilmir. Bərpa kodundan istifadə edin.", code: "TOTP_UNAVAILABLE" }, { status: 503, headers });
      case "not-enrolled":
        return NextResponse.json({ error: "Giriş mərhələsinin vaxtı bitib. Şifrə ilə yenidən daxil olun.", code: "CHALLENGE_EXPIRED" }, { status: 401, headers });
      default:
        return NextResponse.json({ error: "Kod yanlışdır və ya vaxtı keçib.", code: "INVALID_CODE" }, { status: 400, headers });
    }
  }
  const response = NextResponse.json({ ok: true, method: result.method, ...(result.method === "recovery" ? { remainingRecoveryCodes: result.remainingRecoveryCodes } : {}) }, { headers });
  response.cookies.set(await createSession(admin.id));
  response.cookies.set(await expiredChallengeCookie());
  return response;
}

/** Security Center telemetry: status and duration counted under "admin.2fa" (never affects the response). */
export const POST = withSecurityTelemetry("admin.2fa", handlePOST);
