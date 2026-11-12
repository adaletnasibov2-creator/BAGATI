import { Prisma } from "@prisma/client";
import { supportedSubscriptionPlanSlugs } from "@/lib/subscription-plans";

export const sellerTypes = ["INDIVIDUAL_ENTREPRENEUR", "REGISTERED_COMPANY"] as const;
export type SellerTypeValue = (typeof sellerTypes)[number];

export const sellerLegalFieldLabels = {
  legalName: "Hüquqi ad / sahibkarın adı",
  voen: "VÖEN",
  legalAddress: "Hüquqi ünvan",
} as const;
export type SellerLegalField = keyof typeof sellerLegalFieldLabels;
export const sellerRequirementLabels: Record<SellerLegalField | "sellerType", string> = {
  ...sellerLegalFieldLabels,
  sellerType: "Satıcı növü",
};
export type SellerLegalRequirement = SellerLegalField | "sellerType";

const defaultRequirements: Record<SellerTypeValue, SellerLegalField[]> = {
  INDIVIDUAL_ENTREPRENEUR: ["legalName", "voen"],
  REGISTERED_COMPANY: ["legalName", "voen", "legalAddress"],
};

/**
 * Policy is server-owned. BAGATI_SELLER_LEGAL_POLICY may override required
 * fields per seller type, e.g. {"INDIVIDUAL_ENTREPRENEUR":["legalName","voen"],
 * "REGISTERED_COMPANY":["legalName","voen","legalAddress"]}.
 * Defaults are product policy only, not a determination of legal compliance.
 */
export function sellerLegalRequirements(type: SellerTypeValue): SellerLegalField[] {
  const raw = process.env.BAGATI_SELLER_LEGAL_POLICY;
  if (!raw) return defaultRequirements[type];
  try {
    const config: unknown = JSON.parse(raw);
    if (!config || typeof config !== "object" || Array.isArray(config)) return defaultRequirements[type];
    const candidate = (config as Record<string, unknown>)[type];
    if (!Array.isArray(candidate) || !candidate.every((field) => typeof field === "string" && field in sellerLegalFieldLabels)) {
      return defaultRequirements[type];
    }
    return [...new Set(candidate as SellerLegalField[])];
  } catch {
    return defaultRequirements[type];
  }
}

type SellerLegalProfile = {
  sellerType: string | null;
  legalName: string | null;
  voen: string | null;
  legalAddress: string | null;
};

export function missingSellerLegalFields(profile: SellerLegalProfile): SellerLegalRequirement[] {
  if (!sellerTypes.includes(profile.sellerType as SellerTypeValue)) return ["sellerType", "legalName", "voen"];
  return sellerLegalRequirements(profile.sellerType as SellerTypeValue).filter((field) => !profile[field]?.trim());
}

export function publicStoreEligibilityBaseWhere(now = new Date()): Prisma.StoreWhereInput {
  return {
    isActive: true,
    status: "ACTIVE",
    legalInfoApproved: true,
    city: { isActive: true },
    vendor: { user: { isActive: true } },
    OR: [
      { adminManaged: true },
      { subscription: { is: { status: "ACTIVE", AND: [
        { OR: [{ currentPeriodStart: null }, { currentPeriodStart: { lte: now } }] },
        { OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: now } }] },
      ], plan: { isActive: true, slug: { in: [...supportedSubscriptionPlanSlugs], mode: "insensitive" } } } } },
      // Admin complimentary (free) grant: unrevoked and not past its optional end date.
      // Must stay identical to isComplimentaryCurrent() in lib/subscription-entitlements.ts.
      { complimentaryEntitlements: { some: { revokedAt: null, OR: [{ endsAt: null }, { endsAt: { gt: now } }] } } },
    ],
  };
}

export function publicStoreWhere(now = new Date()): Prisma.StoreWhereInput {
  return {
    ...publicStoreEligibilityBaseWhere(now),
    vendor: {
      user: { isActive: true },
      OR: sellerTypes.map((sellerType) => ({
        sellerType,
        AND: sellerLegalRequirements(sellerType).flatMap((field) => [{ [field]: { not: null } }, { [field]: { not: "" } }]),
      })),
    },
  };
}
