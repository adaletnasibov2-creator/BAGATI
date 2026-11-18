import type { LegalAcceptanceSource, LegalDocument } from "@prisma/client";
import { LEGAL_VERSIONS } from "@/lib/legal-versions";

/**
 * Recorded acceptance of the legal texts (owner decisions 2026-11-18, release-output/consent-audit-report.md B5):
 * one LegalAcceptance row per user, document and version; no IP address or user agent; no backfill.
 * Phase A: no callers outside tests. Phase B calls recordAcceptance inside the registration, checkout and seller
 * application transactions, and hasAcceptedCurrent in the checkout and seller-panel gates.
 */

export const LEGAL_TERMS_ACCEPTED = "LEGAL_TERMS_ACCEPTED";

/** The two calls this module needs; a Prisma client or transaction client satisfies it. */
export type LegalAcceptanceReader = {
  legalAcceptance: {
    findUnique(args: {
      where: { userId_document_version: { userId: string; document: LegalDocument; version: string } };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
};

export type LegalAcceptanceWriter = {
  legalAcceptance: LegalAcceptanceReader["legalAcceptance"] & {
    createMany(args: {
      data: { userId: string; document: LegalDocument; version: string; source: LegalAcceptanceSource; vendorApplicationId: string | null }[];
      skipDuplicates: true;
    }): Promise<{ count: number }>;
  };
  auditLog: {
    create(args: {
      data: { actorId: string; action: string; entityType: string; entityId: string; metadata: { document: LegalDocument; version: string; source: LegalAcceptanceSource } };
    }): Promise<unknown>;
  };
};

export type RecordAcceptanceInput = {
  userId: string;
  document: LegalDocument;
  source: LegalAcceptanceSource;
  /** Only for SELLER_TERMS accepted with a seller application. */
  vendorApplicationId?: string | null;
};

export function currentLegalVersion(document: LegalDocument): string {
  return LEGAL_VERSIONS[document];
}

/** True when the user has accepted the CURRENT version of the document (an older version does not count). */
export async function hasAcceptedCurrent(db: LegalAcceptanceReader, userId: string, document: LegalDocument): Promise<boolean> {
  if (!userId) return false;
  const row = await db.legalAcceptance.findUnique({
    where: { userId_document_version: { userId, document, version: currentLegalVersion(document) } },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Records that the user accepted the current version of the document. Call it inside the transaction of the action
 * the acceptance belongs to. Idempotent: a repeat acceptance of the same version inserts nothing (ON CONFLICT DO
 * NOTHING on the unique userId+document+version) and writes no audit row. A new row writes exactly one AuditLog row
 * LEGAL_TERMS_ACCEPTED with document, version and source only (no personal data).
 */
export async function recordAcceptance(tx: LegalAcceptanceWriter, input: RecordAcceptanceInput): Promise<{ created: boolean; version: string }> {
  if (!input.userId) throw new Error("recordAcceptance: userId is required");
  if (input.vendorApplicationId && input.document !== "SELLER_TERMS") {
    throw new Error("recordAcceptance: vendorApplicationId belongs to SELLER_TERMS only");
  }
  const version = currentLegalVersion(input.document);
  const inserted = await tx.legalAcceptance.createMany({
    data: [{ userId: input.userId, document: input.document, version, source: input.source, vendorApplicationId: input.vendorApplicationId ?? null }],
    skipDuplicates: true,
  });
  const created = inserted.count === 1;
  if (created) {
    // createMany returns no id: read the new row by its unique key in the same transaction.
    const row = await tx.legalAcceptance.findUnique({
      where: { userId_document_version: { userId: input.userId, document: input.document, version } },
      select: { id: true },
    });
    if (!row) throw new Error("recordAcceptance: the inserted row was not found");
    await tx.auditLog.create({
      data: {
        actorId: input.userId,
        action: LEGAL_TERMS_ACCEPTED,
        entityType: "LegalAcceptance",
        entityId: row.id,
        metadata: { document: input.document, version, source: input.source },
      },
    });
  }
  return { created, version };
}
