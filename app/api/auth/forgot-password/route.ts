import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { logAuthFailure } from "@/lib/auth-logging";
import { authRateLimitKey, consumeAuthRateLimit, PASSWORD_RESET_RATE_LIMIT } from "@/lib/auth-rate-limit";
import { prisma } from "@/lib/prisma";
import { generatePasswordResetToken, getPublicAppUrl, hashPasswordResetToken, PASSWORD_RESET_TTL_MS } from "@/lib/password-reset";
import { enqueueEmail } from "@/lib/email-outbox";
import { withSecurityTelemetry } from "@/lib/security-monitoring/runtime";

const schema = z.object({ email: z.string().trim().email().max(254) });
const genericResponse = {
  message: "Əgər bu ünvan şifrə ilə qorunan aktiv BAGATI hesabına aiddirsə, bərpa məktubu göndəriləcək. Google ilə yaradılmış və şifrə girişi bağlı olan hesablar Google girişi ilə istifadə olunur.",
};

async function handlePOST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Sorğu məlumatları yanlışdır." }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "E-poçt ünvanını yoxlayın." }, { status: 400, headers: { "Cache-Control": "no-store" } });

  const email = parsed.data.email.trim().toLowerCase();
  try {
    const publicUrl = getPublicAppUrl();
    const rateKey = authRateLimitKey("password-reset", email);
    if (!await consumeAuthRateLimit(rateKey, PASSWORD_RESET_RATE_LIMIT.limit, PASSWORD_RESET_RATE_LIMIT.windowMs)) {
      return NextResponse.json(genericResponse, { status: 202, headers: { "Cache-Control": "no-store" } });
    }
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" }, isActive: true },
      select: { id: true, email: true, passwordAuthEnabled: true },
    });
    if (!user || !user.passwordAuthEnabled) return NextResponse.json(genericResponse, { status: 202, headers: { "Cache-Control": "no-store" } });

    const token = generatePasswordResetToken();
    const tokenHash = hashPasswordResetToken(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS);
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`);
      await transaction.$executeRaw(Prisma.sql`DELETE FROM "PasswordResetToken" WHERE "expiresAt" < ${now}`);
      await transaction.$executeRaw(Prisma.sql`
        DELETE FROM "PasswordResetToken" WHERE "userId" = ${user.id}
      `);
      await transaction.$executeRaw(Prisma.sql`
        INSERT INTO "PasswordResetToken" ("id", "userId", "tokenHash", "expiresAt", "createdAt")
        VALUES (${randomUUID()}, ${user.id}, ${tokenHash}, ${expiresAt}, ${now})
      `);
      await enqueueEmail(transaction, {
        eventKey: `password-reset:${user.id}:${tokenHash}`,
        recipient: user.email,
        template: "PASSWORD_RESET",
        payload: { tokenHash, expiresAt: expiresAt.toISOString(), resetUrl: `${publicUrl}/reset-password#token=${encodeURIComponent(token)}` },
      });
    });
    return NextResponse.json(genericResponse, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logAuthFailure("password_reset_request", error);
    return NextResponse.json({ error: "Sorğunu emal etmək mümkün olmadı. Bir az sonra yenidən cəhd edin." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

/** Security Center telemetry: status and duration counted under "auth.password-reset" (never affects the response). */
export const POST = withSecurityTelemetry("auth.password-reset", handlePOST);
