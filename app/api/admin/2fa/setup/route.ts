import { NextRequest, NextResponse } from "next/server";
import { csrfRejection } from "@/lib/csrf";
import { readJsonBodyLimited } from "@/lib/request-json";
import { Admin2faError, admin2faErrorMessage, assertEnrollmentPassword, resolveEnrollmentActor, startEnrollment } from "@/lib/admin-2fa";
import { withSecurityTelemetry } from "@/lib/security-monitoring/runtime";

const headers = { "Cache-Control": "no-store" };

/** Starts 2FA enrollment: returns a locally generated QR (SVG) and the manual key. ADMIN only (session or forced-enrollment challenge). */
async function handlePOST(request: NextRequest) {
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  const actor = await resolveEnrollmentActor(request); // signed-in ADMIN session, or the ADMIN-only enrollment challenge
  if (!actor) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403, headers });
  // The forced-enrollment page sends {}; only the signed-in session path needs { password } (SEC-FIX-1 M1).
  const body = await readJsonBodyLimited(request, 1_024);
  const value = body.ok && body.value && typeof body.value === "object" ? body.value as Record<string, unknown> : {};
  try {
    await assertEnrollmentPassword(request, actor, value.password);
    const setup = await startEnrollment(actor);
    return NextResponse.json({ qrSvg: setup.qrSvg, manualKey: setup.manualKey }, { headers });
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
