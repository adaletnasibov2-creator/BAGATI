export const SHIPMENT_STATUSES = ["PREPARING", "READY_FOR_SHIPMENT", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "DELIVERY_FAILED", "RETURNED"] as const;
export type ShipmentStatusValue = (typeof SHIPMENT_STATUSES)[number];

// Forward only. The simple seller flow (Hazırlanır -> Yolda -> Çatdırıldı) may skip the optional middle steps:
// start at "Yolda", go from PREPARING/READY_FOR_SHIPMENT straight to OUT_FOR_DELIVERY, and from SHIPPED to DELIVERED.
const transitions: Record<ShipmentStatusValue, readonly ShipmentStatusValue[]> = {
  PREPARING: ["READY_FOR_SHIPMENT", "OUT_FOR_DELIVERY"],
  READY_FOR_SHIPMENT: ["SHIPPED", "OUT_FOR_DELIVERY"],
  SHIPPED: ["OUT_FOR_DELIVERY", "DELIVERED", "DELIVERY_FAILED", "RETURNED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "DELIVERY_FAILED", "RETURNED"],
  DELIVERED: [],
  DELIVERY_FAILED: ["SHIPPED", "OUT_FOR_DELIVERY", "RETURNED"],
  RETURNED: [],
};

export function allowedShipmentTransitions(status: ShipmentStatusValue | null): ShipmentStatusValue[] {
  return [...(status ? transitions[status] : (["PREPARING", "OUT_FOR_DELIVERY"] as const))];
}

export function shipmentStatusLabel(status: ShipmentStatusValue): string {
  const labels: Record<ShipmentStatusValue, string> = {
    PREPARING: "Hazırlanır",
    READY_FOR_SHIPMENT: "Göndərişə hazırdır",
    SHIPPED: "Yola salınıb",
    OUT_FOR_DELIVERY: "Çatdırılma prosesindədir",
    DELIVERED: "Çatdırılıb",
    DELIVERY_FAILED: "Çatdırılma baş tutmadı",
    RETURNED: "Mağazaya qaytarılıb",
  };
  return labels[status];
}

/** The three steps customers and sellers see. Each maps onto the detailed shipment status. */
export const SIMPLE_SHIPMENT_STEPS = [
  { status: "PREPARING", label: "Hazırlanır" },
  { status: "OUT_FOR_DELIVERY", label: "Yolda" },
  { status: "DELIVERED", label: "Çatdırıldı" },
] as const satisfies readonly { status: ShipmentStatusValue; label: string }[];

/** 0 = Hazırlanır, 1 = Yolda, 2 = Çatdırıldı; -1 = not started. Failed attempts stay "Yolda"; a return shows how far it got. */
export function simpleShipmentStep(status: ShipmentStatusValue | null, times: { outForDeliveryAt?: Date | null; shippedAt?: Date | null; deliveredAt?: Date | null } = {}): number {
  switch (status) {
    case null: return -1;
    case "PREPARING": case "READY_FOR_SHIPMENT": return 0;
    case "SHIPPED": case "OUT_FOR_DELIVERY": case "DELIVERY_FAILED": return 1;
    case "DELIVERED": return 2;
    case "RETURNED": return times.deliveredAt ? 2 : times.outForDeliveryAt || times.shippedAt ? 1 : 0;
  }
}

/** The next simple step a seller can take from here, or null (delivered, returned, or not allowed). */
export function nextSimpleShipmentStatus(status: ShipmentStatusValue | null): ShipmentStatusValue | null {
  const allowed = allowedShipmentTransitions(status);
  const next = SIMPLE_SHIPMENT_STEPS.find((step, index) => index > simpleShipmentStep(status) && allowed.includes(step.status));
  return next?.status ?? null;
}

/**
 * The shipment status is independent of the order status: it never changes the order status, payment, revenue or
 * finance figures. It can only be changed while the store order is not cancelled or returned.
 */
export function shipmentChangeAllowedForOrder(orderStatus: string): boolean {
  return !["CANCELLED", "RETURNED"].includes(orderStatus);
}

/** Timestamps to write with a shipment change. "Yolda" also stamps shippedAt when the SHIPPED step was skipped. */
export function shipmentTimestamps(target: ShipmentStatusValue, current: { shippedAt: Date | null }, now: Date): Record<string, Date> {
  if (target === "SHIPPED") return { shippedAt: now };
  if (target === "OUT_FOR_DELIVERY") return current.shippedAt ? { outForDeliveryAt: now } : { shippedAt: now, outForDeliveryAt: now };
  if (target === "DELIVERED") return { deliveredAt: now };
  return {};
}

/** "14.11.2026 18:06" in Baku time; formatted on the server (pages pass the label, never the Date, to the browser). */
export function formatShipmentTime(date: Date): string {
  // Built from parts so the label is the same on every ICU version ("14.11.2026 18:06", no comma).
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Baku", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}`;
}

/** The customer's 3-step timeline for one store order: label, reached or not, and the time when one is recorded. */
export function simpleShipmentTimeline(storeOrder: { shipmentStatus: ShipmentStatusValue | null; shippedAt: Date | null; outForDeliveryAt: Date | null; deliveredAt: Date | null }) {
  const reached = simpleShipmentStep(storeOrder.shipmentStatus, storeOrder);
  const times = [null, storeOrder.outForDeliveryAt ?? storeOrder.shippedAt, storeOrder.deliveredAt];
  return SIMPLE_SHIPMENT_STEPS.map((step, index) => ({
    status: step.status, label: step.label, reached: index <= reached, current: index === reached,
    time: index <= reached && times[index] ? formatShipmentTime(times[index]!) : null,
  }));
}
