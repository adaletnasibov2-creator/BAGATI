import type { LegalAcceptanceSource, LegalDocument } from "@prisma/client";
import { hasAcceptedCurrent, recordAcceptance, type LegalAcceptanceReader, type LegalAcceptanceWriter } from "@/lib/legal-acceptance";
import { LEGAL_VERSIONS } from "@/lib/legal-versions";

/**
 * Server-side gates for the legal texts (Phase B, release-output/consent-audit-report.md B6). The browser checkbox is
 * only a convenience: every gate below reads the database itself and never trusts a client flag on its own.
 * Existing users are only asked at checkout (customer terms) or in the seller panel (seller terms); browsing is never
 * blocked. No IP address or user agent is stored, and nobody gets an acceptance row they did not give.
 */

export const TERMS_REQUIRED = "TERMS_REQUIRED";
export const SELLER_TERMS_REQUIRED = "SELLER_TERMS_REQUIRED";

export const LEGAL_GATE_MESSAGES = {
  termsRequired: "Sifarişi tamamlamaq üçün İstifadəçi şərtləri və Məxfilik siyasəti ilə razılığınızı təsdiqləyin.",
  sellerTermsRequired: "Mağaza yaratmaq və məhsul yayımlamaq üçün əvvəlcə Satıcı şərtlərini qəbul edin.",
  registerTerms: "Davam etmək üçün İstifadəçi şərtləri və Məxfilik siyasəti ilə razılığınızı təsdiqləyin.",
  sellerApplicationTerms: "Müraciəti göndərmək üçün Satıcı şərtləri ilə razılığınızı təsdiqləyin.",
} as const;

/** A Prisma client (or a test double): reads directly, writes in its own short transaction. */
export type LegalGateDb = LegalAcceptanceReader & {
  $transaction<T>(fn: (tx: LegalAcceptanceWriter) => Promise<T>): Promise<T>;
};

export type LegalGateResult =
  | { ok: true; recorded: boolean }
  | { ok: false; status: 409; code: typeof TERMS_REQUIRED | typeof SELLER_TERMS_REQUIRED; error: string };

async function acceptInOwnTransaction(db: LegalGateDb, userId: string, document: LegalDocument, source: LegalAcceptanceSource) {
  const { created } = await db.$transaction((tx) => recordAcceptance(tx, { userId, document, source }));
  return created;
}

/**
 * Checkout: a customer who has not accepted the CURRENT customer terms must tick the box. Without it the order API
 * answers 409 TERMS_REQUIRED; with it the acceptance is recorded (source CHECKOUT) and the order continues.
 */
export async function customerTermsGate(db: LegalGateDb, userId: string, acceptTerms: boolean): Promise<LegalGateResult> {
  if (await hasAcceptedCurrent(db, userId, "CUSTOMER_TERMS")) return { ok: true, recorded: false };
  if (acceptTerms !== true) return { ok: false, status: 409, code: TERMS_REQUIRED, error: LEGAL_GATE_MESSAGES.termsRequired };
  return { ok: true, recorded: await acceptInOwnTransaction(db, userId, "CUSTOMER_TERMS", "CHECKOUT") };
}

/** Store creation and product publishing: 409 SELLER_TERMS_REQUIRED until the seller accepted the current version. */
export async function sellerTermsGate(db: LegalAcceptanceReader, userId: string): Promise<LegalGateResult> {
  if (await hasAcceptedCurrent(db, userId, "SELLER_TERMS")) return { ok: true, recorded: false };
  return { ok: false, status: 409, code: SELLER_TERMS_REQUIRED, error: LEGAL_GATE_MESSAGES.sellerTermsRequired };
}

/** The seller panel card (POST /api/vendor/legal-acceptance): records SELLER_PANEL; a repeat records nothing. */
export async function acceptSellerTermsInPanel(db: LegalGateDb, userId: string): Promise<{ created: boolean; version: string }> {
  return { created: await acceptInOwnTransaction(db, userId, "SELLER_TERMS", "SELLER_PANEL"), version: LEGAL_VERSIONS.SELLER_TERMS };
}

/** Admin labels (read-only views). */
export const LEGAL_DOCUMENT_LABELS: Record<LegalDocument, string> = {
  CUSTOMER_TERMS: "İstifadə şərtləri",
  SELLER_TERMS: "Satıcı şərtləri",
};

export const LEGAL_SOURCE_LABELS: Record<LegalAcceptanceSource, string> = {
  REGISTER_EMAIL: "Qeydiyyat (e-poçt)",
  REGISTER_GOOGLE: "Qeydiyyat (Google)",
  CHECKOUT: "Sifariş",
  SELLER_APPLICATION: "Satıcı müraciəti",
  SELLER_PANEL: "Satıcı paneli",
};
