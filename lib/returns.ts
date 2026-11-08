export const RETURN_STATUS = [
  "REQUESTED",
  "APPROVED",
  "REJECTED",
  "ITEM_RECEIVED",
  "REFUND_PENDING",
  "REFUNDED",
  "EXCHANGE_PENDING",
  "EXCHANGED",
  "CANCELLED",
] as const;

export type ReturnStatusValue = (typeof RETURN_STATUS)[number];
export type ReturnResolutionValue = "REFUND" | "EXCHANGE";

/** Returns must use the immutable amount recorded on the order item. */
export function chargedReturnAmount(lineTotalSnapshot: string | number | { toString(): string }): string {
  const amount = String(lineTotalSnapshot);
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) throw new Error("Invalid charged return amount snapshot");
  return amount;
}

export function nextReturnStatus(
  current: ReturnStatusValue,
  action: "approve" | "reject" | "cancel" | "receive" | "restore-stock" | "process-resolution" | "complete-exchange",
  resolution: ReturnResolutionValue,
): ReturnStatusValue | null {
  if (current === "REQUESTED") {
    if (action === "approve") return "APPROVED";
    if (action === "reject") return "REJECTED";
    if (action === "cancel") return "CANCELLED";
  }
  if (current === "APPROVED" && action === "receive") return "ITEM_RECEIVED";
  if (current === "ITEM_RECEIVED" && action === "restore-stock") return "ITEM_RECEIVED";
  if (current === "ITEM_RECEIVED" && action === "process-resolution") {
    if (resolution === "REFUND") return "REFUND_PENDING";
    return "EXCHANGE_PENDING";
  }
  if (current === "EXCHANGE_PENDING" && action === "complete-exchange" && resolution === "EXCHANGE") return "EXCHANGED";
  return null;
}

export function returnStatusLabel(status: ReturnStatusValue): string {
  const labels: Record<ReturnStatusValue, string> = {
    REQUESTED: "Sorğu göndərildi",
    APPROVED: "Qaytarılma təsdiqləndi",
    REJECTED: "Sorğu rədd edildi",
    ITEM_RECEIVED: "Məhsul mağazaya çatdı",
    REFUND_PENDING: "Geri ödəniş gözləyir",
    REFUNDED: "Geri ödəniş tamamlandı",
    EXCHANGE_PENDING: "Dəyişdirilmə hazırlanır",
    EXCHANGED: "Məhsul dəyişdirildi",
    CANCELLED: "Sorğu ləğv edildi",
  };
  return labels[status];
}

