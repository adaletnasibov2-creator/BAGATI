import { z } from "zod";

/**
 * Azerbaijani phone numbers. E.164 form is +994 followed by a 9-digit national number (NSN).
 * Accepted inputs (spaces, dashes, dots and brackets are ignored):
 *   055 761 43 32 · 55 761 43 32 · +994 55 761 43 32 · 994 55 761 43 32 · 00994 55 761 43 32
 */

/** Mobile operator codes (WhatsApp-capable). */
const MOBILE_CODES = new Set(["10", "50", "51", "55", "60", "70", "77", "99"]);
/** Fixed-line area codes: Baku 12, Absheron 18, regions 2x, Nakhchivan 36. */
const FIXED_LINE_PATTERN = /^(12|18|2\d|36)\d{7}$/;
/** Digits, one leading plus, and separators: space, no-break space, dash, dot, brackets. Tabs and line breaks inside the number are rejected. */
const ALLOWED_INPUT = /^\+?[\d ().\- ]+$/;

export type AzPhone = {
  /** +994XXXXXXXXX */
  e164: string;
  /** 994XXXXXXXXX, for wa.me */
  digits: string;
  /** +994 55 761 43 32 */
  display: string;
  mobile: boolean;
};

export function normalizeAzPhone(input: string | null | undefined): AzPhone | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 40) return null;
  if (!ALLOWED_INPUT.test(trimmed)) return null;
  let digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    if (!digits.startsWith("994")) return null;
    digits = digits.slice(3);
  } else if (digits.startsWith("00994")) {
    digits = digits.slice(5);
  } else if (digits.startsWith("994") && digits.length === 12) {
    digits = digits.slice(3);
  } else if (digits.startsWith("0") && digits.length === 10) {
    digits = digits.slice(1);
  }
  if (!/^\d{9}$/.test(digits)) return null;
  const mobile = MOBILE_CODES.has(digits.slice(0, 2));
  if (!mobile && !FIXED_LINE_PATTERN.test(digits)) return null;
  return {
    e164: `+994${digits}`,
    digits: `994${digits}`,
    display: `+994 ${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 7)} ${digits.slice(7, 9)}`,
    mobile,
  };
}

/** wa.me link with a prefilled Azerbaijani greeting that names the store. Null unless the number is a valid mobile number. */
export function buildWhatsAppUrl(phone: string | null | undefined, storeName: string): string | null {
  const normalized = normalizeAzPhone(phone);
  if (!normalized?.mobile) return null;
  const name = storeName.replace(/\s+/g, " ").trim().slice(0, 120);
  const text = `Salam! BAGATI-dakı “${name}” mağazanız haqqında yazıram.`;
  return `https://wa.me/${normalized.digits}?text=${encodeURIComponent(text)}`;
}

export function buildTelHref(phone: string | null | undefined): string | null {
  const normalized = normalizeAzPhone(phone);
  return normalized ? `tel:${normalized.e164}` : null;
}

export const AZ_PHONE_ERROR = "Telefon nömrəsini Azərbaycan formatında yazın, məsələn +994 55 123 45 67 və ya 055 123 45 67.";

/**
 * Save-time schema for optional store phone fields. Empty values become null; anything else must
 * normalize, and is stored in E.164 form (+994XXXXXXXXX).
 */
export const optionalAzPhoneSchema = z.union([z.string(), z.null()]).transform((value, context) => {
  if (value === null || !value.trim()) return null;
  const normalized = normalizeAzPhone(value);
  if (!normalized) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: AZ_PHONE_ERROR });
    return z.NEVER;
  }
  return normalized.e164;
});

/** The Azerbaijani phone message when a parse failed on a contactPhone field, otherwise null. */
export function contactPhoneIssue(error: z.ZodError): string | null {
  return error.issues.some((issue) => issue.path.includes("contactPhone")) ? AZ_PHONE_ERROR : null;
}
