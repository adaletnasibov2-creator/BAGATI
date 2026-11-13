import { NextRequest, NextResponse } from "next/server";
import { csrfRejection } from "@/lib/csrf";
import { currentSessionId, requireRole } from "@/lib/auth";
import { readJsonBodyLimited } from "@/lib/request-json";
import { Admin2faError, admin2faErrorMessage, disableTwoFactor } from "@/lib/admin-2fa";
import { withSecurityTelemetry } from "@/lib/security-monitoring/runtime";

const headers = { "Cache-Control": "no-store" };

/** Turns 2FA off for the signed-in admin after the password and a current code. Revokes the other sessions. */
async function handlePOST(request: NextRequest) {
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403, headers });
  const body = await readJsonBodyLimited(request, 1_024);
  const value = body.ok && body.value && typeof body.value === "object" ? body.value as Record<string, unknown> : null;
  if (!value) return NextResponse.json({ error: "Sorğu məlumatı yanlışdır" }, { status: 400, headers });
  try {
    const revoked = await disableTwoFactor(request, admin.id, await currentSessionId(), { password: value.password, code: value.code, recoveryCode: value.recoveryCode });
    return NextResponse.json({ ok: true, revokedOtherSessions: revoked, message: "İki mərhələli təsdiq söndürüldü. Digər sessiyalar bağlandı." }, { headers });
  } catch (error) {
    if (error instanceof Admin2faError) {
      const { status, error: message } = admin2faErrorMessage(error.code);
      return NextResponse.json({ error: message, code: error.code }, { status, headers });
    }
    throw error;
  }
}

/** Security Center telemetry: status and duration counted under "admin.2fa" (never affects the response). */
export const POST = withSecurityTelemetry("admin.2fa", handlePOST);
