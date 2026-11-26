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
  // "SUBSCRIPTION_REQUIRED" is no longer returned (PILOT-FREE-ONBOARDING-1); kept in the type so the existing route
  // handling still compiles.
  | { ok: false; reason: "INVALID_STATUS" | "LEGAL_INFORMATION_INCOMPLETE" | "SUBSCRIPTION_REQUIRED"; missingFields: SellerLegalRequirement[] };

/**
 * May the seller send the store for admin review? Status and legal fields only.
 * PILOT-FREE-ONBOARDING-1: a plan is no longer required to submit. Selling is still gated at approval and in public
 * visibility by the entitlement rule (free grant, paid ACTIVE subscription, or admin-managed), so submitting without a
 * plan cannot make a store sellable (lib/admin-store-product-publishing.ts getStorePublicationBlockers).
 * `adminManaged` / `hasSubscription` stay in the input for the existing caller; they no longer change the result.
 */
export function checkStoreSubmission(state: StoreSubmissionState): StoreSubmissionResult {
  const canSubmit = state.status === "DRAFT"
    || state.status === "REJECTED"
    || (state.status === "ACTIVE" && !state.legalInfoApproved);
  if (!canSubmit) return { ok: false, reason: "INVALID_STATUS", missingFields: [] };

  const missingFields = missingSellerLegalFields(state);
  if (missingFields.length) return { ok: false, reason: "LEGAL_INFORMATION_INCOMPLETE", missingFields };
  return { ok: true };
}
