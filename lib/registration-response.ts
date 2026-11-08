import { randomUUID } from "node:crypto";
import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { attachEmailVerificationContext, createEmailVerificationContext } from "@/lib/email-verification";

/** Identical acknowledgement for new and existing addresses to avoid account enumeration. */
export async function registrationAcknowledgement(userId: string | null, role: Role, verificationPath: string) {
  const context = await createEmailVerificationContext(userId ?? randomUUID(), role);
  const response = NextResponse.json({ requestAccepted: true, verificationPath }, { status: 202, headers: { "Cache-Control": "no-store" } });
  attachEmailVerificationContext(response, context);
  return response;
}
