/**
 * Seller application rules (Variant B): pure, no database, unit-tested.
 * A customer applies, the role stays CUSTOMER, and only an admin approval turns the account into a seller.
 */
import { z } from "zod";
import { AZ_PHONE_ERROR, normalizeAzPhone } from "@/lib/az-phone";

/** Same values as the SellerType enum; kept here so this module stays free of Prisma imports (used by client forms). */
const sellerTypes = ["INDIVIDUAL_ENTREPRENEUR", "REGISTERED_COMPANY"] as const;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const SELLER_APPLICATION_RULES = {
  /** Wait after a REJECTED or WITHDRAWN application before the next one. */
  reapplyWaitMs: 24 * HOUR_MS,
  /** At most `maxPerWindow` customer applications in any rolling `windowMs`. */
  windowMs: 30 * DAY_MS,
  maxPerWindow: 3,
  applicantNoteMax: 1000,
  adminNoteMax: 1000,
  rejectionReasonMin: 10,
  rejectionReasonMax: 500,
  bodyBytes: 8 * 1024,
} as const;

/** Per-user request limit on the application endpoints (in addition to the reapply rules). */
export const SELLER_APPLICATION_RATE_LIMIT = { limit: 20, windowMs: HOUR_MS } as const;
export const SELLER_APPLICATION_PROCESS_RATE_LIMIT = { limit: 300, windowMs: 15 * 60 * 1000 } as const;

export const SELLER_APPLICATION_STATUS_LABELS = {
  PENDING: "Yoxlanılır",
  APPROVED: "Təsdiqlənib",
  REJECTED: "Rədd edilib",
  WITHDRAWN: "Geri götürülüb",
} as const;
export type SellerApplicationStatus = keyof typeof SELLER_APPLICATION_STATUS_LABELS;
export const SELLER_APPLICATION_STATUSES = Object.keys(SELLER_APPLICATION_STATUS_LABELS) as SellerApplicationStatus[];

export const SELLER_APPLICATION_SOURCE_LABELS = { SELF: "Müştəri müraciəti", ADMIN: "Admin yaradıb", LEGACY: "Köhnə satıcı" } as const;
export const SELLER_TYPE_LABELS = { INDIVIDUAL_ENTREPRENEUR: "Fərdi sahibkar", REGISTERED_COMPANY: "Qeydiyyatdan keçmiş şirkət" } as const;

export const SELLER_APPLICATION_MESSAGES = {
  signIn: "Satıcı müraciəti üçün təsdiqlənmiş müştəri hesabı ilə daxil olun.",
  invalid: "Məlumatları yoxlayın.",
  open: "Sizin artıq yoxlamada olan müraciətiniz var.",
  wait: "Yeni müraciəti bir az sonra göndərə bilərsiniz.",
  limit: "Son 30 gündə müraciət limitinə çatmısınız.",
  rateLimited: "Çox sayda sorğu göndərildi. Bir az sonra yenidən cəhd edin.",
  accountChanged: "Hesabın statusu dəyişib. Səhifəni yeniləyin.",
  notPending: "Bu müraciət artıq yoxlamada deyil.",
  notFound: "Müraciət tapılmadı.",
  unavailable: "Əməliyyatı indi tamamlamaq mümkün olmadı. Bir az sonra yenidən cəhd edin.",
  submitted: "Müraciətiniz qəbul edildi. Admin yoxlamasından sonra hesabınız satıcı hesabına çevriləcək.",
  withdrawn: "Müraciətiniz geri götürüldü.",
  voen: "VÖEN 10 rəqəmdən ibarət olmalıdır.",
  legalAddress: "Qeydiyyatdan keçmiş şirkət üçün hüquqi ünvan tələb olunur.",
} as const;

/** Digits only; null when nothing is left. "12 345-678 90" → "1234567890". */
export function normalizeVoen(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits ? digits : null;
}

export function isValidNewVoen(value: string | null | undefined): boolean {
  const digits = normalizeVoen(value);
  return digits !== null && /^\d{10}$/.test(digits);
}

/** For lists: only the last three digits. Full VÖEN is shown on the admin detail page only. */
export function maskVoen(value: string | null | undefined): string {
  const digits = normalizeVoen(value);
  if (!digits) return "—";
  return `${"•".repeat(Math.max(0, digits.length - 3))}${digits.slice(-3)}`;
}

const optionalText = (max: number) => z.union([z.string(), z.null(), z.undefined()])
  .transform((value) => (typeof value === "string" && value.trim() ? value.trim() : null))
  .refine((value) => value === null || value.length <= max, { message: `Ən çox ${max} simvol.` });

export const sellerApplicationInputSchema = z.object({
  displayName: z.string().trim().min(2, "Satıcı adı ən azı 2 simvol olmalıdır.").max(120),
  phone: z.string().transform((value, context) => {
    const normalized = normalizeAzPhone(value);
    if (!normalized) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: AZ_PHONE_ERROR });
      return z.NEVER;
    }
    return normalized.e164;
  }),
  sellerType: z.enum(sellerTypes),
  legalName: z.string().trim().min(2, "Hüquqi adı yazın.").max(200),
  voen: z.string().max(40).transform((value, context) => {
    const digits = normalizeVoen(value);
    if (!digits || !/^\d{10}$/.test(digits)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: SELLER_APPLICATION_MESSAGES.voen });
      return z.NEVER;
    }
    return digits;
  }),
  legalAddress: optionalText(300),
  plannedStoreName: optionalText(120),
  applicantNote: optionalText(SELLER_APPLICATION_RULES.applicantNoteMax),
}).strict().superRefine((data, context) => {
  if (data.sellerType === "REGISTERED_COMPANY" && !data.legalAddress) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["legalAddress"], message: SELLER_APPLICATION_MESSAGES.legalAddress });
  }
});
export type SellerApplicationInput = z.infer<typeof sellerApplicationInputSchema>;

/** First human-readable message of a failed parse, for the form. */
export function sellerApplicationIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return SELLER_APPLICATION_MESSAGES.invalid;
  if (issue.code === "unrecognized_keys") return SELLER_APPLICATION_MESSAGES.invalid;
  return issue.code === "custom" || issue.code === "too_small" ? issue.message : SELLER_APPLICATION_MESSAGES.invalid;
}

export const sellerApplicationReviewSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    confirmDuplicateVoen: z.boolean().optional().default(false),
    adminNote: optionalText(SELLER_APPLICATION_RULES.adminNoteMax),
  }).strict(),
  z.object({
    action: z.literal("reject"),
    reason: z.string().trim()
      .min(SELLER_APPLICATION_RULES.rejectionReasonMin, `Səbəb ən azı ${SELLER_APPLICATION_RULES.rejectionReasonMin} simvol olmalıdır.`)
      .max(SELLER_APPLICATION_RULES.rejectionReasonMax, `Səbəb ən çox ${SELLER_APPLICATION_RULES.rejectionReasonMax} simvol ola bilər.`),
    adminNote: optionalText(SELLER_APPLICATION_RULES.adminNoteMax),
  }).strict(),
]);
export type SellerApplicationReview = z.infer<typeof sellerApplicationReviewSchema>;

export type ApplicationHistoryItem = {
  status: SellerApplicationStatus;
  source: "SELF" | "ADMIN" | "LEGACY";
  createdAt: Date;
  reviewedAt: Date | null;
  withdrawnAt: Date | null;
};

export type ReapplyDecision =
  | { allowed: true }
  | { allowed: false; reason: "OPEN" | "APPROVED" }
  | { allowed: false; reason: "WAIT" | "LIMIT"; nextAllowedAt: Date };

/**
 * May this customer submit a new application now?
 *  - never while one is PENDING (the database enforces this too) or after an approval;
 *  - 24 hours after the last REJECTED or WITHDRAWN application;
 *  - at most 3 customer applications in any rolling 30 days.
 * When both waits apply, the later time is returned.
 */
export function reapplyDecision(history: ApplicationHistoryItem[], now: Date): ReapplyDecision {
  if (history.some((item) => item.status === "PENDING")) return { allowed: false, reason: "OPEN" };
  if (history.some((item) => item.status === "APPROVED")) return { allowed: false, reason: "APPROVED" };
  const blocks: { reason: "WAIT" | "LIMIT"; at: number }[] = [];

  const closedAt = history
    .map((item) => item.status === "REJECTED" ? item.reviewedAt : item.status === "WITHDRAWN" ? item.withdrawnAt : null)
    .filter((value): value is Date => value instanceof Date)
    .map((value) => value.getTime());
  if (closedAt.length) {
    const waitUntil = Math.max(...closedAt) + SELLER_APPLICATION_RULES.reapplyWaitMs;
    if (waitUntil > now.getTime()) blocks.push({ reason: "WAIT", at: waitUntil });
  }

  const windowStart = now.getTime() - SELLER_APPLICATION_RULES.windowMs;
  const recent = history
    .filter((item) => item.source === "SELF" && item.createdAt.getTime() > windowStart)
    .map((item) => item.createdAt.getTime())
    .sort((a, b) => a - b);
  if (recent.length >= SELLER_APPLICATION_RULES.maxPerWindow) {
    // Allowed again once only maxPerWindow - 1 applications remain inside the window.
    const oldestThatMustExpire = recent[recent.length - SELLER_APPLICATION_RULES.maxPerWindow];
    blocks.push({ reason: "LIMIT", at: oldestThatMustExpire + SELLER_APPLICATION_RULES.windowMs });
  }

  if (!blocks.length) return { allowed: true };
  const latest = blocks.reduce((a, b) => (b.at > a.at ? b : a));
  return { allowed: false, reason: latest.reason, nextAllowedAt: new Date(latest.at) };
}

export function reapplyMessage(decision: ReapplyDecision): string {
  if (decision.allowed) return "";
  if (decision.reason === "OPEN") return SELLER_APPLICATION_MESSAGES.open;
  if (decision.reason === "APPROVED") return SELLER_APPLICATION_MESSAGES.accountChanged;
  return decision.reason === "WAIT" ? SELLER_APPLICATION_MESSAGES.wait : SELLER_APPLICATION_MESSAGES.limit;
}

/** Only a PENDING application can be withdrawn, approved or rejected. */
export function isOpenApplication(status: SellerApplicationStatus): boolean {
  return status === "PENDING";
}
