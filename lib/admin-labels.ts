/**
 * Azerbaijani labels and badge tones for status values shown in the admin panel. ONE place for all of them.
 * Display only: stored values and URL filter values stay the raw enum (e.g. ?status=PENDING_REVIEW).
 * Wording follows the existing customer/seller labels (lib/order-status.ts, lib/seller-application.ts,
 * lib/returns.ts, vendor store editor); in admin PREPARING and PROCESSING are kept apart ("Hazırlanır" /
 * "Emal olunur", as in the e-mail templates) because both appear in the same filter.
 * The Review model has no status field, so there is no review status kind.
 */
import type { BadgeTone } from "@/components/admin-ui/status-badge";

type LabelMap = Record<string, readonly [label: string, tone: BadgeTone]>;

export const ADMIN_STATUS_LABELS = {
  store: {
    DRAFT: ["Qaralama", "neutral"],
    PENDING_REVIEW: ["Yoxlama gözləyir", "warning"],
    ACTIVE: ["Aktiv", "success"],
    SUSPENDED: ["Dayandırılıb", "danger"],
    REJECTED: ["Rədd edilib", "danger"],
  },
  product: {
    DRAFT: ["Qaralama", "neutral"],
    ACTIVE: ["Aktiv", "success"],
    ARCHIVED: ["Arxivdə", "neutral"],
  },
  order: {
    PENDING: ["Gözləyir", "warning"],
    NEW: ["Yeni", "info"],
    CONFIRMED: ["Təsdiqləndi", "info"],
    PREPARING: ["Hazırlanır", "info"],
    READY: ["Hazırdır", "info"],
    HANDED_TO_COURIER: ["Kuryerə verildi", "accent"],
    PROCESSING: ["Emal olunur", "info"],
    SHIPPED: ["Yoldadır", "accent"],
    DELIVERED: ["Çatdırıldı", "success"],
    CANCELLED: ["Ləğv edildi", "danger"],
    RETURNED: ["Qaytarıldı", "neutral"],
  },
  subscription: {
    PENDING: ["Ödəniş gözləyir", "warning"],
    ACTIVE: ["Aktiv", "success"],
    PAST_DUE: ["Ödəniş gecikib", "danger"],
    SUSPENDED: ["Dayandırılıb", "danger"],
    CANCELLED: ["Ləğv edilib", "neutral"],
    EXPIRED: ["Bitib", "neutral"],
  },
  support: {
    OPEN: ["Açıq", "warning"],
    IN_PROGRESS: ["İcrada", "info"],
    RESOLVED: ["Həll edilib", "success"],
    CLOSED: ["Bağlanıb", "neutral"],
  },
  sellerApplication: {
    PENDING: ["Yoxlanılır", "warning"],
    APPROVED: ["Təsdiqlənib", "success"],
    REJECTED: ["Rədd edilib", "danger"],
    WITHDRAWN: ["Geri götürülüb", "neutral"],
  },
  payment: {
    PENDING: ["Gözləyir", "warning"],
    AUTHORIZED: ["Təsdiqlənib (bloklanıb)", "info"],
    PAID: ["Ödənilib", "success"],
    FAILED: ["Uğursuz", "danger"],
    REFUNDED: ["Geri qaytarılıb", "neutral"],
  },
  return: {
    REQUESTED: ["Sorğu göndərildi", "warning"],
    APPROVED: ["Təsdiqləndi", "info"],
    REJECTED: ["Rədd edildi", "danger"],
    ITEM_RECEIVED: ["Məhsul qəbul edildi", "info"],
    REFUND_PENDING: ["Geri ödəniş gözləyir", "warning"],
    REFUNDED: ["Geri ödənildi", "success"],
    EXCHANGE_PENDING: ["Dəyişdirilmə hazırlanır", "warning"],
    EXCHANGED: ["Dəyişdirildi", "success"],
    CANCELLED: ["Ləğv edildi", "neutral"],
  },
  /** ProductImport.status (ImportStatus). */
  import: {
    PENDING: ["Gözləyir", "warning"],
    VALIDATING: ["Yoxlanılır", "info"],
    COMPLETED: ["Tamamlandı", "success"],
    FAILED: ["Uğursuz", "danger"],
  },
} as const satisfies Record<string, LabelMap>;

export type AdminStatusKind = keyof typeof ADMIN_STATUS_LABELS;

/** Azerbaijani label; an unknown value is shown as-is (never hidden). */
export function adminStatusLabel(kind: AdminStatusKind, value: string | null | undefined): string {
  if (!value) return "—";
  const entry = (ADMIN_STATUS_LABELS[kind] as LabelMap)[value];
  return entry ? entry[0] : value;
}

export function adminStatusTone(kind: AdminStatusKind, value: string | null | undefined): BadgeTone {
  if (!value) return "neutral";
  const entry = (ADMIN_STATUS_LABELS[kind] as LabelMap)[value];
  return entry ? entry[1] : "neutral";
}

/** Filter <select> options: id = raw value (kept in the URL), name = label. */
export function adminStatusOptions(kind: AdminStatusKind, values: readonly string[]): { id: string; name: string }[] {
  return values.map((value) => ({ id: value, name: adminStatusLabel(kind, value) }));
}
