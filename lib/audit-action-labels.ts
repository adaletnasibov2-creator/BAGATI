/**
 * Azerbaijani labels for AuditLog action codes (SECURITY-PAGE-1). Used by /admin/audit-log and the security summary.
 * Unknown codes are shown as they are (never hidden). Pure; unit-tested.
 */
import { adminStatusLabel, type AdminStatusKind } from "@/lib/admin-labels";

export const AUDIT_ACTION_LABELS: Readonly<Record<string, string>> = {
  // Admin sign-in and account security
  ADMIN_LOGIN: "Admin girişi",
  ADMIN_LOGIN_FAILED: "Admin hesabına uğursuz giriş cəhdi",
  ADMIN_2FA_ENROLLED: "İki mərhələli təsdiq qoşuldu",
  ADMIN_2FA_DISABLED: "İki mərhələli təsdiq söndürüldü",
  ADMIN_2FA_FAILED: "Yanlış 2FA kodu və ya şifrə",
  ADMIN_2FA_LOCKED: "2FA kilidləndi (çox sayda yanlış kod)",
  ADMIN_2FA_RECOVERY_CODE_USED: "Bərpa kodu istifadə edildi",
  ADMIN_SESSION_REVOKED: "Sessiya bağlandı",
  ADMIN_SESSIONS_REVOKED: "Digər sessiyalar bağlandı",
  PASSWORD_CHANGE: "Şifrə dəyişdirildi",
  PASSWORD_RESET: "Şifrə bərpa edildi",
  // Security center
  SECURITY_FULL_IP_VIEW: "Tam IP ünvanlarına baxıldı",
  SECURITY_INCIDENT_ASSIGN: "İnsident təyin edildi",
  SECURITY_INCIDENT_NOTE: "İnsidentə qeyd əlavə edildi",
  SECURITY_INCIDENT_STATUS: "İnsidentin statusu dəyişdi",
  SECURITY_RULE_UPDATE: "Təhlükəsizlik qaydası dəyişdi",
  SECURITY_IP_BLOCK_CREATE: "IP bloku yaradıldı",
  SECURITY_IP_BLOCK_REMOVE: "IP bloku götürüldü",
  // Viewing personal data / exports
  AUDIT_EXPORT: "Audit jurnalı ixrac edildi",
  ORDER_COORDINATES_VIEW: "Sifarişin xəritə koordinatlarına baxıldı",
  CONVERSATION_ADMIN_VIEW: "Admin yazışmaya baxdı",
  CONVERSATION_REPORT_REVIEWED: "Yazışma şikayətinə baxıldı",
  CONVERSATION_REPORT_DISMISSED: "Yazışma şikayəti rədd edildi",
  // Users, sellers, stores
  USER_ACTIVATE: "İstifadəçi aktivləşdirildi",
  USER_DEACTIVATE: "İstifadəçi deaktiv edildi",
  ADMIN_VENDOR_CREATE: "Admin satıcı hesabı yaratdı",
  ADMIN_MANAGED_STORE_CREATE: "Admin mağaza yaratdı",
  STORE_APPROVE: "Mağaza təsdiqləndi",
  STORE_REJECT: "Mağaza rədd edildi",
  STORE_SUSPEND: "Mağaza dayandırıldı",
  STORE_REACTIVATE: "Mağaza yenidən aktivləşdirildi",
  STORE_DEACTIVATE_ARCHIVE: "Mağaza deaktiv edilib arxivə köçürüldü",
  STORE_DELETE_ARCHIVE: "Mağaza silinmək üçün arxivə köçürüldü",
  STORE_PERMANENT_DELETE: "Mağaza tamamilə silindi",
  SELLER_APPLICATION_SUBMITTED: "Satıcı müraciəti göndərildi",
  SELLER_APPLICATION_APPROVED: "Satıcı müraciəti təsdiqləndi",
  SELLER_APPLICATION_REJECTED: "Satıcı müraciəti rədd edildi",
  SELLER_APPLICATION_WITHDRAWN: "Satıcı müraciəti geri götürüldü",
  SELLER_VOEN_VERIFIED: "VÖEN təsdiqləndi",
  SELLER_VOEN_VERIFICATION_REVOKED: "VÖEN təsdiqi ləğv edildi",
  SELLER_VOEN_VERIFICATION_RESET: "VÖEN təsdiqi sıfırlandı",
  SELLER_LEGAL_INFORMATION_UPDATE: "Satıcının hüquqi məlumatı dəyişdi",
  SELLER_STOREFRONT_UPDATE: "Mağaza vitrini dəyişdi",
  LEGAL_TERMS_ACCEPTED: "Hüquqi şərtlər qəbul edildi",
  // Catalogue, content, settings
  ADMIN_PRODUCT_UPDATE: "Admin məhsulu dəyişdi",
  ADMIN_PRODUCT_IMPORT: "Admin məhsul idxal etdi",
  ADMIN_STORE_AUTO_PUBLISH_PRODUCT: "Məhsul avtomatik dərc edildi",
  ADMIN_PROMOTION_CREATE: "Kampaniya yaradıldı",
  ADMIN_PROMOTION_UPDATE: "Kampaniya dəyişdi",
  ADMIN_PROMOTION_DEACTIVATE: "Kampaniya dayandırıldı",
  COMMISSION_CREATE: "Komissiya qaydası yaradıldı",
  COMMISSION_UPDATE: "Komissiya qaydası dəyişdi",
  CATEGORY_CREATE: "Kateqoriya yaradıldı",
  CATEGORY_DELETE: "Kateqoriya silindi",
  CATEGORY_REORDER: "Kateqoriyaların sırası dəyişdi",
  PRODUCTS_CATEGORY_MOVE: "Məhsullar başqa kateqoriyaya köçürüldü",
  CONTENT_PAGE_UPDATE: "Məlumat səhifəsi dəyişdi",
  CONTENT_PAGE_RESTORE: "Məlumat səhifəsinin əvvəlki versiyası bərpa edildi",
  HOME_BANNER_CREATE: "Ana səhifə banneri yaradıldı",
  HOME_BANNER_UPDATE: "Ana səhifə banneri dəyişdi",
  HOME_BANNER_DEACTIVATE: "Ana səhifə banneri söndürüldü",
  HOMEPAGE_FEATURED_UPDATE: "Ana səhifədəki seçilmiş məhsullar dəyişdi",
  SITE_SETTING_UPDATE: "Sayt ayarı dəyişdi",
  SITE_SETTINGS_UPDATE: "Sayt ayarları dəyişdi",
  REVIEW_REMOVE: "Rəy silindi",
  // E-mail
  EMAIL_TEST_SEND: "Test e-poçtu göndərildi",
  EMAIL_OUTBOX_DRAIN: "E-poçt növbəsi əl ilə işlədildi",
  EMAIL_OUTBOX_RETRY: "E-poçt yenidən göndərildi",
  // Orders and payments
  SHIPMENT_STATUS_UPDATE: "Çatdırılma statusu dəyişdi",
  ORDER_CANCELLATION_REQUESTED: "Müştəri sifarişin ləğvini istədi",
  ORDER_CANCELLATION_WITHDRAWN: "Ləğv müraciəti geri götürüldü",
  ORDER_RECEIPT_CONFIRMED: "Alıcı təhvil aldığını təsdiqlədi", // ORDER-NOTIFY-1 (owner's wording)
  ORDER_CANCELLED_BY_CUSTOMER: "Müştəri sifarişi ləğv etdi",
  ORDER_EXPIRED_UNPAID: "Ödənilməmiş sifariş avtomatik ləğv edildi",
  PAYMENT_PAID_AFTER_CANCELLATION: "Ləğvdən sonra ödəniş daxil oldu (əl ilə qaytarılmalıdır)",
  // Generic
  CREATE: "Yaradıldı",
  UPDATE: "Dəyişdirildi",
};

/** Codes built as PREFIX + status (most specific prefix first). */
const STATUS_PREFIXES: ReadonlyArray<{ prefix: string; label: string; kind: AdminStatusKind | null; values?: Record<string, string> }> = [
  { prefix: "ORDER_CANCELLATION_", label: "Ləğv müraciəti", kind: null, values: { APPROVED: "təsdiqləndi", REJECTED: "rədd edildi" } },
  { prefix: "SUBSCRIPTION_ADMIN_", label: "Abunəlik statusu", kind: "subscription" },
  { prefix: "RETURN_ADMIN_", label: "Qaytarılma statusu", kind: "return" },
  { prefix: "PRODUCT_", label: "Məhsul statusu", kind: "product" },
  { prefix: "ORDER_", label: "Sifariş statusu", kind: "order" },
];

export function auditActionLabel(code: string | null | undefined): string {
  const action = (code ?? "").trim();
  if (!action) return "—";
  const exact = AUDIT_ACTION_LABELS[action];
  if (exact) return exact;
  for (const item of STATUS_PREFIXES) {
    if (!action.startsWith(item.prefix) || action.length === item.prefix.length) continue;
    const status = action.slice(item.prefix.length);
    const statusText = item.values ? item.values[status] : item.kind ? adminStatusLabel(item.kind, status) : undefined;
    if (statusText && statusText !== status) return `${item.label}: ${statusText}`;
  }
  return action;
}

/** Audit actions shown in the security summary's "Son təhlükəsizlik əməliyyatları" block. */
export const SECURITY_AUDIT_ACTIONS = [
  "ADMIN_LOGIN", "ADMIN_LOGIN_FAILED", "ADMIN_2FA_ENROLLED", "ADMIN_2FA_DISABLED", "ADMIN_2FA_FAILED", "ADMIN_2FA_LOCKED",
  "ADMIN_2FA_RECOVERY_CODE_USED", "ADMIN_SESSION_REVOKED", "ADMIN_SESSIONS_REVOKED", "PASSWORD_CHANGE", "PASSWORD_RESET",
  "SECURITY_FULL_IP_VIEW", "SECURITY_INCIDENT_STATUS", "SECURITY_RULE_UPDATE", "USER_ACTIVATE", "USER_DEACTIVATE",
  "AUDIT_EXPORT", "ADMIN_VENDOR_CREATE",
] as const;
