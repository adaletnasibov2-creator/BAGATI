import { Prisma } from "@prisma/client";
import { publicStoreEligibilityBaseWhere, publicStoreWhere } from "@/lib/seller-legal-policy";

/** Public listings use the same eligibility checks as direct product access and checkout. */
export function publicStoreVisibilityWhere(now = new Date()): Prisma.StoreWhereInput {
  return publicStoreWhere(now);
}

export function publicStoreListingWhere(
  filters: { citySlug?: string | null; query?: string | null } = {},
  now = new Date(),
): Prisma.StoreWhereInput {
  return {
    ...publicStoreWhere(now),
    ...storeListingFilters(filters),
  };
}

export function publicStoreListingCandidateWhere(
  filters: { citySlug?: string | null; query?: string | null } = {},
  now = new Date(),
): Prisma.StoreWhereInput {
  return {
    ...publicStoreEligibilityBaseWhere(now),
    ...storeListingFilters(filters),
  };
}

function storeListingFilters(
  filters: { citySlug?: string | null; query?: string | null },
): Prisma.StoreWhereInput {
  const conditions: Prisma.StoreWhereInput[] = [];
  if (filters.citySlug) conditions.push({ city: { isActive: true, slug: filters.citySlug } });
  if (filters.query) {
    conditions.push({
      OR: [
        { name: { contains: filters.query, mode: "insensitive" } },
        { description: { contains: filters.query, mode: "insensitive" } },
      ],
    });
  }

  return {
    ...(conditions.length ? { AND: conditions } : {}),
  };
}

/** A public product must belong to a store that is currently eligible for sale. */
export function publicProductVisibilityWhere(
  storeFilter?: Prisma.StoreWhereInput,
  now = new Date(),
): Prisma.ProductWhereInput {
  const eligibleStore = publicStoreWhere(now);
  return {
    status: "ACTIVE",
    store: storeFilter ? { AND: [eligibleStore, storeFilter] } : eligibleStore,
  };
}

export type StoreWorkflowStatus = "DRAFT" | "PENDING_REVIEW" | "ACTIVE" | "SUSPENDED" | "REJECTED";

/** An admin visibility change does not approve legal data or alter subscriptions. */
export function adminStoreVisibilityMutation(status: StoreWorkflowStatus, isActive: boolean) {
  // Visibility can be toggled only after the workflow has already approved the
  // store. It must never promote drafts, rejected applications, or suspensions.
  if (isActive && status !== "ACTIVE") return null;
  return { isActive };
}
