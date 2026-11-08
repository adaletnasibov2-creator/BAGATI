import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { enqueueEmail } from "@/lib/email-outbox";
import { logAuthFailure } from "@/lib/auth-logging";
import { PASSWORD_RESET_RATE_LIMIT, authRateLimitKey, consumeAuthRateLimit } from "@/lib/auth-rate-limit";
import { hashPasswordResetToken, passwordResetTokenIsUsable } from "@/lib/password-reset";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  token: z.string().min(40).max(100),
  password: z.string().min(12).max(128),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Sorğu məlumatları yanlışdır." }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Bərpa keçidi və ya yeni şifrə yanlışdır." }, { status: 400, headers: { "Cache-Control": "no-store" } });

  const tokenHash = hashPasswordResetToken(parsed.data.token);
  try {
    const candidates = await prisma.$queryRaw<Array<{ id: string; userId: string; expiresAt: Date; usedAt: Date | null }>>(Prisma.sql`
      SELECT "id", "userId", "expiresAt", "usedAt"
      FROM "PasswordResetToken" WHERE "tokenHash" = ${tokenHash} LIMIT 1
    `);
    const candidate = candidates[0];
    if (!candidate || !passwordResetTokenIsUsable(candidate)) {
      return NextResponse.json({ error: "Bərpa keçidi yanlışdır və ya vaxtı bitib. Yeni keçid istəyin." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const rateKey = authRateLimitKey("password-reset", candidate.userId);
    if (!await consumeAuthRateLimit(rateKey, PASSWORD_RESET_RATE_LIMIT.limit, PASSWORD_RESET_RATE_LIMIT.windowMs)) {
      return NextResponse.json({ error: "Çox sayda cəhd edildi. Bir müddət sonra yenidən yoxlayın." }, { status: 429, headers: { "Cache-Control": "no-store" } });
    }
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const now = new Date();
    await prisma.$transaction(async (transaction) => {
      const lockedUsers = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "User" WHERE "id" = ${candidate.userId} AND "isActive" = true AND "passwordAuthEnabled" = true FOR UPDATE
      `);
      if (lockedUsers.length !== 1) throw new Error("PASSWORD_RESET_TOKEN_ALREADY_USED");
      const claimed = await transaction.$executeRaw(Prisma.sql`
        UPDATE "PasswordResetToken" SET "usedAt" = ${now}
        WHERE "id" = ${candidate.id} AND "tokenHash" = ${tokenHash}
          AND "usedAt" IS NULL AND "expiresAt" > ${now}
      `);
      if (claimed !== 1) throw new Error("PASSWORD_RESET_TOKEN_ALREADY_USED");
      const updated = await transaction.user.update({
        where: { id: candidate.userId, isActive: true },
        select: { id: true, email: true, role: true, updatedAt: true },
        data: { passwordHash },
      });
      await transaction.authSession.updateMany({
        where: { userId: updated.id, revokedAt: null },
        data: { revokedAt: now },
      });
      await enqueueEmail(transaction, {
        eventKey: `account-security:${updated.id}:${updated.updatedAt.toISOString()}`,
        recipient: updated.email,
        template: "ACCOUNT_SECURITY",
        payload: {},
      });
      if (updated.role === "ADMIN") {
        await transaction.auditLog.create({
          data: { actorId: updated.id, action: "PASSWORD_RESET", entityType: "User", entityId: updated.id },
        });
      }
    });
    return NextResponse.json({ message: "Şifrə yeniləndi. İndi yeni şifrənizlə daxil ola bilərsiniz." }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "PASSWORD_RESET_TOKEN_ALREADY_USED") {
      return NextResponse.json({ error: "Bərpa keçidi yanlışdır və ya vaxtı bitib. Yeni keçid istəyin." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    logAuthFailure("password_reset_complete", error);
    return NextResponse.json({ error: "Şifrəni yeniləmək mümkün olmadı. Yenidən cəhd edin." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
