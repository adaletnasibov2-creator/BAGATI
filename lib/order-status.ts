export const VENDOR_ORDER_STATUSES = ["NEW", "CONFIRMED", "PREPARING", "READY", "HANDED_TO_COURIER", "DELIVERED", "CANCELLED", "RETURNED"] as const;

const transitions: Record<string, readonly string[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"], NEW: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "CANCELLED"], PROCESSING: ["READY", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"], READY: ["HANDED_TO_COURIER", "CANCELLED"],
  SHIPPED: ["DELIVERED", "RETURNED"], HANDED_TO_COURIER: ["DELIVERED", "RETURNED"], DELIVERED: ["RETURNED"],
};

export function allowedVendorOrderTransitions(status: string): string[] { return [...(transitions[status] ?? [])]; }

export function statusLabel(status: string): string {
  const labels: Record<string, string> = { PENDING: "Gözləyir", NEW: "Yeni", CONFIRMED: "Təsdiqləndi", PROCESSING: "Hazırlanır", PREPARING: "Hazırlanır", READY: "Hazırdır", SHIPPED: "Yoldadır", HANDED_TO_COURIER: "Kuryerə verildi", DELIVERED: "Çatdırıldı", CANCELLED: "Ləğv edildi", RETURNED: "Qaytarıldı" };
  return labels[status] ?? status;
}

export function paymentStatusLabel(status?: string): string {
  if (!status) return "Ödəniş qeydi yoxdur";
  const labels: Record<string, string> = {
    PENDING: "Ödəniş gözləyir",
    AUTHORIZED: "Ödəniş təsdiqlənib",
    PAID: "Ödənilib",
    FAILED: "Ödəniş alınmadı",
    REFUNDED: "Geri ödənilib",
  };
  return labels[status] ?? "Status məlum deyil";
}

export function aggregateParentOrderStatus(statuses: string[]): string {
  if (!statuses.length) return "PENDING";
  if (statuses.every((s) => ["DELIVERED", "CANCELLED", "RETURNED"].includes(s))) {
    return statuses.includes("DELIVERED") ? "DELIVERED" : statuses.includes("RETURNED") ? "RETURNED" : "CANCELLED";
  }
  if (statuses.some((s) => ["HANDED_TO_COURIER", "SHIPPED"].includes(s))) return "SHIPPED";
  if (statuses.some((s) => ["PREPARING", "READY", "PROCESSING"].includes(s))) return "PROCESSING";
  if (statuses.some((s) => s === "CONFIRMED")) return "CONFIRMED";
  return "PENDING";
}
