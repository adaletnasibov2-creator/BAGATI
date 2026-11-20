/**
 * Inline errors for the /vendor/apply form (DESIGN-T8). Pure and client-safe: it runs the SAME zod schema the API
 * route uses (sellerApplicationInputSchema), so the browser never has its own copy of the rules. The server checks
 * again on submit; nothing here decides what is required.
 */
import type { z } from "zod";
import { SELLER_APPLICATION_MESSAGES, sellerApplicationInputSchema } from "@/lib/seller-application";

/** Form fields in the order they appear on the page (the first invalid one gets focus). */
export const SELLER_APPLICATION_FIELDS = ["sellerType", "displayName", "legalName", "voen", "phone", "legalAddress", "plannedStoreName", "applicantNote", "acceptSellerTerms"] as const;
export type SellerApplicationField = (typeof SELLER_APPLICATION_FIELDS)[number];
export type SellerApplicationFieldErrors = Partial<Record<SellerApplicationField, string>>;

/** One message per field: the schema's own Azerbaijani message, or the generic "Məlumatları yoxlayın." */
export function sellerApplicationFieldErrorsFrom(error: z.ZodError): SellerApplicationFieldErrors {
  const errors: SellerApplicationFieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field !== "string" || !(SELLER_APPLICATION_FIELDS as readonly string[]).includes(field)) continue;
    const key = field as SellerApplicationField;
    if (errors[key]) continue;
    errors[key] = key === "acceptSellerTerms"
      ? SELLER_APPLICATION_MESSAGES.sellerTerms
      : issue.code === "custom" || issue.code === "too_small" ? issue.message : SELLER_APPLICATION_MESSAGES.invalid;
  }
  return errors;
}

/** Checks the values with the server schema; an empty object means the server would accept the format. */
export function sellerApplicationFieldErrors(values: Record<string, unknown>): SellerApplicationFieldErrors {
  const parsed = sellerApplicationInputSchema.safeParse(values);
  return parsed.success ? {} : sellerApplicationFieldErrorsFrom(parsed.error);
}

/** The first field (in page order) that has an error, for focus. */
export function firstInvalidField(errors: SellerApplicationFieldErrors): SellerApplicationField | null {
  return SELLER_APPLICATION_FIELDS.find((field) => errors[field]) ?? null;
}
