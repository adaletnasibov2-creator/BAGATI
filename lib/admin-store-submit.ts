import { sellerRequirementLabels } from "@/lib/seller-legal-policy";
import { checkStoreSubmission } from "@/lib/store-submission";

/**
 * ADMIN-3-ONBOARD-1: the admin sends a DRAFT store for review (e.g. a store created at /admin/stores/new, which the
 * admin could not move forward before: approval accepts only PENDING_REVIEW / ACTIVE, lib/store-review.ts).
 * Same checks as the seller's "Yoxlamaya göndər" (lib/store-submission.ts checkStoreSubmission: status + the seller
 * type's legal fields; no shortcut), and the same messages as the seller route (app/api/vendor/[storeId]/[section]).
 * Only DRAFT. Idempotent: a store already waiting for review is a success without a second change or audit row.
 * The status change and its audit row (STORE_SUBMIT_FOR_REVIEW) are written in one transaction.
 * Selling, approval and entitlement rules are unchanged: this only moves DRAFT -> PENDING_REVIEW.
 */
export const ADMIN_STORE_SUBMIT_AUDIT = "STORE_SUBMIT_FOR_REVIEW";

/** Existing wording (seller route and seller panel), reused. */
export const STORE_SUBMIT_TEXT = {
  done: "Mağaza admin yoxlamasına göndərildi.",
  invalidStatus: "Bu statusda mağazanı yoxlamaya göndərmək mümkün deyil.",
  notFound: "Mağaza tapılmadı",
  legalPrefix: "Yoxlamaya göndərməzdən əvvəl hüquqi məlumatları tamamlayın: ",
} as const;

type StoreRow = {
  id: string; status: string; isActive: boolean; legalInfoApproved: boolean; adminManaged: boolean;
  subscription: { id: string } | null;
  vendor: { sellerType: string | null; legalName: string | null; voen: string | null; legalAddress: string | null };
};
export type AdminStoreSubmitTx = {
  $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  store: {
    findUnique(args: unknown): Promise<StoreRow | null>;
    updateMany(args: { where: { id: string; status: "DRAFT" }; data: { status: "PENDING_REVIEW" } }): Promise<{ count: number }>;
  };
  auditLog: { create(args: { data: { actorId: string; action: string; entityType: string; entityId: string; metadata: Record<string, unknown> } }): Promise<unknown> };
};
export type AdminStoreSubmitDb = { $transaction<T>(run: (tx: AdminStoreSubmitTx) => Promise<T>): Promise<T> };

export type AdminStoreSubmitResult =
  | { ok: true; status: "PENDING_REVIEW"; changed: boolean; message: string }
  | { ok: false; httpStatus: 404 | 409 | 422; error: string; missingFields?: string[] };

export function submitStoreForReviewAsAdmin(db: AdminStoreSubmitDb, input: { storeId: string; adminId: string }): Promise<AdminStoreSubmitResult> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Store" WHERE "id" = ${input.storeId} FOR UPDATE`;
    const store = await tx.store.findUnique({
      where: { id: input.storeId },
      select: { id: true, status: true, isActive: true, legalInfoApproved: true, adminManaged: true, subscription: { select: { id: true } }, vendor: { select: { sellerType: true, legalName: true, voen: true, legalAddress: true } } },
    });
    if (!store) return { ok: false, httpStatus: 404, error: STORE_SUBMIT_TEXT.notFound };
    // Idempotent: already sent (by the seller or a previous click) -> nothing to do.
    if (store.status === "PENDING_REVIEW") return { ok: true, status: "PENDING_REVIEW", changed: false, message: STORE_SUBMIT_TEXT.done };
    // Admin action is only for drafts; REJECTED / ACTIVE stores go through the seller or the existing review actions.
    if (store.status !== "DRAFT") return { ok: false, httpStatus: 409, error: STORE_SUBMIT_TEXT.invalidStatus };
    const submission = checkStoreSubmission({
      status: store.status,
      legalInfoApproved: store.legalInfoApproved,
      adminManaged: store.adminManaged,
      hasSubscription: Boolean(store.subscription),
      sellerType: store.vendor.sellerType,
      legalName: store.vendor.legalName,
      voen: store.vendor.voen,
      legalAddress: store.vendor.legalAddress,
    });
    if (!submission.ok) {
      if (submission.reason === "LEGAL_INFORMATION_INCOMPLETE") {
        return { ok: false, httpStatus: 422, error: `${STORE_SUBMIT_TEXT.legalPrefix}${submission.missingFields.map((field) => sellerRequirementLabels[field]).join(", ")}.`, missingFields: submission.missingFields };
      }
      return { ok: false, httpStatus: 409, error: STORE_SUBMIT_TEXT.invalidStatus };
    }
    const changed = await tx.store.updateMany({ where: { id: store.id, status: "DRAFT" }, data: { status: "PENDING_REVIEW" } });
    if (changed.count !== 1) return { ok: false, httpStatus: 409, error: STORE_SUBMIT_TEXT.invalidStatus };
    await tx.auditLog.create({ data: { actorId: input.adminId, action: ADMIN_STORE_SUBMIT_AUDIT, entityType: "Store", entityId: store.id, metadata: { previousStatus: "DRAFT", nextStatus: "PENDING_REVIEW", adminManaged: store.adminManaged, isActive: store.isActive } } });
    return { ok: true, status: "PENDING_REVIEW", changed: true, message: STORE_SUBMIT_TEXT.done };
  });
}
