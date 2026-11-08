import {
  getProductPublicationBlockers,
  getStorePublicationBlockers,
  type DraftProductCandidate,
  type StorePublicationState,
} from "@/lib/admin-store-product-publishing";
import { planEntitlements, resolveStoreEntitlements, type EntitlementPlan } from "@/lib/subscription-entitlements";

export type VendorProductActivationResult =
  | { ok: true; plan: EntitlementPlan }
  | { ok: false; reason: "STORE_NOT_ELIGIBLE"; blockers: string[] }
  | { ok: false; reason: "PRODUCT_NOT_READY"; blockers: string[] }
  | { ok: false; reason: "PRODUCT_LIMIT_REACHED"; plan: EntitlementPlan; current: number; limit: number };

export function isVendorProductActivation(currentStatus: string, nextStatus: string | undefined): boolean {
  return nextStatus === "ACTIVE" && currentStatus !== "ACTIVE";
}

export function checkVendorProductActivation(input: {
  store: StorePublicationState;
  product: DraftProductCandidate;
  activeProductCount: number;
  now?: Date;
}): VendorProductActivationResult {
  const now = input.now ?? new Date();
  const storeBlockers = getStorePublicationBlockers(input.store, now);
  if (storeBlockers.length) return { ok: false, reason: "STORE_NOT_ELIGIBLE", blockers: storeBlockers };

  const productBlockers = getProductPublicationBlockers(input.product);
  if (productBlockers.length) return { ok: false, reason: "PRODUCT_NOT_READY", blockers: productBlockers };

  const entitlement = resolveStoreEntitlements({
    adminManaged: input.store.adminManaged,
    storeStatus: input.store.status,
    storeActive: input.store.isActive,
    vendorActive: input.store.vendorActive,
    cityActive: input.store.cityActive,
    subscriptionStatus: input.store.subscriptionStatus,
    planSlug: input.store.planSlug,
    planActive: input.store.planActive,
    periodStart: input.store.periodStart,
    periodEnd: input.store.periodEnd,
  }, now);
  if (!entitlement.eligible || !entitlement.plan) {
    return { ok: false, reason: "STORE_NOT_ELIGIBLE", blockers: ["Mağaza satış üçün uyğun deyil."] };
  }

  const limit = planEntitlements[entitlement.plan].activeProducts;
  if (input.activeProductCount >= limit) {
    return { ok: false, reason: "PRODUCT_LIMIT_REACHED", plan: entitlement.plan, current: input.activeProductCount, limit };
  }
  return { ok: true, plan: entitlement.plan };
}
