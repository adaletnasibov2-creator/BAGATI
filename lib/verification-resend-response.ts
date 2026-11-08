import { NextResponse } from "next/server";

/** Same response for absent, ineligible, rate-limited and queued resend requests. */
export function verificationResendAcknowledgement() {
  return NextResponse.json({ requestAccepted: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
