import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { enqueueEmail } from "@/lib/email-outbox";
import {
  clearEmailVerificationContext,
  compareVerificationCode,
  emailCodeCanBeAttempted,
  EMAIL_CODE_MAX_ATTEMPTS,
  readEmailVerificationContext,
} from "@/lib/email-verification";

const requestSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
const safeError = "Kod yanlışdır, vaxtı bitib və ya artıq istifadə olunub.";

export async function POST(request: NextRequest) {
  const context = await readEmailVerificationContext();
  if (!context) return NextResponse.json({ error: "Təsdiq sessiyası etibarsızdır. Yenidən daxil olun." }, { status: 401 });

  const user = await prisma.user.findFirst({
    where: { id: context.userId, role: context.role, isActive: true, emailVerifiedAt: null },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ error: safeError }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "6 rəqəmli kodu daxil edin." }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    const current = await prisma.emailVerification.findUnique({ where: { userId: user.id }, select: { codeHash: true } });
    if (current) await prisma.emailVerification.updateMany({
      where: { userId: user.id, codeHash: current.codeHash, expiresAt: { gt: new Date() }, attempts: { lt: EMAIL_CODE_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    return NextResponse.json({ error: "Kod 6 rəqəmdən ibarət olmalıdır." }, { status: 400 });
  }

  const verification = await prisma.emailVerification.findUnique({ where: { userId: user.id } });
  const now = new Date();
  if (!verification || !emailCodeCanBeAttempted(verification.expiresAt, verification.attempts, now)) {
    return NextResponse.json({ error: safeError }, { status: 400 });
  }

  if (!compareVerificationCode(parsed.data.code, verification.codeHash)) {
    await prisma.emailVerification.updateMany({
      where: { userId: user.id, codeHash: verification.codeHash, expiresAt: { gt: now }, attempts: { lt: EMAIL_CODE_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    return NextResponse.json({ error: safeError }, { status: 400 });
  }

  let verified = false;
  try {
    verified = await prisma.$transaction(async (tx) => {
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
      await enqueueEmail(tx, {
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
  const response = NextResponse.json({ verified: true, message: "Email ünvanı təsdiqləndi. İndi hesabınıza daxil ola bilərsiniz." });
  await clearEmailVerificationContext(response);
  return response;
}
