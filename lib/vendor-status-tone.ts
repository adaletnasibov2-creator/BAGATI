import type { BadgeTone } from "@/components/ui/badge";

/**
 * Badge tones for the statuses shown in the seller panel (SELLER-DESIGN-1). Only the colour comes from here; the
 * text is still the existing Azerbaijani label, so colour is never the only signal.
 * gold = needs the seller's attention, primary = done / good, danger = stopped, neutral = in progress or unknown.
 */
export function orderStatusTone(status: string): BadgeTone {
  if (status === "NEW" || status === "PENDING") return "gold";
  if (status === "DELIVERED") return "primary";
  if (status === "CANCELLED" || status === "RETURNED") return "danger";
  return "neutral";
}

export function storeStatusTone(status: string, isActive?: boolean): BadgeTone {
  if (status === "ACTIVE") return isActive === false ? "gold" : "primary";
  if (status === "PENDING_REVIEW") return "gold";
  if (status === "SUSPENDED" || status === "REJECTED") return "danger";
  return "neutral";
}

export function subscriptionStatusTone(status: string | null | undefined): BadgeTone {
  if (status === "ACTIVE") return "primary";
  if (status === "PENDING" || status === "PAST_DUE") return "gold";
  if (status === "SUSPENDED" || status === "CANCELLED" || status === "EXPIRED") return "danger";
  return "neutral";
}

export function productStatusTone(status: string): BadgeTone {
  if (status === "ACTIVE") return "primary";
  if (status === "DRAFT") return "gold";
  return "neutral";
}

/** The setup block's approval tone (lib/vendor-store-setup.ts) mapped onto the Badge tones. */
export function approvalTone(tone: "neutral" | "pending" | "success" | "danger"): BadgeTone {
  return tone === "success" ? "primary" : tone === "pending" ? "gold" : tone;
}

export function returnStatusTone(status: string): BadgeTone {
  if (status === "REQUESTED") return "gold";
  if (status === "REFUNDED" || status === "EXCHANGED") return "primary";
  if (status === "REJECTED" || status === "CANCELLED") return "danger";
  return "neutral";
}

export function paymentStatusTone(status: string | null | undefined): BadgeTone {
  if (status === "PAID") return "primary";
  if (status === "FAILED") return "danger";
  return "gold";
}

/** Seller application on /vendor/apply (DESIGN-T8): waiting for the admin = gold, approved = primary, rejected = danger. */
export function sellerApplicationTone(status: string): BadgeTone {
  if (status === "PENDING") return "gold";
  if (status === "APPROVED") return "primary";
  if (status === "REJECTED") return "danger";
  return "neutral";
}
