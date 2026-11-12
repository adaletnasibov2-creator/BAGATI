import { createHmac } from "node:crypto";
import { z } from "zod";
import { AZ_PHONE_ERROR, normalizeAzPhone } from "@/lib/az-phone";

/** Buyer-to-store messages from the public store page. The store's email address is never exposed to the buyer. */

export const INQUIRY_LIMITS = {
  nameMin: 2,
  nameMax: 80,
  messageMin: 10,
  messageMax: 2000,
  emailMax: 254,
  /** Request body cap for the public endpoint. */
  bodyBytes: 8 * 1024,
} as const;

/** Per client IP (only when the trusted proxy IP header is enabled). */
export const INQUIRY_IP_RATE_LIMIT = { limit: 5, windowMs: 60 * 60 * 1000 } as const;
/** Per store, whatever the sender. */
export const INQUIRY_STORE_RATE_LIMIT = { limit: 30, windowMs: 60 * 60 * 1000 } as const;
/** Whole process, per minute (protects the database when the IP is unknown). */
export const INQUIRY_PROCESS_RATE_LIMIT = { limit: 60, windowMs: 60 * 1000 } as const;

export const INQUIRY_MESSAGES = {
  name: "Adınızı yazın (2–80 simvol).",
  message: "Mesajı yazın (10–2000 simvol).",
  email: "E-poçt ünvanını düzgün yazın.",
  contactRequired: "Sizə cavab verə bilməyimiz üçün e-poçt və ya telefon nömrəsi yazın.",
  consent: "Mesajın mağazaya göndərilməsinə razılıq verin.",
  invalid: "Mesaj məlumatlarını yoxlayın.",
  rateLimited: "Çox sayda mesaj göndərildi. Bir az sonra yenidən cəhd edin.",
  storeUnavailable: "Bu mağazaya hazırda mesaj göndərmək mümkün deyil.",
  sent: "Mesajınız mağazaya göndərildi. Satıcı sizinlə qeyd etdiyiniz əlaqə vasitəsi ilə əlaqə saxlayacaq.",
  unavailable: "Mesaj xidməti hazırda əlçatan deyil. Bir az sonra yenidən cəhd edin.",
} as const;

// No control characters at all in single-line fields (blocks header injection via CR/LF).
const SINGLE_LINE = /^[^\u0000-\u001F\u007F]*$/;
// Messages may contain line breaks and tabs, but no other control characters.
const MULTI_LINE = /^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]*$/;

const optionalText = z.union([z.string(), z.null(), z.undefined()]).transform((value) => (typeof value === "string" ? value.trim() : ""));

export const storeInquirySchema = z.object({
  name: z.string({ invalid_type_error: INQUIRY_MESSAGES.name, required_error: INQUIRY_MESSAGES.name })
    .trim().min(INQUIRY_LIMITS.nameMin, INQUIRY_MESSAGES.name).max(INQUIRY_LIMITS.nameMax, INQUIRY_MESSAGES.name)
    .regex(SINGLE_LINE, INQUIRY_MESSAGES.name),
  contactEmail: optionalText.pipe(z.union([
    z.literal(""),
    z.string().max(INQUIRY_LIMITS.emailMax, INQUIRY_MESSAGES.email).email(INQUIRY_MESSAGES.email).regex(SINGLE_LINE, INQUIRY_MESSAGES.email),
  ])),
  contactPhone: optionalText,
  message: z.string({ invalid_type_error: INQUIRY_MESSAGES.message, required_error: INQUIRY_MESSAGES.message })
    .trim().min(INQUIRY_LIMITS.messageMin, INQUIRY_MESSAGES.message).max(INQUIRY_LIMITS.messageMax, INQUIRY_MESSAGES.message)
    .regex(MULTI_LINE, INQUIRY_MESSAGES.message),
  /** Honeypot. Real visitors never see or fill it. */
  website: z.string().max(500).optional().default(""),
  consent: z.literal(true, { errorMap: () => ({ message: INQUIRY_MESSAGES.consent }) }),
}).strict().transform((value, context) => {
  let phone: string | null = null;
  if (value.contactPhone) {
    const normalized = normalizeAzPhone(value.contactPhone);
    if (!normalized) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["contactPhone"], message: AZ_PHONE_ERROR });
      return z.NEVER;
    }
    phone = normalized.e164;
  }
  const email = value.contactEmail ? value.contactEmail.toLowerCase() : null;
  if (!email && !phone) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["contactEmail"], message: INQUIRY_MESSAGES.contactRequired });
    return z.NEVER;
  }
  return {
    name: value.name.replace(/\s+/g, " "),
    contactEmail: email,
    contactPhone: phone,
    // Normalize line endings and collapse runs of blank lines. The text is stored as plain text; every output escapes it.
    message: value.message.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n"),
    honeypotFilled: value.website.trim().length > 0,
  };
});

export type StoreInquiryInput = z.output<typeof storeInquirySchema>;

/** First user-facing message for a failed parse. */
export function inquiryIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message || INQUIRY_MESSAGES.invalid;
}

function inquirySecret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");
  return value;
}

/** HMAC of the client IP. Raw IPs are never stored (same keyed-hash convention as lib/auth-rate-limit.ts). */
export function hashInquiryIp(ip: string): string {
  return createHmac("sha256", inquirySecret()).update(`BAGATI_STORE_INQUIRY_IP_V1:${ip.trim().toLowerCase()}`).digest("hex");
}
