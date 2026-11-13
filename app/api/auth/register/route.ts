import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
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

async function handlePOST(request: NextRequest) {
  let data: unknown;
  try {
    data = await request.json();
  } catch {
    return NextResponse.json({ error: "Sorğu məlumatları yanlışdır." }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Məlumatları yoxlayın.", details: parsed.error.flatten() }, { status: 400 });
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
  try { exists = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true, passwordHash: true, role: true, emailVerifiedAt: true } }); }
  catch (error) { logAuthFailure("customer_registration_lookup", error); return NextResponse.json({ error: "Qeydiyyat xidməti hazırda əlçatan deyil. Bir az sonra yenidən cəhd edin." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
  if (exists) {
    const userId = await resumableRegistrationUserId(exists, parsed.data.password, "CUSTOMER");
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
    return created;
  }); } catch (error) {
    if (isDuplicateEmailError(error)) {
      try {
        const existing = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true, passwordHash: true, role: true, emailVerifiedAt: true } });
        const userId = await resumableRegistrationUserId(existing, parsed.data.password, "CUSTOMER");
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
