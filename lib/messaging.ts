/**
 * Customer <-> store messaging: pure rules (no database, no settings imports, safe for client components).
 * Owner decisions 2026-11-16 (release-output/messaging-phase0.md): logged-in customers and the store's seller only,
 * text only, conversations tied to a product, a store order or the store in general; the store only replies; e-mails
 * carry a link only; phone numbers and e-mail addresses in messages are refused unless messaging.allowContactDetails
 * is on.
 */
import { normalizeAzPhone } from "@/lib/az-phone";

export const MESSAGE_LIMITS = {
  bodyMin: 1,
  bodyMax: 1000,
  /** Request body cap for the send endpoint. */
  bodyBytes: 4 * 1024,
  previewMax: 140,
  reportNoteMax: 500,
  /** Messages per thread page, newest first. */
  pageSize: 30,
  /** Conversations per inbox page. */
  inboxPageSize: 20,
} as const;

/** Hourly / daily numbers are admin settings (limits.messaging.*); the windows stay in code. */
export const MESSAGING_LIMIT_DEFAULTS = {
  customerMessagesPerHour: 30,
  customerNewConversationsPerDay: 10,
  storeMessagesPerHour: 200,
  storeIncomingPerHour: 120,
} as const;
export type MessagingLimits = { [K in keyof typeof MESSAGING_LIMIT_DEFAULTS]: number };

export const MESSAGING_WINDOWS = {
  customerMessagesPerHour: 60 * 60 * 1000,
  customerNewConversationsPerDay: 24 * 60 * 60 * 1000,
  storeMessagesPerHour: 60 * 60 * 1000,
  storeIncomingPerHour: 60 * 60 * 1000,
} as const satisfies Record<keyof typeof MESSAGING_LIMIT_DEFAULTS, number>;

/** At most one notification e-mail per conversation and recipient side in this window. */
export const MESSAGE_EMAIL_WINDOW_MS = 15 * 60 * 1000;

export const MESSAGING_TEXT = {
  bodyRequired: "Mesajı yazın.",
  bodyTooLong: `Mesaj ən çox ${MESSAGE_LIMITS.bodyMax} simvol ola bilər.`,
  bodyInvalid: "Mesajda icazə verilməyən simvollar var.",
  contactDetails: "Təhlükəsizliyiniz üçün mesajda telefon nömrəsi və ya e-poçt ünvanı paylaşmayın.",
  rateLimited: "Çox sayda mesaj göndərildi. Bir az sonra yenidən cəhd edin.",
  blocked: "Bu söhbətə mesaj göndərmək mümkün deyil.",
  storeUnavailable: "Mağaza hazırda mesaj qəbul etmir.",
  disabled: "Mesajlaşma hazırda əlçatan deyil.",
  customerFallbackName: "Müştəri",
} as const;

export type ConversationContextValue = "PRODUCT" | "ORDER" | "STORE";
export type MessageSenderRoleValue = "CUSTOMER" | "STORE";

export const REPORT_REASONS = {
  SPAM: "Spam",
  ABUSE: "Təhqir və ya hədə",
  FRAUD: "Fırıldaq şübhəsi",
  OTHER: "Digər",
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;
export function isReportReason(value: unknown): value is ReportReason {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(REPORT_REASONS, value);
}

/** One thread per customer, store and context: "product:<id>", "order:<storeOrderId>" or "store". */
export function conversationContextKey(context: ConversationContextValue, id?: string | null): string {
  if (context === "STORE") return "store";
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new RangeError("MESSAGING_CONTEXT_ID_INVALID");
  return `${context === "PRODUCT" ? "product" : "order"}:${id}`;
}

/** What the seller sees instead of the customer's e-mail or phone: "Aysel M.", or "Müştəri". */
export function customerDisplayName(firstName?: string | null, lastName?: string | null): string {
  const first = firstName?.trim().split(/\s+/)[0] ?? "";
  const initial = lastName?.trim().charAt(0) ?? "";
  if (!first) return MESSAGING_TEXT.customerFallbackName;
  return initial ? `${first} ${initial.toLocaleUpperCase("az-AZ")}.` : first;
}

/** Single-line preview for inbox lists (never more than previewMax characters). */
export function messagePreview(body: string): string {
  const line = body.replace(/\s+/g, " ").trim();
  return line.length <= MESSAGE_LIMITS.previewMax ? line : `${line.slice(0, MESSAGE_LIMITS.previewMax - 1)}…`;
}

/** Outbox event key: the outbox dedupe sends one e-mail per conversation, recipient side and 15-minute window. */
export function messageEmailEventKey(conversationId: string, recipient: MessageSenderRoleValue, now: Date | number = Date.now()): string {
  const time = typeof now === "number" ? now : now.getTime();
  return `message:${conversationId}:${recipient}:${Math.floor(time / MESSAGE_EMAIL_WINDOW_MS)}`;
}

// ---- Contact details -----------------------------------------------------------------------------------------

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/i;
/** Digit runs that may be written like a phone number: digits with spaces, dashes, dots or brackets between them. */
const NUMBER_RUN = /\+?\(?\d[\d\s().-]*\d\)?/g;
const INTERNATIONAL = /^\+\d{10,15}$/;

/**
 * Finds a phone number or an e-mail address in a message. A digit sequence counts as a phone number when it is a
 * valid Azerbaijani number (lib/az-phone.ts) AND it is a mobile number or is written with a leading 0, +994 or 994 —
 * so bare 9-digit codes such as order or tracking numbers are not refused — or when it is "+" and 10–15 digits.
 * Prices ("1 299.90") and short numbers never match. Spelled-out numbers are not detected (documented limitation).
 */
export function findContactDetails(text: string): "EMAIL" | "PHONE" | null {
  if (EMAIL_PATTERN.test(text)) return "EMAIL";
  for (const match of text.matchAll(NUMBER_RUN)) {
    const run = match[0];
    // Try every contiguous span of digit groups, so "2 ədəd, 050 123 45 67" and "1 050 123 45 67" are both checked.
    const groups = [...run.matchAll(/\+?\(?\d+\)?/g)].map((group) => ({ text: group[0], start: group.index ?? 0 }));
    for (let from = 0; from < groups.length; from++) {
      for (let to = from; to < groups.length; to++) {
        const span = run.slice(groups[from].start, groups[to].start + groups[to].text.length).trim();
        const digits = span.replace(/\D/g, "");
        if (digits.length < 9 || digits.length > 15) continue;
        const compact = span.replace(/[\s().-]/g, "");
        if (INTERNATIONAL.test(compact)) return "PHONE";
        const phone = normalizeAzPhone(span);
        if (!phone) continue;
        const marked = compact.startsWith("0") || compact.startsWith("+") || compact.startsWith("994");
        if (phone.mobile || marked) return "PHONE";
      }
    }
  }
  return null;
}

// ---- Message body ----------------------------------------------------------------------------------------------

// Line breaks and tabs are allowed; no other control characters.
const MULTI_LINE = /^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]*$/;

export type MessageBodyResult =
  | { ok: true; body: string }
  | { ok: false; code: "REQUIRED" | "TOO_LONG" | "INVALID" | "CONTACT_DETAILS"; message: string };

/** Normalizes and checks a message: trimmed, CRLF -> LF, at most one blank line in a row, 1–1000 characters. */
export function validateMessageBody(raw: unknown, options: { allowContactDetails: boolean }): MessageBodyResult {
  if (typeof raw !== "string") return { ok: false, code: "REQUIRED", message: MESSAGING_TEXT.bodyRequired };
  if (!MULTI_LINE.test(raw)) return { ok: false, code: "INVALID", message: MESSAGING_TEXT.bodyInvalid };
  const body = raw.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (body.length < MESSAGE_LIMITS.bodyMin) return { ok: false, code: "REQUIRED", message: MESSAGING_TEXT.bodyRequired };
  if (body.length > MESSAGE_LIMITS.bodyMax) return { ok: false, code: "TOO_LONG", message: MESSAGING_TEXT.bodyTooLong };
  if (!options.allowContactDetails && findContactDetails(body)) return { ok: false, code: "CONTACT_DETAILS", message: MESSAGING_TEXT.contactDetails };
  return { ok: true, body };
}
