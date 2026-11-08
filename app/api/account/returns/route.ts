import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { chargedReturnAmount, nextReturnStatus, type ReturnResolutionValue, type ReturnStatusValue } from "@/lib/returns";
import { enqueueEmail } from "@/lib/email-outbox";

export const dynamic = "force-dynamic";
const db: any = prisma;
const reasonSchema = z.enum(["WRONG_ITEM", "DAMAGED", "MISSING_PARTS", "NOT_AS_DESCRIBED", "OTHER"]);

export async function GET() {
  const customer = await requireRole("CUSTOMER");
  if (!customer) return NextResponse.json({ error: "Daxil olmaq tələb olunur" }, { status: 401 });
  const [requests, eligibleItems] = await Promise.all([
    db.returnRequest.findMany({
      where: { customerId: customer.id },
      select: { id: true, reason: true, explanation: true, resolution: true, status: true, refundAmount: true, vendorResponse: true, createdAt: true, orderItem: { select: { productName: true, variantName: true, quantity: true, unitPrice: true } }, storeOrder: { select: { id: true, orderId: true, store: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.orderItem.findMany({
      where: { storeOrder: { status: "DELIVERED", order: { userId: customer.id } }, returnRequest: null },
      select: { id: true, productName: true, variantName: true, quantity: true, unitPrice: true, lineTotal: true, storeOrder: { select: { id: true, createdAt: true, store: { select: { name: true } } } } },
      orderBy: { storeOrder: { createdAt: "desc" } },
      take: 100,
    }),
  ]);
  return NextResponse.json({ requests, eligibleItems });
}

export async function POST(request: NextRequest) {
  const customer = await requireRole("CUSTOMER");
  if (!customer) return NextResponse.json({ error: "Daxil olmaq tələb olunur" }, { status: 401 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Sorğu məlumatı yanlışdır" }, { status: 400 }); }
  const parsed = z.object({ orderItemId: z.string().min(1), reason: reasonSchema, explanation: z.string().trim().max(2000).optional().default(""), resolution: z.enum(["REFUND", "EXCHANGE"]) }).safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Qaytarılma məlumatlarını yoxlayın", details: parsed.error.flatten() }, { status: 422 });
  try {
    const item = await db.$transaction(async (tx: any) => {
      const orderItem = await tx.orderItem.findFirst({
        where: { id: parsed.data.orderItemId, storeOrder: { status: "DELIVERED", order: { userId: customer.id } }, returnRequest: null },
        select: {
          id: true, storeOrderId: true, productId: true, variantId: true, productName: true, quantity: true, lineTotal: true,
          storeOrder: {
            select: {
              orderId: true,
              storeId: true,
              store: { select: { vendor: { select: { userId: true, user: { select: { email: true } } } } } },
            },
          },
        },
      });
      if (!orderItem) throw new Error("ITEM_NOT_ELIGIBLE");
      const created = await tx.returnRequest.create({ data: {
        orderItemId: orderItem.id,
        storeOrderId: orderItem.storeOrderId,
        storeId: orderItem.storeOrder.storeId,
        customerId: customer.id,
        reason: parsed.data.reason,
        explanation: parsed.data.explanation || null,
        resolution: parsed.data.resolution,
        refundAmount: chargedReturnAmount(orderItem.lineTotal),
      }, select: { id: true, status: true, resolution: true, refundAmount: true, createdAt: true } });
      await tx.notification.create({ data: { userId: orderItem.storeOrder.store.vendor.userId, storeId: orderItem.storeOrder.storeId, title: "Yeni qaytarılma sorğusu", body: "Mağazanıza qaytarılma və ya dəyişdirilmə sorğusu göndərilib." } });
      await enqueueEmail(tx, { eventKey: `seller-return:${created.id}`, recipient: orderItem.storeOrder.store.vendor.user.email, template: "SELLER_RETURN_REQUEST", payload: { productName: orderItem.productName, resolution: parsed.data.resolution, orderRef: orderItem.storeOrder.orderId } });
      return created;
    }, { isolationLevel: "Serializable" });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && (error.message === "ITEM_NOT_ELIGIBLE" || ("code" in error && error.code === "P2002"))) {
      return NextResponse.json({ error: "Bu məhsul üçün qaytarılma sorğusu açmaq mümkün deyil" }, { status: 409 });
    }
    return NextResponse.json({ error: "Qaytarılma sorğusu yaradılmadı" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const customer = await requireRole("CUSTOMER");
  if (!customer) return NextResponse.json({ error: "Daxil olmaq tələb olunur" }, { status: 401 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Sorğu məlumatı yanlışdır" }, { status: 400 }); }
  const parsed = z.object({ id: z.string().min(1), action: z.literal("cancel") }).safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Sorğu məlumatlarını yoxlayın" }, { status: 422 });
  const current = await db.returnRequest.findFirst({ where: { id: parsed.data.id, customerId: customer.id }, select: { id: true, status: true, resolution: true, storeId: true, orderItem: { select: { productName: true } }, storeOrder: { select: { orderId: true } }, store: { select: { name: true, vendor: { select: { user: { select: { id: true, email: true } } } } } } } });
  if (!current) return NextResponse.json({ error: "Sorğu tapılmadı" }, { status: 404 });
  const next = nextReturnStatus(current.status as ReturnStatusValue, "cancel", current.resolution as ReturnResolutionValue);
  if (!next) return NextResponse.json({ error: "Bu sorğunu artıq ləğv etmək mümkün deyil" }, { status: 409 });
  const changed = await db.$transaction(async (tx: any) => {
    const updated = await tx.returnRequest.updateMany({ where: { id: current.id, customerId: customer.id, status: current.status }, data: { status: next } });
    if (!updated.count) return false;
    await tx.notification.create({ data: { userId: current.store.vendor.user.id, storeId: current.storeId, title: "Qaytarılma sorğusu ləğv edildi", body: "Müştəri qaytarılma sorğusunu ləğv edib." } });
    await enqueueEmail(tx, { eventKey: `return-status-seller:${current.id}:${next}`, recipient: current.store.vendor.user.email, template: "SELLER_RETURN_STATUS", payload: { productName: current.orderItem.productName, status: next, resolution: current.resolution, storeName: current.store.name, orderRef: current.storeOrder.orderId } });
    return true;
  });
  if (!changed) return NextResponse.json({ error: "Sorğu eyni vaxtda dəyişdirilib" }, { status: 409 });
  return NextResponse.json({ item: await db.returnRequest.findUnique({ where: { id: current.id }, select: { id: true, status: true, resolution: true, refundAmount: true, createdAt: true } }) });
}
