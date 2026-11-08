import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { nextReturnStatus, returnStatusLabel, type ReturnResolutionValue, type ReturnStatusValue } from "@/lib/returns";
import { enqueueEmail } from "@/lib/email-outbox";
import { normalizeAdminPage } from "@/lib/admin-pagination";
import { logSecurityOperationFailure } from "@/lib/security-logging";

export const dynamic = "force-dynamic";
const db: any = prisma;

export async function GET(request: NextRequest) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });
  const pageParameters = request.nextUrl.searchParams.getAll("page");
  const page = normalizeAdminPage(pageParameters.length === 1 ? pageParameters[0] : undefined);
  const pageSize = 50;
  const [items, total] = await Promise.all([
    db.returnRequest.findMany({ include: { store: { select: { id: true, name: true } }, storeOrder: { select: { orderId: true } }, orderItem: { select: { productName: true, variantName: true, quantity: true, lineTotal: true } }, customer: { select: { id: true, email: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    db.returnRequest.count(),
  ]);
  return NextResponse.json({ items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
}

export async function PATCH(request: NextRequest) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur" }, { status: 403 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Sorğu məlumatı yanlışdır" }, { status: 400 }); }
  const parsed = z.object({ id: z.string().min(1), action: z.enum(["approve", "reject"]), note: z.string().trim().min(3).max(2000) }).safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Qaytarılma qərarını və daxili qeydi yoxlayın" }, { status: 422 });
  const current = await db.returnRequest.findUnique({ where: { id: parsed.data.id }, select: { id: true, status: true, resolution: true, storeId: true, customerId: true } });
  if (!current) return NextResponse.json({ error: "Sorğu tapılmadı" }, { status: 404 });
  const next = nextReturnStatus(current.status as ReturnStatusValue, parsed.data.action, current.resolution as ReturnResolutionValue);
  if (!next || current.status !== "REQUESTED") return NextResponse.json({ error: "Bu sorğu üçün admin qərarı artıq verilib və ya uyğun deyil" }, { status: 409 });
  try {
    const item = await db.$transaction(async (tx: any) => {
      const changed = await tx.returnRequest.updateMany({ where: { id: current.id, status: current.status }, data: { status: next, adminNote: parsed.data.note } });
      if (!changed.count) throw new Error("CONFLICT");
      await tx.auditLog.create({ data: { actorId: admin.id, action: `RETURN_ADMIN_${next}`, entityType: "ReturnRequest", entityId: current.id, metadata: { storeId: current.storeId } } });
      await tx.notification.create({ data: { userId: current.customerId, title: "Qaytarılma sorğusu nəzərdən keçirildi", body: `Sorğunun statusu: ${returnStatusLabel(next)}`, storeId: current.storeId } });
      const details = await tx.returnRequest.findUnique({ where: { id: current.id }, include: { customer: { select: { email: true } }, store: { select: { name: true, vendor: { select: { user: { select: { email: true } } } } } }, storeOrder: { select: { orderId: true } }, orderItem: { select: { productName: true } } } });
      if (!details) throw new Error("RETURN_NOT_FOUND");
      const payload = { productName: details.orderItem.productName, status: next, resolution: details.resolution, refundAmount: details.refundAmount ? Number(details.refundAmount) : null };
      await enqueueEmail(tx, { eventKey: `return-status:${details.id}:${next}`, recipient: details.customer.email, template: "RETURN_STATUS", payload });
      await enqueueEmail(tx, { eventKey: `return-status-seller:${details.id}:${next}`, recipient: details.store.vendor.user.email, template: "SELLER_RETURN_STATUS", payload: { ...payload, storeName: details.store.name, orderRef: details.storeOrder.orderId } });
      return details;
    });
    return NextResponse.json({ item });
  } catch (error) {
    if (error instanceof Error && error.message === "CONFLICT") {
      return NextResponse.json({ error: "Sorğu eyni vaxtda dəyişdirilib" }, { status: 409 });
    }
    if (error instanceof Error && error.message === "RETURN_NOT_FOUND") {
      return NextResponse.json({ error: "Sorğu tapılmadı" }, { status: 404 });
    }
    logSecurityOperationFailure("admin_return_decision", error);
    return NextResponse.json({ error: "Qaytarılma qərarını saxlamaq mümkün olmadı" }, { status: 503 });
  }
}
