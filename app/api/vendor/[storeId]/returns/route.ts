import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireStoreAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { nextReturnStatus, returnStatusLabel, type ReturnResolutionValue, type ReturnStatusValue } from "@/lib/returns";
import { enqueueEmail } from "@/lib/email-outbox";

export const dynamic = "force-dynamic";
const db: any = prisma;
const responseSchema = z.string().trim().max(2000).optional().nullable();

export async function GET(_request: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const access = await requireStoreAccess(storeId);
  if (!access) return NextResponse.json({ error: "Mağazaya giriş icazəsi yoxdur" }, { status: 403 });
  const items = await db.returnRequest.findMany({
    where: { storeId: access.storeId },
    select: {
      id: true, reason: true, explanation: true, resolution: true, status: true, refundAmount: true, vendorResponse: true, stockRestoredAt: true, createdAt: true,
      orderItem: { select: { productName: true, variantName: true, variantOptions: true, quantity: true, unitPrice: true, lineTotal: true } },
      storeOrder: { select: { id: true, orderId: true, createdAt: true } },
      customer: { select: { customerProfile: { select: { firstName: true, lastName: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ items });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const access = await requireStoreAccess(storeId);
  if (!access) return NextResponse.json({ error: "Mağazaya giriş icazəsi yoxdur" }, { status: 403 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Sorğu məlumatı yanlışdır" }, { status: 400 }); }
  const parsed = z.object({ id: z.string().min(1), action: z.enum(["approve", "reject", "receive", "restore-stock", "process-resolution", "complete-exchange"]), response: responseSchema }).safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Qaytarılma məlumatlarını yoxlayın" }, { status: 422 });
  try {
    const result = await db.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT "id" FROM "ReturnRequest" WHERE "id" = ${parsed.data.id} AND "storeId" = ${access.storeId} FOR UPDATE`;
      const current = await tx.returnRequest.findFirst({ where: { id: parsed.data.id, storeId: access.storeId }, include: { customer: { select: { email: true } }, orderItem: { select: { id: true, productId: true, variantId: true, variantName: true, productName: true, quantity: true, product: { select: { storeId: true } } } }, storeOrder: { select: { orderId: true } }, store: { select: { name: true, vendor: { select: { userId: true } } } } } });
      if (!current) return { error: "NOT_FOUND" };
      const next = nextReturnStatus(current.status as ReturnStatusValue, parsed.data.action, current.resolution as ReturnResolutionValue);
      if (!next) return { error: "INVALID_TRANSITION" };
      if (parsed.data.action === "restore-stock") {
        if (current.stockRestoredAt) return { error: "ALREADY_RESTORED" };
        if (current.orderItem.product.storeId !== access.storeId) return { error: "OWNERSHIP" };
        if (current.orderItem.variantName && !current.orderItem.variantId) return { error: "VARIANT_INVENTORY_UNAVAILABLE" };
        let inventory = await tx.inventory.findFirst({ where: { productId: current.orderItem.productId, variantId: current.orderItem.variantId }, select: { id: true, quantity: true } });
        if (inventory) {
          await tx.$queryRaw`SELECT "id" FROM "Inventory" WHERE "id" = ${inventory.id} FOR UPDATE`;
          inventory = await tx.inventory.findUnique({ where: { id: inventory.id }, select: { id: true, quantity: true } });
        } else {
          inventory = await tx.inventory.create({ data: { productId: current.orderItem.productId, variantId: current.orderItem.variantId, quantity: 0 }, select: { id: true, quantity: true } });
        }
        const updated = await tx.inventory.update({ where: { id: inventory.id }, data: { quantity: { increment: current.orderItem.quantity } }, select: { quantity: true } });
        await tx.inventoryAdjustment.create({ data: { inventoryId: inventory.id, actorUserId: access.user.id, delta: current.orderItem.quantity, previousQuantity: inventory.quantity, newQuantity: updated.quantity, reason: `Qaytarılan sifariş məhsulu qəbul edildi (${current.id})` } });
      }
      const updated = await tx.returnRequest.update({ where: { id: current.id }, data: { status: next, ...(parsed.data.response !== undefined ? { vendorResponse: parsed.data.response } : {}), ...(parsed.data.action === "restore-stock" ? { stockRestoredAt: new Date() } : {}) }, select: { id: true, status: true, resolution: true, stockRestoredAt: true } });
      if (current.customerId) await tx.notification.create({ data: { userId: current.customerId, storeId: access.storeId, title: "Qaytarılma sorğusu yeniləndi", body: `Sorğunun yeni statusu: ${returnStatusLabel(next)}` } });
      await enqueueEmail(tx, { eventKey: `return-status:${current.id}:${next}`, recipient: current.customer.email, template: "RETURN_STATUS", payload: { productName: current.orderItem.productName, status: next, resolution: current.resolution, refundAmount: current.refundAmount ? Number(current.refundAmount) : null } });
      return { item: updated };
    }, { isolationLevel: "Serializable" });
    if (result.error === "NOT_FOUND") return NextResponse.json({ error: "Sorğu tapılmadı" }, { status: 404 });
    if (result.error === "OWNERSHIP") return NextResponse.json({ error: "Sorğu bu mağazaya aid deyil" }, { status: 403 });
    if (result.error === "ALREADY_RESTORED") return NextResponse.json({ error: "Stok artıq bərpa edilib" }, { status: 409 });
    if (result.error === "VARIANT_INVENTORY_UNAVAILABLE") return NextResponse.json({ error: "Sifarişdəki variant artıq stok sistemində mövcud deyil; stok avtomatik bərpa edilmədi" }, { status: 409 });
    if (result.error === "INVALID_TRANSITION") return NextResponse.json({ error: "Bu status keçidi mümkün deyil" }, { status: 409 });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Qaytarılma sorğusu yenilənmədi" }, { status: 500 });
  }
}
