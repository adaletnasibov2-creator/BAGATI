import { NextRequest, NextResponse } from "next/server";
import { bodyTooLargeResponse, JSON_BODY_LIMITS, readJsonCapped } from "@/lib/json-body";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { findUserIdsByNormalizedEmail } from "@/lib/login-user-lookup";
import { logAuthFailure } from "@/lib/auth-logging";
import { registerSchema } from "@/lib/validation";
import { enqueueVerificationEmail } from "@/lib/email-outbox";
import { registrationAcknowledgement } from "@/lib/registration-response";
import { isDuplicateEmailError, resumableRegistrationUserId } from "@/lib/registration-errors";
import { authRateLimitKey, consumeAuthProcessRateLimit, consumeAuthRateLimit, REGISTRATION_IP_RATE_LIMIT, REGISTRATION_RATE_LIMIT } from "@/lib/auth-rate-limit";
import { trustedCloudflareClientIp } from "@/lib/trusted-proxy";
import {
  EMAIL_CODE_TTL_MS,
  generateVerificationCode,
  hashVerificationCode,
} from "@/lib/email-verification";
import { withSecurityTelemetry } from "@/lib/security-monitoring/runtime";
import { recordAcceptance } from "@/lib/legal-acceptance";
import { LEGAL_GATE_MESSAGES, TERMS_REQUIRED } from "@/lib/legal-gates";

/**
 * Resume path (an unverified account re-registering with the same password): the person ticked the box again, so
 * the acceptance is recorded for that account. A failure is logged and never changes the acknowledgement (which
 * must look the same for new and existing addresses); the checkout gate asks again if no row was written.
 */
async function recordResumedAcceptance(userId: string | null) {
  if (!userId) return;
  try {
    await prisma.$transaction((tx) => recordAcceptance(tx, { userId, document: "CUSTOMER_TERMS", source: "REGISTER_EMAIL" }));
  } catch (error) {
    logAuthFailure("customer_registration_terms_resume", error);
  }
}

/**
 * The account for this email, if any: one probe of the unique index on lower(btrim(email)) (SCALE-FIX-3, A8 follow-up;
 * it was an ILIKE scan), then the row by id with the fields the resume path needs.
 */
async function findRegistrationUser(email: string) {
  const [id] = await findUserIdsByNormalizedEmail(prisma, email);
  return id ? prisma.user.findUnique({ where: { id }, select: { id: true, passwordHash: true, role: true, emailVerifiedAt: true } }) : null;
}

async function handlePOST(request: NextRequest) {
  let data: unknown;
  try {
    data = await readJsonCapped(request, JSON_BODY_LIMITS.small);
  } catch (error) {
    return bodyTooLargeResponse(error) ?? NextResponse.json({ error: "Sorğu məlumatları yanlışdır." }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(data);
  if (!parsed.success) {
    const termsMissing = parsed.error.issues.some((issue) => issue.path[0] === "acceptTerms");
    return NextResponse.json(
      termsMissing
        ? { error: LEGAL_GATE_MESSAGES.registerTerms, code: TERMS_REQUIRED, details: parsed.error.flatten() }
        : { error: "Məlumatları yoxlayın.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const email = parsed.data.email.toLowerCase();
  if (!consumeAuthProcessRateLimit("registration", 120, 60_000)) {
    return registrationAcknowledgement(null, "CUSTOMER", "/verify-email");
  }
  try {
    const emailAllowed = await consumeAuthRateLimit(
      authRateLimitKey("registration", email),
      REGISTRATION_RATE_LIMIT.limit,
      REGISTRATION_RATE_LIMIT.windowMs,
    );
    const clientIp = trustedCloudflareClientIp(request.headers);
    const ipAllowed = !clientIp || await consumeAuthRateLimit(
      authRateLimitKey("registration", `ip:${clientIp}`),
      REGISTRATION_IP_RATE_LIMIT.limit,
      REGISTRATION_IP_RATE_LIMIT.windowMs,
    );
    if (!emailAllowed || !ipAllowed) return registrationAcknowledgement(null, "CUSTOMER", "/verify-email");
  } catch (error) {
    logAuthFailure("customer_registration_rate_limit", error);
    return NextResponse.json({ error: "Qeydiyyat xidməti hazırda əlçatan deyil. Bir az sonra yenidən cəhd edin." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  let exists;
  try { exists = await findRegistrationUser(email); }
  catch (error) { logAuthFailure("customer_registration_lookup", error); return NextResponse.json({ error: "Qeydiyyat xidməti hazırda əlçatan deyil. Bir az sonra yenidən cəhd edin." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
  if (exists) {
    const userId = await resumableRegistrationUserId(exists, parsed.data.password, "CUSTOMER");
    await recordResumedAcceptance(userId);
    return registrationAcknowledgement(userId, "CUSTOMER", "/verify-email");
  }
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const code = generateVerificationCode();
  const now = new Date();
  const codeHash = hashVerificationCode(code);
  let user;
  try { user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email, passwordHash, role: "CUSTOMER", emailVerifiedAt: null,
        customerProfile: { create: { firstName: parsed.data.firstName, lastName: parsed.data.lastName } },
        cart: { create: {} },
        emailVerification: { create: { codeHash, expiresAt: new Date(now.getTime() + EMAIL_CODE_TTL_MS), lastSentAt: now, resendWindowStartedAt: now } },
      },
      select: { id: true, email: true, role: true },
    });
    await enqueueVerificationEmail(tx, { userId: created.id, recipient: created.email, codeHash, code, expiresAt: new Date(now.getTime() + EMAIL_CODE_TTL_MS) });
    // Same transaction as the account: no account without its acceptance row, and no row without the account.
    await recordAcceptance(tx, { userId: created.id, document: "CUSTOMER_TERMS", source: "REGISTER_EMAIL" });
    return created;
  }); } catch (error) {
    if (isDuplicateEmailError(error)) {
      try {
        const existing = await findRegistrationUser(email);
        const userId = await resumableRegistrationUserId(existing, parsed.data.password, "CUSTOMER");
        await recordResumedAcceptance(userId);
        return registrationAcknowledgement(userId, "CUSTOMER", "/verify-email");
      } catch (lookupError) {
        logAuthFailure("customer_registration_duplicate_lookup", lookupError);
        return NextResponse.json({ error: "Qeydiyyat xidməti hazırda əlçatan deyil. Bir az sonra yenidən cəhd edin." }, { status: 503, headers: { "Cache-Control": "no-store" } });
      }
    }
    logAuthFailure("customer_registration_create", error);
    return NextResponse.json({ error: "Qeydiyyatı tamamlamaq mümkün olmadı. Bir az sonra yenidən cəhd edin." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  return registrationAcknowledgement(user.id, user.role, "/verify-email");
}

/** Security Center telemetry: status and duration counted under "auth.register" (never affects the response). */
export const POST = withSecurityTelemetry("auth.register", handlePOST);
