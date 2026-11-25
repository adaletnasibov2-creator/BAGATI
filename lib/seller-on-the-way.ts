import { normalizeAzPhone } from "@/lib/az-phone";
import { orderNumber, SELLER_ORDERS_DESIGN_2_TEXT } from "@/lib/vendor-order-view";

/**
 * SELLER-ORDERS-DESIGN-2: the seller's "on the way" WhatsApp link on the order page (server side only; kept out of
 * lib/vendor-order-view.ts so the client order list does not load the phone parser).
 */

/** Owner rule (2026-11-25): the button shows only once the order is ready or on its way. */
export const ON_THE_WAY_STATUSES = ["READY", "HANDED_TO_COURIER", "SHIPPED"] as const;

/**
 * True only for READY, HANDED_TO_COURIER or SHIPPED, and never when the shipment is delivered or returned.
 * Display only: opening the message never changes the status (that stays the seller's separate action).
 */
export function canSendOnTheWay(storeOrder: { status: string; shipmentStatus?: string | null }): boolean {
  if (!(ON_THE_WAY_STATUSES as readonly string[]).includes(storeOrder.status)) return false;
  return storeOrder.shipmentStatus !== "DELIVERED" && storeOrder.shipmentStatus !== "RETURNED";
}

/**
 * wa.me/<994XXXXXXXXX>?text=<message>, or null when the status does not allow it (canSendOnTheWay), the store name is
 * empty, or the phone is missing, invalid or a landline (the same mobile-only rule as the "WhatsApp ilə yaz" link in
 * lib/az-phone.ts). The message holds only the store name and the order number.
 */
export function buildOnTheWayWhatsAppUrl(
  phone: string | null | undefined,
  storeName: string,
  orderId: string,
  storeOrder: { status: string; shipmentStatus?: string | null },
): string | null {
  if (!canSendOnTheWay(storeOrder)) return null;
  const normalized = normalizeAzPhone(phone);
  if (!normalized?.mobile) return null;
  const name = storeName.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!name) return null;
  const text = SELLER_ORDERS_DESIGN_2_TEXT.onTheWayMessage(name, orderNumber(orderId));
  return `https://wa.me/${normalized.digits}?text=${encodeURIComponent(text)}`;
}
