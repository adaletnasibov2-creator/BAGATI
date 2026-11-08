import { prisma } from "@/lib/prisma";
import { missingSellerLegalFields } from "@/lib/seller-legal-policy";
import { resolveStoreEntitlements } from "@/lib/subscription-entitlements";

const STORE_ID_BATCH_SIZE = 100;

type PublicProductCandidate = { id: string; status: string; storeId: string };

export type PublicStoreCandidate = {
  id: string;
  status: string;
  isActive: boolean;
  legalInfoApproved: boolean;
  adminManaged: boolean;
  city: { isActive: boolean };
  vendor: {
    user: { isActive: boolean };
    sellerType: string | null;
    legalName: string | null;
    voen: string | null;
    legalAddress: string | null;
  };
  subscription: {
    status: string;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
    plan: { isActive: boolean; slug: string };
  } | null;
};

export type PublicStoreEligibilityClient = {
  store: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: {
        id: true;
        status: true;
        isActive: true;
        legalInfoApproved: true;
        adminManaged: true;
        city: { select: { isActive: true } };
        vendor: { select: {
          sellerType: true;
          legalName: true;
          voen: true;
          legalAddress: true;
          user: { select: { isActive: true } };
        } };
        subscription: { select: {
          status: true;
          currentPeriodStart: true;
          currentPeriodEnd: true;
          plan: { select: { isActive: true; slug: true } };
        } };
      };
    }): Promise<PublicStoreCandidate[]>;
  };
};

export function isPublicStoreEligible(candidate: PublicStoreCandidate, now = new Date()): boolean {
  if (!candidate.legalInfoApproved || missingSellerLegalFields(candidate.vendor).length > 0) return false;
  return resolveStoreEntitlements({
    adminManaged: candidate.adminManaged,
    storeStatus: candidate.status,
    storeActive: candidate.isActive,
    vendorActive: candidate.vendor.user.isActive,
    cityActive: candidate.city.isActive,
    subscriptionStatus: candidate.subscription?.status ?? null,
    planSlug: candidate.subscription?.plan.slug ?? null,
    planActive: candidate.subscription?.plan.isActive ?? false,
    periodStart: candidate.subscription?.currentPeriodStart ?? null,
    periodEnd: candidate.subscription?.currentPeriodEnd ?? null,
  }, now).eligible;
}

/** Resolves known request-scoped stores; catalog queries need a paginated query service. */
export async function resolvePublicStoreEligibility(
  storeIds: readonly string[],
  client: PublicStoreEligibilityClient = prisma,
  now = new Date(),
): Promise<Set<string>> {
  const eligibleStoreIds = new Set<string>();
  const uniqueStoreIds = [...new Set(storeIds)];
  for (let offset = 0; offset < uniqueStoreIds.length; offset += STORE_ID_BATCH_SIZE) {
    const batch = uniqueStoreIds.slice(offset, offset + STORE_ID_BATCH_SIZE);
    if (!batch.length) continue;
    const candidates = await client.store.findMany({
      where: { id: { in: batch } },
      select: {
        id: true,
        status: true,
        isActive: true,
        legalInfoApproved: true,
        adminManaged: true,
        city: { select: { isActive: true } },
        vendor: {
          select: {
            sellerType: true,
            legalName: true,
            voen: true,
            legalAddress: true,
            user: { select: { isActive: true } },
          },
        },
        subscription: {
          select: {
            status: true,
            currentPeriodStart: true,
            currentPeriodEnd: true,
            plan: { select: { isActive: true, slug: true } },
          },
        },
      },
    });
    for (const candidate of candidates) {
      if (isPublicStoreEligible(candidate, now)) eligibleStoreIds.add(candidate.id);
    }
  }
  return eligibleStoreIds;
}

export async function filterEligiblePublicStores<T extends { id: string }>(
  stores: readonly T[],
  client: PublicStoreEligibilityClient = prisma,
  now = new Date(),
): Promise<T[]> {
  const eligibleIds = await resolvePublicStoreEligibility(stores.map((store) => store.id), client, now);
  return stores.filter((store) => eligibleIds.has(store.id));
}

export async function filterEligiblePublicProducts<T extends { storeId: string }>(
  products: readonly T[],
  client: PublicStoreEligibilityClient = prisma,
  now = new Date(),
): Promise<T[]> {
  const eligibleStoreIds = await resolvePublicStoreEligibility(products.map((product) => product.storeId), client, now);
  return products.filter((product) => eligibleStoreIds.has(product.storeId));
}

export async function resolvePublicProductEligibility(
  products: readonly PublicProductCandidate[],
  client: PublicStoreEligibilityClient = prisma,
  now = new Date(),
): Promise<Set<string>> {
  const storeIds = [...new Set(products.map((product) => product.storeId))];
  const eligibleStoreIds = await resolvePublicStoreEligibility(storeIds, client, now);
  return new Set(products
    .filter((product) => isPublicProductEligible(product, eligibleStoreIds))
    .map((product) => product.id));
}

export function isPublicProductEligible(
  product: PublicProductCandidate,
  eligibleStoreIds: ReadonlySet<string>,
): boolean {
  return product.status === "ACTIVE" && eligibleStoreIds.has(product.storeId);
}
