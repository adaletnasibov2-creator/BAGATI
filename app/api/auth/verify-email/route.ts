import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { enqueueEmail } from "@/lib/email-outbox";
import { clearEmailVerificationContext, readEmailVerificationContext } from "@/lib/email-verification";
import { createSession } from "@/lib/auth";
import { handleVerifyEmail } from "@/lib/email-verification-route";

/**
 * E-mail verification code. The logic lives in lib/email-verification-route.ts (unit-tested with stand-ins); this route
 * passes the real database, verification-context cookie, session and outbox (SIGNUP-EASY-1).
 */
export async function POST(request: NextRequest) {
  return handleVerifyEmail(request, {
    db: prisma,
    readContext: readEmailVerificationContext,
    clearContext: clearEmailVerificationContext,
    createSession,
    enqueueEmail,
  });
}
