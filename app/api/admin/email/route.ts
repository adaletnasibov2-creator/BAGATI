import { NextRequest, NextResponse } from "next/server";
import { csrfRejection } from "@/lib/csrf";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isEmailPayloadEncryptionConfigured } from "@/lib/email-outbox";
import { requeueRetrySafeOutbox } from "@/lib/email-outbox-worker";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });
  const [pending, processing, sent, failed, items] = await Promise.all([
    prisma.emailOutbox.count({ where: { status: "PENDING" } }),
    prisma.emailOutbox.count({ where: { status: "PROCESSING" } }),
    prisma.emailOutbox.count({ where: { status: "SENT" } }),
    prisma.emailOutbox.count({ where: { status: "FAILED" } }),
    prisma.emailOutbox.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { id: true, template: true, status: true, attempts: true, availableAt: true, sentAt: true, lastErrorCode: true, retrySafe: true, createdAt: true } }),
  ]);
  const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD && process.env.SMTP_FROM && ["465", "587"].includes(process.env.SMTP_PORT ?? ""));
  return NextResponse.json({ configured: smtpConfigured, encryptionConfigured: isEmailPayloadEncryptionConfigured(), counts: { pending, processing, sent, failed }, items });
}

export async function POST(request: NextRequest) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  const parsed = z.object({ id: z.string().min(1).max(64) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Məktub identifikatoru yanlışdır" }, { status: 422 });
  const changed = await prisma.$transaction(async (tx) => {
    const item = await tx.emailOutbox.findFirst({ where: { id: parsed.data.id, status: "FAILED", retrySafe: true }, select: { id: true, attempts: true } });
    if (!item) return false;
    const updated = await requeueRetrySafeOutbox(tx, item.id);
    if (!updated.count) return false;
    await tx.auditLog.create({ data: { actorId: admin.id, action: "EMAIL_OUTBOX_RETRY", entityType: "EmailOutbox", entityId: item.id, metadata: { attempts: item.attempts } } });
    return true;
  });
  if (!changed) return NextResponse.json({ error: "Bu məktub təhlükəsiz təkrar göndərmə üçün uyğun deyil" }, { status: 409 });
  return NextResponse.json({ ok: true, message: "Məktub göndərilmə növbəsinə qaytarıldı." });
}
