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

/**
 * One public store by id or slug. The id/slug match and the eligibility filter are combined with AND:
 * the eligibility filter has its own `OR` key, so spreading it next to an `OR` overwrites the match
 * (that bug made every /stores/<id> URL return the first eligible store).
 */
export function publicStoreByIdOrSlugWhere(storeIdOrSlug: string, now = new Date()): Prisma.StoreWhereInput {
  return {
    AND: [
      { OR: [{ id: storeIdOrSlug }, { slug: storeIdOrSlug }] },
      publicStoreEligibilityBaseWhere(now),
    ],
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
