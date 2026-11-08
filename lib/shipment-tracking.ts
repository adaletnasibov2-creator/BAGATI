export const SHIPMENT_STATUSES = ["PREPARING", "READY_FOR_SHIPMENT", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "DELIVERY_FAILED", "RETURNED"] as const;
export type ShipmentStatusValue = (typeof SHIPMENT_STATUSES)[number];

const transitions: Record<ShipmentStatusValue, readonly ShipmentStatusValue[]> = {
  PREPARING: ["READY_FOR_SHIPMENT"],
  READY_FOR_SHIPMENT: ["SHIPPED"],
  SHIPPED: ["OUT_FOR_DELIVERY", "DELIVERY_FAILED", "RETURNED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "DELIVERY_FAILED", "RETURNED"],
  DELIVERED: [],
  DELIVERY_FAILED: ["SHIPPED", "OUT_FOR_DELIVERY", "RETURNED"],
  RETURNED: [],
};

export function allowedShipmentTransitions(status: ShipmentStatusValue | null): ShipmentStatusValue[] {
  return [...(status ? transitions[status] : (["PREPARING"] as const))];
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
