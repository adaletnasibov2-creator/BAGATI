import { statusLabel } from "@/lib/order-status";
import { shipmentStatusLabel } from "@/lib/shipment-tracking";

/**
 * SELLER-ORDERS-DESIGN-1: pure helpers for the seller's order list and order page. Display only: no status rule,
 * price or query lives here (the transitions still come from lib/order-status.ts and the server decides).
 */

/**
 * New visible words of this task, in one place so the owner can approve or change them (report: texts table).
 * PENDING OWNER APPROVAL ("mətnlər ok"). Everything else on the two screens reuses existing wording.
 */
export const SELLER_ORDERS_TEXT = {
  print: "Çap et",
  timeline: "Sifariş tarixçəsi",
} as const;

/**
 * SELLER-CUSTOMER-CARD-1: new visible words of the customer card and the address sheet, in one place.
 * PENDING OWNER APPROVAL ("mətnlər ok"). App names are brand names. Everything else reuses existing wording.
 */
export const SELLER_CUSTOMER_CARD_TEXT = {
  copyPhone: "Nömrəni kopyala",
  phoneCopied: "Nömrə kopyalandı.",
  copyCoordinates: "Koordinatları kopyala",
  coordinatesCopied: "Koordinatlar kopyalandı.",
  appleMaps: "Apple Maps",
  yandexMaps: "Yandex Maps",
} as const;

/** "Leyla Məmmədova" -> "LM": two letters for the avatar (first letters of the first two words, Azerbaijani upper case). */
export function customerInitials(name: string): string {
  const letters = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((word) => Array.from(word)[0] ?? "");
  return letters.join("").toLocaleUpperCase("az-AZ") || "?";
}

/** Statuses in the order the tabs show them (the seller's normal flow). Legacy statuses get a tab only when used. */
export const ORDER_TAB_STATUSES = ["NEW", "CONFIRMED", "PREPARING", "READY", "HANDED_TO_COURIER", "DELIVERED", "CANCELLED", "RETURNED"] as const;
export const LEGACY_ORDER_STATUSES = ["PENDING", "PROCESSING", "SHIPPED"] as const;

export type OrderStatusCounts = { total: number; byStatus: Record<string, number> };
export type OrderTab = { status: string; label: string; count: number };

/** Prisma groupBy rows ({ status, _count: { _all } }) -> totals. Unknown or empty rows are ignored. */
export function countsFromGroups(groups: readonly { status: string; _count: { _all: number } | number }[]): OrderStatusCounts {
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const group of groups) {
    const count = typeof group._count === "number" ? group._count : group._count?._all;
    if (!group.status || !Number.isSafeInteger(count) || count <= 0) continue;
    byStatus[group.status] = (byStatus[group.status] ?? 0) + count;
    total += count;
  }
  return { total, byStatus };
}

/**
 * Tabs: "all" first (status ""), then every normal status (also at 0, so the row does not jump), then a legacy
 * status only while some order still has it, or while it is the selected filter. Labels are the existing ones.
 */
export function buildOrderTabs(counts: OrderStatusCounts, selected = ""): OrderTab[] {
  const legacy = LEGACY_ORDER_STATUSES.filter((status) => (counts.byStatus[status] ?? 0) > 0 || status === selected);
  return [
    { status: "", label: "Bütün statuslar", count: counts.total },
    ...[...ORDER_TAB_STATUSES, ...legacy].map((status) => ({ status, label: statusLabel(status), count: counts.byStatus[status] ?? 0 })),
  ];
}

/** "#F45EKG1P": the last 8 characters of the customer order id, as the seller has always seen it. */
export function orderNumber(orderId: string): string {
  return `#${orderId.slice(-8).toUpperCase()}`;
}

const BAKU_PARTS = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Baku", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/**
 * "24.11.2026, 18:51" in Baku time. Built from parts, so the server and every browser print exactly the same
 * string (toLocaleString("az-AZ") differed between Node and Chromium and caused React hydration error #418).
 */
export function formatOrderDateTime(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const part = Object.fromEntries(BAKU_PARTS.formatToParts(date).map((item) => [item.type, item.value]));
  return `${part.day}.${part.month}.${part.year}, ${part.hour}:${part.minute}`;
}

export type TimelineStep = { key: string; label: string; at: string };

type TimelineInput = {
  createdAt: Date | string;
  status: string;
  shippedAt?: Date | string | null;
  outForDeliveryAt?: Date | string | null;
  deliveredAt?: Date | string | null;
  /** decidedAt of an APPROVED cancellation request: the only stored moment of a cancellation. */
  cancelledAt?: Date | string | null;
};

const iso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/**
 * Status strip: only moments that are stored on the store order. There is no stored time for "confirmed",
 * "preparing", "ready" or "returned", so those never appear here (the status badge still says the status), and
 * no date is ever guessed. The cancellation step needs both the CANCELLED status and an approved request's time.
 */
export function orderTimeline(input: TimelineInput): TimelineStep[] {
  const steps: { key: string; label: string; at: string | null }[] = [
    { key: "created", label: "Yaradılıb", at: iso(input.createdAt) },
    { key: "shipped", label: shipmentStatusLabel("SHIPPED"), at: iso(input.shippedAt) },
    { key: "outForDelivery", label: shipmentStatusLabel("OUT_FOR_DELIVERY"), at: iso(input.outForDeliveryAt) },
    { key: "delivered", label: shipmentStatusLabel("DELIVERED"), at: iso(input.deliveredAt) },
    { key: "cancelled", label: statusLabel("CANCELLED"), at: input.status === "CANCELLED" ? iso(input.cancelledAt) : null },
  ];
  return steps.filter((step): step is TimelineStep => Boolean(step.at)).sort((a, b) => a.at.localeCompare(b.at));
}

const DESTRUCTIVE = new Set(["CANCELLED", "RETURNED"]);

/** The server's allowed transitions split for the page: forward steps (primary) and cancel/return (separated, red). */
export function splitTransitions(transitions: readonly string[]): { forward: string[]; destructive: string[] } {
  return { forward: transitions.filter((status) => !DESTRUCTIVE.has(status)), destructive: transitions.filter((status) => DESTRUCTIVE.has(status)) };
}

/** Button text for a destructive step: the existing customer-side wording for a cancel, the status label otherwise. */
export function destructiveLabel(status: string): string {
  return status === "CANCELLED" ? "Sifarişi ləğv et" : statusLabel(status);
}

/** Store total = this store's items + this store's delivery fee (never another store's part). */
export function storeOrderTotal(order: { subtotal: number | string | { toString(): string }; deliveryFee?: number | string | { toString(): string } | null }): number {
  return Number(order.subtotal) + Number(order.deliveryFee ?? 0);
}

/** First product image for the item row (the card/cart rule); null shows the existing "no image" box. */
export function itemThumbnail(item: { product?: { images?: string[] | null } | null }): string | null {
  return item.product?.images?.find((url) => typeof url === "string" && url.length > 0) ?? null;
}

/** Order needs the seller's answer: highlighted in the list (status text stays the signal, colour only adds to it). */
export function needsAttention(status: string): boolean {
  return status === "NEW" || status === "PENDING";
}
