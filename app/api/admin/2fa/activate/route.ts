import { NextRequest, NextResponse } from "next/server";
import { csrfRejection } from "@/lib/csrf";
import { createSession, currentSessionId, revokeUserSessions } from "@/lib/auth";
import { readJsonBodyLimited } from "@/lib/request-json";
import { Admin2faError, activateEnrollment, admin2faErrorMessage, expiredChallengeCookie, resolveEnrollmentActor } from "@/lib/admin-2fa";
import { revokeOtherOwnSessions } from "@/lib/admin-sessions";

const headers = { "Cache-Control": "no-store" };

/**
 * Activates 2FA with one valid code and returns the 10 recovery codes once. Other sessions are revoked.
 * In forced enrollment (no session yet) the admin is signed in only after activation succeeds.
 */
export async function POST(request: NextRequest) {
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  const actor = await resolveEnrollmentActor(request); // signed-in ADMIN session, or the ADMIN-only enrollment challenge
  if (!actor) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403, headers });
  const body = await readJsonBodyLimited(request, 1_024);
  const value = body.ok && body.value && typeof body.value === "object" ? body.value as Record<string, unknown> : null;
  if (!value) return NextResponse.json({ error: "Sorğu məlumatı yanlışdır" }, { status: 400, headers });
  try {
    const recoveryCodes = await activateEnrollment(request, actor, value.code);
    if (actor.via === "session") {
      const revoked = await revokeOtherOwnSessions(actor.userId, await currentSessionId(), "2fa-enrolled");
      return NextResponse.json({ recoveryCodes, revokedOtherSessions: revoked }, { headers });
    }
    await revokeUserSessions(actor.userId, null);
    const response = NextResponse.json({ recoveryCodes, signedIn: true }, { headers });
    response.cookies.set(await createSession(actor.userId));
    response.cookies.set(await expiredChallengeCookie());
    return response;
  } catch (error) {
    if (error instanceof Admin2faError) {
      const { status, error: message } = admin2faErrorMessage(error.code);
      return NextResponse.json({ error: message, code: error.code }, { status, headers });
    }
    throw error;
  }
}
