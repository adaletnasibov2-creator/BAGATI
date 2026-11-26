/**
 * Versions of the legal texts a user accepts (owner decision 2026-11-18: the version is the publish date).
 * A LegalAcceptance row records the version that was current when the user accepted (lib/legal-acceptance.ts).
 *
 * Bump the date whenever the visible text of the page changes:
 *   CUSTOMER_TERMS -> app/(customer)/terms/page.tsx
 *   SELLER_TERMS   -> app/(customer)/seller-terms/page.tsx
 * scripts/legal-versions.test.ts pins a hash of each page's text to its version, so a text change without a new
 * version fails the test. After a bump, users are asked to accept again (Phase B gates).
 */
// 2026-11-26 (ABOUT-OWNER-INFO-2, owner decision): the operator sentence moved from the first to the last paragraph and
// the "Son yenilənmə" date changed on both pages; previous versions were CUSTOMER_TERMS 2026-11-17, SELLER_TERMS 2026-11-18.
export const LEGAL_VERSIONS = {
  CUSTOMER_TERMS: "2026-11-26",
  SELLER_TERMS: "2026-11-26",
} as const;

export type LegalDocumentKey = keyof typeof LEGAL_VERSIONS;

export const LEGAL_DOCUMENT_KEYS = Object.keys(LEGAL_VERSIONS) as LegalDocumentKey[];
