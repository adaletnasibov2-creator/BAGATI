import { missingSellerLegalFields, type SellerLegalRequirement } from "@/lib/seller-legal-policy";

type StoreSubmissionState = {
  status: string;
  legalInfoApproved: boolean;
  adminManaged: boolean;
  hasSubscription: boolean;
  sellerType: string | null;
  legalName: string | null;
  voen: string | null;
  legalAddress: string | null;
};

export type StoreSubmissionResult =
  | { ok: true }
  | { ok: false; reason: "INVALID_STATUS" | "LEGAL_INFORMATION_INCOMPLETE" | "SUBSCRIPTION_REQUIRED"; missingFields: SellerLegalRequirement[] };

export function checkStoreSubmission(state: StoreSubmissionState): StoreSubmissionResult {
  const canSubmit = state.status === "DRAFT"
    || state.status === "REJECTED"
    || (state.status === "ACTIVE" && !state.legalInfoApproved);
  if (!canSubmit) return { ok: false, reason: "INVALID_STATUS", missingFields: [] };

  const missingFields = missingSellerLegalFields(state);
  if (missingFields.length) return { ok: false, reason: "LEGAL_INFORMATION_INCOMPLETE", missingFields };
  if (!state.adminManaged && !state.hasSubscription) {
    return { ok: false, reason: "SUBSCRIPTION_REQUIRED", missingFields: [] };
  }
  return { ok: true };
}
