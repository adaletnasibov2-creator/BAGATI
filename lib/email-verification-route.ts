/**
 * POST /api/auth/verify-email (moved from the route unchanged in SIGNUP-EASY-1 so it can be unit-tested; the route
 * passes the real database, cookies, session and outbox). Only the end changed: R2 signs a CUSTOMER in after a
 * successful, committed verification.
 */
import { NextResponse } from "next/server";
import { bodyTooLargeResponse, JSON_BODY_LIMITS, readJsonCapped } from "@/lib/json-body";
import { z } from "zod";
import type { PrismaClient, Prisma } from "@prisma/client";
import type { Role } from "@prisma/client";
import { compareVerificationCode, emailCodeCanBeAttempted, EMAIL_CODE_MAX_ATTEMPTS } from "@/lib/email-verification";
import { logAuthFailure } from "@/lib/auth-logging";
import { verifiedCustomerSignIn } from "@/lib/verify-email-sign-in";
import type { OutboxInput } from "@/lib/email-outbox-core";

import type { createSession as realCreateSession } from "@/lib/auth";

export type SessionCookie = Awaited<ReturnType<typeof realCreateSession>>;
export type VerifyEmailDeps = {
  db: Pick<PrismaClient, "user" | "emailVerification" | "$transaction">;
  /** The signed verification-context cookie (CUSTOMER or VENDOR only), or null. */
  readContext: () => Promise<{ userId: string; role: Role } | null>;
  clearContext: (response: NextResponse) => Promise<void>;
  createSession: (userId: string) => Promise<SessionCookie>;
  enqueueEmail: (tx: Prisma.TransactionClient, input: OutboxInput) => Promise<void>;
};

// SIGNUP-EASY-1 R2: `next` is optional and only used for a CUSTOMER redirect after a successful code (sanitized below).
const requestSchema = z.object({ code: z.string().regex(/^\d{6}$/), next: z.string().max(512).optional() });
const safeError = "Kod yanlışdır, vaxtı bitib və ya artıq istifadə olunub.";

export async function handleVerifyEmail(request: Request, deps: VerifyEmailDeps) {
  const { db } = deps;
  const context = await deps.readContext();
  if (!context) return NextResponse.json({ error: "Təsdiq sessiyası etibarsızdır. Yenidən daxil olun." }, { status: 401 });

  const user = await db.user.findFirst({
    where: { id: context.userId, role: context.role, isActive: true, emailVerifiedAt: null },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ error: safeError }, { status: 400 });

  let body: unknown;
  try {
    body = await readJsonCapped(request, JSON_BODY_LIMITS.small);
  } catch (error) {
    return bodyTooLargeResponse(error) ?? NextResponse.json({ error: "6 rəqəmli kodu daxil edin." }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    const current = await db.emailVerification.findUnique({ where: { userId: user.id }, select: { codeHash: true } });
    if (current) await db.emailVerification.updateMany({
      where: { userId: user.id, codeHash: current.codeHash, expiresAt: { gt: new Date() }, attempts: { lt: EMAIL_CODE_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    return NextResponse.json({ error: "Kod 6 rəqəmdən ibarət olmalıdır." }, { status: 400 });
  }

  const verification = await db.emailVerification.findUnique({ where: { userId: user.id } });
  const now = new Date();
  if (!verification || !emailCodeCanBeAttempted(verification.expiresAt, verification.attempts, now)) {
    return NextResponse.json({ error: safeError }, { status: 400 });
  }

  if (!compareVerificationCode(parsed.data.code, verification.codeHash)) {
    await db.emailVerification.updateMany({
      where: { userId: user.id, codeHash: verification.codeHash, expiresAt: { gt: now }, attempts: { lt: EMAIL_CODE_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    return NextResponse.json({ error: safeError }, { status: 400 });
  }

  let verified = false;
  try {
    verified = await db.$transaction(async (tx) => {
      const consumed = await tx.emailVerification.deleteMany({
        where: {
          userId: user.id,
          codeHash: verification.codeHash,
          expiresAt: { gt: now },
          attempts: { lt: EMAIL_CODE_MAX_ATTEMPTS },
        },
      });
      if (consumed.count !== 1) throw new Error("Verification code was already consumed.");
      const updated = await tx.user.updateMany({
        where: { id: user.id, role: context.role, emailVerifiedAt: null, isActive: true },
        data: { emailVerifiedAt: now },
      });
      if (updated.count !== 1) throw new Error("Verification account is no longer eligible.");
      const account = await tx.user.findUnique({
        where: { id: user.id },
        select: { id: true, email: true, role: true, customerProfile: { select: { firstName: true, lastName: true } }, vendorProfile: { select: { displayName: true } } },
      });
      if (!account) throw new Error("Verified account was not found.");
      const name = account.role === "VENDOR"
        ? account.vendorProfile?.displayName ?? ""
        : `${account.customerProfile?.firstName ?? ""} ${account.customerProfile?.lastName ?? ""}`.trim();
      await deps.enqueueEmail(tx, {
        eventKey: `welcome:${account.id}:${now.toISOString()}`,
        recipient: account.email,
        template: account.role === "VENDOR" ? "WELCOME_SELLER" : "WELCOME_CUSTOMER",
        payload: { name },
      });
      await tx.emailOutbox.updateMany({
        where: { recipient: account.email, template: "EMAIL_VERIFICATION", status: "PENDING" },
        data: { status: "FAILED", retrySafe: false, lastErrorCode: "ACCOUNT_VERIFIED" },
      });
      return true;
    });
  } catch {
    verified = false;
  }

  if (!verified) return NextResponse.json({ error: safeError }, { status: 400 });
  // SIGNUP-EASY-1 R2: reached only after the code passed every check above and the transaction committed
  // (emailVerifiedAt set, code row consumed). A CUSTOMER is signed in here instead of typing the password again on
  // /login; a VENDOR keeps today's flow. If the session cannot be created, the old flow (go to /login) still works.
  const signIn = verifiedCustomerSignIn(context.role, parsed.data.next);
  let sessionCookie: SessionCookie | null = null;
  if (signIn.signIn) {
    try { sessionCookie = await deps.createSession(user.id); }
    catch (error) { logAuthFailure("verify_email_session_create", error); }
  }
  const response = NextResponse.json(
    { verified: true, message: "Email ünvanı təsdiqləndi. İndi hesabınıza daxil ola bilərsiniz.", ...(sessionCookie && signIn.signIn ? { signedIn: true, redirectTo: signIn.redirectTo } : {}) },
    { headers: { "Cache-Control": "no-store" } },
  );
  if (sessionCookie) response.cookies.set(sessionCookie);
  await deps.clearContext(response);
  return response;
}
