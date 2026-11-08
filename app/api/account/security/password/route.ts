import { NextRequest, NextResponse } from "next/server";
import { csrfRejection } from "@/lib/csrf";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { createSession, currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enqueueEmail } from "@/lib/email-outbox";

const schema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(12).max(128) });

export async function PATCH(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Giriş tələb olunur" }, { status: 401 });
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Yanlış JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success || parsed.data.newPassword === parsed.data.currentPassword) return NextResponse.json({ error: "Şifrə məlumatlarını yoxlayın; yeni şifrə ən azı 12 simvol olmalı və köhnədən fərqlənməlidir" }, { status: 422 });
  const record = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true, passwordAuthEnabled: true } });
  if (!record?.passwordAuthEnabled) return NextResponse.json({ error: "Bu hesab Google ilə idarə olunur. Dəyişiklik üçün Google hesabınızdan istifadə edin." }, { status: 409 });
  if (!record || !(await bcrypt.compare(parsed.data.currentPassword, record.passwordHash))) return NextResponse.json({ error: "Cari şifrə yanlışdır" }, { status: 400 });
  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await prisma.$transaction(async (transaction) => {
    await transaction.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    const updated = await transaction.user.update({ where: { id: user.id }, data: { passwordHash }, select: { id: true, email: true, updatedAt: true } });
    if (user.role === "ADMIN") await transaction.auditLog.create({ data: { actorId: user.id, action: "PASSWORD_CHANGE", entityType: "User", entityId: user.id } });
    await enqueueEmail(transaction, { eventKey: `account-security:${updated.id}:${updated.updatedAt.toISOString()}`, recipient: updated.email, template: "ACCOUNT_SECURITY", payload: {} });
  });
  const response = NextResponse.json({ ok: true, message: "Şifrə yeniləndi və digər aktiv sessiyalar bağlandı." });
  response.cookies.set(await createSession(user.id));
  return response;
}
