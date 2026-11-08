import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveSubscriptionPlanSlug, type EntitlementPlan } from "@/lib/subscription-plans";

export type { EntitlementPlan } from "@/lib/subscription-plans";

export const subscriptionFeatures = [
  "BULK_IMPORT", "ADVANCED_ANALYTICS", "REPORT_EXPORT", "STAFF_ACCOUNTS",
  "ADVANCED_CAMPAIGNS", "STOREFRONT_CUSTOMIZATION", "API_ACCESS",
  "POS_INTEGRATION", "ERP_INTEGRATION", "PRIORITY_SUPPORT", "PRO_BADGE",
] as const;
export type SubscriptionFeature = (typeof subscriptionFeatures)[number];

export const planEntitlements: Record<EntitlementPlan, {
  activeProducts: number; activeVariants: number; staffAccounts: number;
  features: ReadonlySet<SubscriptionFeature>;
}> = {
  BASIC: { activeProducts: 300, activeVariants: 1_000, staffAccounts: 0, features: new Set(["BULK_IMPORT"]) },
  PRO: { activeProducts: 2_000, activeVariants: 10_000, staffAccounts: 5, features: new Set(subscriptionFeatures) },
};

export type StoreEntitlementState = {
  adminManaged: boolean;
  storeStatus: string;
  storeActive: boolean;
  vendorActive: boolean;
  cityActive: boolean;
  subscriptionStatus: string | null;
  planSlug: string | null;
  planActive: boolean;
  periodStart?: Date | null;
  periodEnd: Date | null;
};

export function resolveStoreEntitlements(state: StoreEntitlementState, now = new Date()) {
  const plan = resolveSubscriptionPlanSlug(state.planSlug);
  const baseEligible = state.storeActive && state.storeStatus === "ACTIVE" && state.vendorActive && state.cityActive;
  const subscriptionEligible = state.subscriptionStatus === "ACTIVE" && state.planActive && Boolean(plan)
    && (!state.periodStart || state.periodStart <= now) && (!state.periodEnd || state.periodEnd > now);
  const eligible = baseEligible && (state.adminManaged || subscriptionEligible);
  const resolvedPlan = eligible ? subscriptionEligible ? plan : state.adminManaged ? "BASIC" : null : null;
  return { eligible, plan: resolvedPlan, limits: resolvedPlan ? planEntitlements[resolvedPlan] : null };
}

export function isProBadgeEligible(state: StoreEntitlementState, now = new Date()) {
  return resolveStoreEntitlements(state, now).plan === "PRO";
}

export async function getStoreEntitlements(storeId: string, client: any = prisma, now = new Date()) {
  const store = await client.store.findUnique({
    where: { id: storeId },
    select: { id: true, status: true, isActive: true, adminManaged: true, city: { select: { isActive: true } }, vendor: { select: { user: { select: { isActive: true } } } }, subscription: { select: { status: true, currentPeriodStart: true, currentPeriodEnd: true, plan: { select: { slug: true, isActive: true } } } } },
  });
  if (!store) return { exists: false as const, eligible: false, plan: null, limits: null };
  const resolved = resolveStoreEntitlements({
    adminManaged: store.adminManaged,
    storeStatus: store.status, storeActive: store.isActive, cityActive: store.city.isActive,
    vendorActive: store.vendor.user.isActive, subscriptionStatus: store.subscription?.status ?? null,
    planSlug: store.subscription?.plan.slug ?? null, planActive: store.subscription?.plan.isActive ?? false,
    periodStart: store.subscription?.currentPeriodStart ?? null,
    periodEnd: store.subscription?.currentPeriodEnd ?? null,
  }, now);
  return { exists: true as const, ...resolved };
}

export class EntitlementError extends Error {
  constructor(readonly code: string, readonly plan: EntitlementPlan | null, readonly current?: number, readonly limit?: number) {
    super(code);
    this.name = "EntitlementError";
  }
}

export function exceedsEntitlementLimit(current: number, addition: number, limit: number) {
  return current + addition > limit;
}

export function exceedsVariantLimit(currentStoreActive: number, currentProductActive: number, incomingProductActive: number, limit: number) {
  return exceedsEntitlementLimit(currentStoreActive - currentProductActive, incomingProductActive, limit);
}

export function entitlementErrorResponse(error: EntitlementError) {
  const messages: Record<string, string> = {
    SUBSCRIPTION_REQUIRED: "Bu əməliyyat üçün aktiv mağaza və abunəlik tələb olunur.",
    BULK_IMPORT_PRO_ONLY: "Toplu məhsul idxalı yalnız PRO paketində mövcuddur.",
    ADVANCED_ANALYTICS_PRO_ONLY: "Ətraflı analitika yalnız PRO paketində mövcuddur.",
    REPORT_EXPORT_PRO_ONLY: "Hesabat ixracı yalnız PRO paketində mövcuddur.",
    PRODUCT_LIMIT_REACHED: error.plan === "PRO" ? "PRO paketində maksimum 2 000 aktiv məhsul yerləşdirə bilərsiniz." : "BASIC paketində maksimum 300 aktiv məhsul yerləşdirə bilərsiniz. Daha çox məhsul üçün PRO paketinə keçin.",
    VARIANT_LIMIT_REACHED: error.plan === "PRO" ? "PRO paketində maksimum 10 000 aktiv variant mümkündür." : "BASIC paketində maksimum 1 000 aktiv variant mümkündür. Daha çox variant üçün PRO paketinə keçin.",
  };
  const status = error.code === "SUBSCRIPTION_REQUIRED" ? 409 : 403;
  return Response.json({ error: messages[error.code] ?? "Abunəlik imkanları bu əməliyyata icazə vermir.", code: error.code, ...(error.current !== undefined ? { current: error.current } : {}), ...(error.limit !== undefined ? { limit: error.limit } : {}), plan: error.plan, upgradeTarget: error.plan === "BASIC" ? "PRO" : null, subscriptionUrl: "/vendor/subscription" }, { status });
}

export function hasFeature(entitlement: { eligible: boolean; plan: EntitlementPlan | null }, feature: SubscriptionFeature) {
  return Boolean(entitlement.eligible && entitlement.plan && planEntitlements[entitlement.plan].features.has(feature));
}

export function assertFeature(entitlement: { eligible: boolean; plan: EntitlementPlan | null }, feature: SubscriptionFeature) {
  if (!entitlement.eligible || !entitlement.plan) throw new EntitlementError("SUBSCRIPTION_REQUIRED", null);
  if (!hasFeature(entitlement, feature)) throw new EntitlementError(`${feature}_PRO_ONLY`, entitlement.plan);
}

/** Serializes entitlement count-and-write operations per store to prevent concurrent limit bypasses. */
export async function lockStoreEntitlement(tx: Prisma.TransactionClient | any, storeId: string) {
  const rows = await tx.$queryRaw`SELECT "id" FROM "Store" WHERE "id" = ${storeId} FOR UPDATE`;
  if (!rows.length) throw new EntitlementError("SUBSCRIPTION_REQUIRED", null);
  return getStoreEntitlements(storeId, tx);
}

export async function assertProductLimit(tx: any, storeId: string, plan: EntitlementPlan) {
  const limit = planEntitlements[plan].activeProducts;
  const current = await tx.product.count({ where: { storeId, status: "ACTIVE" } });
  if (exceedsEntitlementLimit(current, 1, limit)) throw new EntitlementError("PRODUCT_LIMIT_REACHED", plan, current, limit);
}

export async function assertVariantLimit(tx: any, storeId: string, plan: EntitlementPlan, productId: string, incomingActive: number) {
  const limit = planEntitlements[plan].activeVariants;
  const [current, currentProduct] = await Promise.all([
    tx.productVariant.count({ where: { isActive: true, product: { storeId } } }),
    tx.productVariant.count({ where: { isActive: true, productId } }),
  ]);
  if (exceedsVariantLimit(current, currentProduct, incomingActive, limit)) throw new EntitlementError("VARIANT_LIMIT_REACHED", plan, current, limit);
}
