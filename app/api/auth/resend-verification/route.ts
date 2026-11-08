import { prisma } from "@/lib/prisma";
import { enqueueVerificationEmail } from "@/lib/email-outbox";
import { verificationResendAcknowledgement } from "@/lib/verification-resend-response";
import {
  EMAIL_CODE_TTL_MS,
  EMAIL_RESEND_MAX_PER_WINDOW,
  emailResendCooldownSeconds,
  emailResendWindowExpired,
  generateVerificationCode,
  hashVerificationCode,
  readEmailVerificationContext,
} from "@/lib/email-verification";

export async function POST() {
  const context = await readEmailVerificationContext();
  if (!context) return verificationResendAcknowledgement();

  const user = await prisma.user.findFirst({
    where: { id: context.userId, role: context.role, isActive: true, emailVerifiedAt: null },
    select: { id: true, email: true },
  });
  if (!user) return verificationResendAcknowledgement();

  const now = new Date();
  const previous = await prisma.emailVerification.findUnique({ where: { userId: user.id } });
  const windowExpired = emailResendWindowExpired(previous?.resendWindowStartedAt ?? null, now);
  const retryAfterSeconds = emailResendCooldownSeconds(previous?.lastSentAt ?? null, now);
  if (retryAfterSeconds > 0) {
    return verificationResendAcknowledgement();
  }
  if (previous && !windowExpired && previous.resendCount >= EMAIL_RESEND_MAX_PER_WINDOW) {
    return verificationResendAcknowledgement();
  }

  let code = generateVerificationCode();
  let codeHash = hashVerificationCode(code);
  while (previous && codeHash === previous.codeHash) {
    code = generateVerificationCode();
    codeHash = hashVerificationCode(code);
  }
  const windowStart = windowExpired ? now : previous?.resendWindowStartedAt ?? now;
  const resendCount = windowExpired ? 1 : (previous?.resendCount ?? 0) + 1;
  const expiresAt = new Date(now.getTime() + EMAIL_CODE_TTL_MS);
  const reserved = await prisma.$transaction(async (tx) => {
    if (!previous) {
      const created = await tx.emailVerification.createMany({
        data: [{ userId: user.id, codeHash, expiresAt, lastSentAt: now, resendWindowStartedAt: now, resendCount: 1 }],
        skipDuplicates: true,
      });
      if (created.count !== 1) return false;
    } else {
      const changed = await tx.emailVerification.updateMany({
        where: { userId: user.id, codeHash: previous.codeHash, attempts: previous.attempts, lastSentAt: previous.lastSentAt, resendCount: previous.resendCount, resendWindowStartedAt: previous.resendWindowStartedAt },
        data: { codeHash, expiresAt, attempts: 0, lastSentAt: now, resendWindowStartedAt: windowStart, resendCount },
      });
      if (changed.count !== 1) return false;
    }
    await enqueueVerificationEmail(tx, { userId: user.id, recipient: user.email, codeHash, code, expiresAt });
    return true;
  });

  if (!reserved) return verificationResendAcknowledgement();

  return verificationResendAcknowledgement();
}
