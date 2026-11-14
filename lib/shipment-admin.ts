/**
 * Admin changes to a store order's shipment status. Server-only. One transaction: lock the parent order row (the same
 * lock the seller and checkout paths use), re-read the store order, check the rules, write with an optimistic guard and
 * append an audit row. The shipment status is independent of the order status: nothing here touches the order status,
 * payment, stock, revenue or finance, and no e-mail is sent (customer e-mails are unchanged by design).
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { allowedShipmentTransitions, shipmentChangeAllowedForOrder, shipmentTimestamps, type ShipmentStatusValue } from "@/lib/shipment-tracking";

export class ShipmentAdminError extends Error {
  constructor(readonly code: "NOT_FOUND" | "ORDER_CLOSED" | "INVALID_TRANSITION" | "CONFLICT") { super(code); this.name = "ShipmentAdminError"; }
}

export async function setShipmentStatusAsAdmin(db: PrismaClient, input: { storeOrderId: string; actorId: string; target: ShipmentStatusValue }) {
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.storeOrder.findUnique({ where: { id: input.storeOrderId }, select: { orderId: true } });
    if (!existing) throw new ShipmentAdminError("NOT_FOUND");
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${existing.orderId} FOR UPDATE`;
    const current = await tx.storeOrder.findUnique({ where: { id: input.storeOrderId }, select: { id: true, orderId: true, storeId: true, status: true, shipmentStatus: true, shippedAt: true } });
    if (!current) throw new ShipmentAdminError("NOT_FOUND");
    if (!shipmentChangeAllowedForOrder(current.status)) throw new ShipmentAdminError("ORDER_CLOSED");
    if (!allowedShipmentTransitions(current.shipmentStatus as ShipmentStatusValue | null).includes(input.target)) throw new ShipmentAdminError("INVALID_TRANSITION");
    const changed = await tx.storeOrder.updateMany({
      where: { id: current.id, status: current.status, shipmentStatus: current.shipmentStatus },
      data: { shipmentStatus: input.target, ...shipmentTimestamps(input.target, current, new Date()) },
    });
    if (changed.count !== 1) throw new ShipmentAdminError("CONFLICT");
    await tx.auditLog.create({ data: {
      actorId: input.actorId, action: "SHIPMENT_STATUS_UPDATE", entityType: "StoreOrder", entityId: current.id,
      metadata: { orderId: current.orderId, storeId: current.storeId, from: current.shipmentStatus, to: input.target },
    } });
    return { id: current.id, shipmentStatus: input.target };
  });
}
