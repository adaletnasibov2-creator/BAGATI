/**
 * ORDER-NOTIFY-1: every new visible text of this task, in one place (report: texts table).
 * APPROVED by the owner 2026-11-25 ("mətnlər ok", all 15). "Təhvil aldım" and "Alıcı təhvil aldığını təsdiqlədi" are the owner's own
 * words from the task; "Sifarişə bax" and "Sifarişlərə bax" reuse existing link labels.
 * No text mentions payment, prices, delivery times or free delivery.
 */
import { VENDOR_NOTIFICATION_TITLES } from "@/lib/vendor-notifications";

export const ORDER_NOTIFY_TEXT = {
  // Customer e-mails (template CUSTOMER_ORDER_PROGRESS). First line of every body: "Sifariş #AB12CD34 — <Mağaza>."
  confirmedSubject: "Mağaza sifarişinizi təsdiqlədi",
  confirmedLine: "Mağaza sifarişinizi təsdiqlədi.",
  onTheWaySubject: "Sifarişiniz yoldadır",
  onTheWayLine: "Mağaza sifarişinizi göndərdi.",
  onTheWayReceiptHint: "Sifarişi təhvil aldıqdan sonra sifariş səhifəsində “Təhvil aldım” düyməsini basın.",
  deliveredSubject: "Sifarişiniz çatdırıldı",
  deliveredLine: "Mağaza sifarişin çatdırıldığını qeyd etdi.",
  deliveredReceiptHint: "Sifarişi təhvil almısınızsa, sifariş səhifəsində “Təhvil aldım” düyməsini basın.",
  cancelledSubject: "Mağaza sifarişinizi ləğv etdi",
  cancelledLine: "Mağaza bu sifarişi ləğv etdi.",
  orderLink: "Sifarişə bax", // reused (customer orders list)

  // Customer order page and the confirmation endpoint
  receiptButton: "Təhvil aldım", // owner's wording
  receiptConfirmed: "Təhvil aldığınızı təsdiqlədiniz:", // + date and time (Baku)
  receiptNotAllowed: "Bu sifariş üçün təhvil təsdiqi hələ mümkün deyil.",

  // Seller order page, in-app notification and e-mail (template SELLER_CUSTOMER_CONFIRMED)
  sellerConfirmed: VENDOR_NOTIFICATION_TITLES.customerConfirmedReceipt, // "Alıcı təhvil aldığını təsdiqlədi" (owner's wording); notification title and e-mail subject
  sellerNotificationBody: (orderRef: string) => `Sifariş #${orderRef}: alıcı təhvil aldığını təsdiqlədi.`,
  sellerEmailLine: "Alıcı sifarişi təhvil aldığını təsdiqlədi.",
  sellerEmailStatusNote: "Bu təsdiq sifarişin statusunu dəyişmir.",
  sellerLink: "Sifarişlərə bax", // reused (seller new-order e-mail)
} as const;
