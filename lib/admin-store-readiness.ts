export type AdminStoreReadinessInput = {
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  address: string | null;
  cityName: string | null;
  cityActive: boolean;
  vendorActive: boolean;
  sellerType: string | null;
  legalName: string | null;
  voen: string | null;
  legalAddress: string | null;
  legalInfoApproved: boolean;
  adminManaged: boolean;
  storeStatus: string;
  storeActive: boolean;
  subscription: {
    status: string;
    periodStart: Date | null;
    periodEnd: Date | null;
    planSlug: string;
    planActive: boolean;
  } | null;
  /** Unrevoked admin complimentary (free) grant, or null. Required so callers cannot forget it. */
  complimentary: { tier: "BASIC" | "PRO"; endsAt: Date | null } | null;
  productCount: number;
  activeProductCount: number;
  categoryLinkedProductCount: number;
};

export type AdminStoreReadinessItem = { label: string; ready: boolean; detail: string };

export type AdminStoreReadinessDependencies = {
  missingSellerLegalFields: (profile: {
    sellerType: string | null;
    legalName: string | null;
    voen: string | null;
    legalAddress: string | null;
  }) => string[];
  resolveStoreEntitlements: (state: {
    adminManaged: boolean;
    storeStatus: string;
    storeActive: boolean;
    vendorActive: boolean;
    cityActive: boolean;
    subscriptionStatus: string | null;
    planSlug: string | null;
    planActive: boolean;
    periodStart: Date | null;
    periodEnd: Date | null;
    complimentary: { tier: "BASIC" | "PRO"; endsAt: Date | null } | null;
  }) => { eligible: boolean };
};

export function buildAdminStoreReadiness(
  input: AdminStoreReadinessInput,
  dependencies: AdminStoreReadinessDependencies,
): AdminStoreReadinessItem[] {
  const missingLegal = dependencies.missingSellerLegalFields({
    sellerType: input.sellerType,
    legalName: input.legalName,
    voen: input.voen,
    legalAddress: input.legalAddress,
  });
  const entitlement = dependencies.resolveStoreEntitlements({
    adminManaged: input.adminManaged,
    storeStatus: input.storeStatus,
    storeActive: input.storeActive,
    vendorActive: input.vendorActive,
    cityActive: input.cityActive,
    subscriptionStatus: input.subscription?.status ?? null,
    planSlug: input.subscription?.planSlug ?? null,
    planActive: input.subscription?.planActive ?? false,
    periodStart: input.subscription?.periodStart ?? null,
    periodEnd: input.subscription?.periodEnd ?? null,
    complimentary: input.complimentary,
  });
  const profileReady = Boolean(
    input.name.trim() && input.slug.trim() && input.description?.trim() && input.logoUrl
    && input.bannerUrl && input.contactPhone && input.contactEmail && input.address && input.cityName,
  );
  const storeReady = input.storeStatus === "ACTIVE" && input.storeActive;

  return [
    {
      label: "Ma\u011faza profili",
      ready: profileReady,
      detail: profileReady
        ? "Ad, t\u0259svir, loqo, \u0259laq\u0259 v\u0259 \u00fcnvan m\u0259lumatlar\u0131 m\u00f6vcuddur."
        : "Ad, t\u0259svir, loqo, telefon, e-po\u00e7t, \u015f\u0259h\u0259r v\u0259 \u00fcnvan\u0131 tamamlay\u0131n.",
    },
    {
      label: "Sat\u0131c\u0131 h\u00fcquqi m\u0259lumatlar\u0131",
      ready: input.legalInfoApproved && missingLegal.length === 0,
      detail: missingLegal.length
        ? "\u00c7at\u0131\u015fmayan sah\u0259l\u0259r: " + missingLegal.join(", ") + "."
        : input.legalInfoApproved
          ? "T\u0259l\u0259b olunan sah\u0259l\u0259r daxil edilib v\u0259 admin bax\u0131\u015f\u0131 t\u0259sdiql\u0259yib."
          : "H\u00fcquqi m\u0259lumat daxil edilib, lakin admin t\u0259sdiqi yoxdur.",
    },
    {
      label: "Sat\u0131\u015f h\u00fcququ v\u0259 abun\u0259lik",
      ready: entitlement.eligible,
      detail: entitlement.eligible
        ? "Ma\u011faza, sat\u0131c\u0131 v\u0259 plan sat\u0131\u015f qaydalar\u0131na uy\u011fundur."
        : "Ma\u011faza, sat\u0131c\u0131, \u015f\u0259h\u0259r v\u0259 ya abun\u0259lik t\u0259l\u0259bl\u0259rind\u0259n biri tamamlanmay\u0131b.",
    },
    {
      label: "M\u0259hsul kataloqu",
      ready: input.activeProductCount > 0,
      detail: `${input.activeProductCount} aktiv m\u0259hsul / ${input.productCount} \u00fcmumi m\u0259hsul.`,
    },
    {
      label: "M\u0259hsul kateqoriyalar\u0131",
      ready: input.categoryLinkedProductCount > 0,
      detail: `${input.categoryLinkedProductCount} aktiv m\u0259hsul kateqoriyaya ba\u011flan\u0131b.`,
    },
    {
      label: "Ma\u011faza statusu",
      ready: storeReady,
      detail: storeReady
        ? "Ma\u011faza ACTIVE v\u0259 ictimai g\u00f6r\u00fcn\u00fcrl\u00fck aktivdir."
        : `M\u00f6vcud status: ${input.storeStatus}; g\u00f6r\u00fcn\u00fcrl\u00fck: ${input.storeActive ? "aktiv" : "deaktiv"}.`,
    },
  ];
}
