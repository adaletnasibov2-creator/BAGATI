export type StoreReviewAction = "approve" | "reject" | "suspend" | "reactivate";
export type StoreReviewStatus = "DRAFT" | "PENDING_REVIEW" | "ACTIVE" | "SUSPENDED" | "REJECTED";
export type StoreReviewResult =
  | { ok: true; update: { status: StoreReviewStatus; isActive: boolean; reviewNote: string | null; legalInfoApproved: boolean }; auditAction: string }
  | { ok: false; error: "LEGAL_INFORMATION_INCOMPLETE" | "INVALID_STATUS" | "REASON_REQUIRED" };

export function getStoreReviewUpdate(action: StoreReviewAction, status: StoreReviewStatus, legalComplete: boolean, reason?: string): StoreReviewResult {
  const note = reason?.trim() || null;
  if ((action === "approve" || action === "reactivate") && !legalComplete) return { ok: false, error: "LEGAL_INFORMATION_INCOMPLETE" };
  if ((action === "reject" || action === "suspend") && !note) return { ok: false, error: "REASON_REQUIRED" };

  if (action === "approve" && (status === "PENDING_REVIEW" || status === "ACTIVE")) {
    return { ok: true, update: { status: "ACTIVE", isActive: true, reviewNote: null, legalInfoApproved: true }, auditAction: "STORE_APPROVE" };
  }
  if (action === "reject" && status === "PENDING_REVIEW") {
    return { ok: true, update: { status: "REJECTED", isActive: false, reviewNote: note, legalInfoApproved: false }, auditAction: "STORE_REJECT" };
  }
  if (action === "suspend" && (status === "ACTIVE" || status === "PENDING_REVIEW")) {
    return { ok: true, update: { status: "SUSPENDED", isActive: false, reviewNote: note, legalInfoApproved: false }, auditAction: "STORE_SUSPEND" };
  }
  if (action === "reactivate" && status === "SUSPENDED") {
    return { ok: true, update: { status: "ACTIVE", isActive: true, reviewNote: null, legalInfoApproved: true }, auditAction: "STORE_REACTIVATE" };
  }
  return { ok: false, error: "INVALID_STATUS" };
}
