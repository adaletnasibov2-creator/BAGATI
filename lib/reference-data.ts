/**
 * BAGATI marketplace reference data: the launch city, Azerbaijan locations, the initial category
 * taxonomy and the two subscription plans. `prisma/seed.ts` and `scripts/reference-data.ts` both use
 * these lists, so development and production are seeded from one source.
 *
 * Deploying code never copies database rows; a fresh production database stays empty until this
 * data is inserted.
 */
export const LAUNCH_CITY = { name: "Qazax", slug: "qazax" } as const;

export const INITIAL_CITY_NAMES = [
  "Bakı", "Gəncə", "Sumqayıt", "Mingəçevir", "Naxçıvan", "Şəki", "Şirvan", "Naftalan", "Yevlax", "Tovuz",
  "Ağstafa", "Şəmkir", "Gədəbəy", "Göyçay", "Ağdaş", "Bərdə", "Ağcabədi", "Lənkəran", "Masallı", "Astara",
  "Quba", "Qusar", "Xaçmaz", "Şamaxı", "İsmayıllı", "Ağsu", "Salyan", "Sabirabad", "Saatlı", "Biləsuvar",
  "Cəlilabad", "Hacıqabul", "Neftçala", "Kürdəmir", "Zaqatala", "Balakən", "Qax", "Oğuz", "Qəbələ", "Füzuli",
  "Ağdam", "Beyləqan", "İmişli", "Şuşa", "Xankəndi", "Laçın", "Kəlbəcər", "Qubadlı", "Zəngilan", "Cəbrayıl",
  "Xocavənd", "Xocalı", "Tərtər",
] as const;

export const INITIAL_CATEGORIES = [
  { name: "Elektronika", slug: "elektronika" },
  { name: "Geyim", slug: "geyim" },
  { name: "Ev və məişət", slug: "ev-ve-mesiet" },
  { name: "Əyləncə", slug: "eylence" },
  { name: "İdman", slug: "idman" },
  { name: "Uşaq", slug: "usaq" },
  { name: "Gözəllik", slug: "gozellik" },
  { name: "Aksesuarlar", slug: "aksesuarlar" },
  { name: "Supermarket", slug: "supermarket" },
  { name: "Digər", slug: "diger" },
] as const;

export const INITIAL_SUBSCRIPTION_PLANS = [
  { name: "BASIC", slug: "basic", description: "Kiçik mağazalar üçün əsas aylıq satıcı paketi", monthlyPrice: "20.00" },
  { name: "PRO", slug: "professional", description: "Böyüyən mağazalar üçün genişləndirilmiş aylıq paket", monthlyPrice: "50.00" },
] as const;

/** Admin slug convention: lowercase ASCII words joined by hyphens, Azerbaijani letters transliterated. */
export function citySlug(name: string) {
  return name
    .toLowerCase()
    .replace(/ə/g, "e")
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export type ExistingReferenceRows = {
  cities: { name: string; slug: string; isActive: boolean }[];
  categories: { name: string; slug: string; isActive: boolean }[];
  plans: { slug: string; isActive: boolean }[];
};

export type ReferenceDataPlan = {
  cityInserts: { name: string; slug: string }[];
  categoryInserts: { name: string; slug: string }[];
  planInserts: { name: string; slug: string; description: string; monthlyPrice: string }[];
  /** Existing reference rows that are inactive. Reported only; never changed automatically. */
  inactiveExisting: { kind: "city" | "category" | "plan"; slug: string }[];
};

/**
 * Insert-only plan: a row is proposed only when neither its slug nor (for cities/categories) its exact
 * name already exists. Existing rows — including inactive ones and admin edits — are never updated,
 * reactivated, renamed or deleted.
 */
export function planReferenceData(existing: ExistingReferenceRows): ReferenceDataPlan {
  const citySlugs = new Set(existing.cities.map((c) => c.slug)), cityNames = new Set(existing.cities.map((c) => c.name));
  const categorySlugs = new Set(existing.categories.map((c) => c.slug)), categoryNames = new Set(existing.categories.map((c) => c.name));
  const planSlugs = new Set(existing.plans.map((p) => p.slug.toLowerCase()));

  const wantedCities = [LAUNCH_CITY, ...INITIAL_CITY_NAMES.map((name) => ({ name, slug: citySlug(name) }))];
  const cityInserts: ReferenceDataPlan["cityInserts"] = [];
  for (const city of wantedCities) {
    if (citySlugs.has(city.slug) || cityNames.has(city.name)) continue;
    citySlugs.add(city.slug);
    cityNames.add(city.name);
    cityInserts.push({ name: city.name, slug: city.slug });
  }
  const categoryInserts = INITIAL_CATEGORIES
    .filter((category) => !categorySlugs.has(category.slug) && !categoryNames.has(category.name))
    .map((category) => ({ ...category }));
  const planInserts = INITIAL_SUBSCRIPTION_PLANS
    .filter((plan) => !planSlugs.has(plan.slug))
    .map((plan) => ({ ...plan }));

  const referenceCitySlugs = new Set(wantedCities.map((c) => c.slug));
  const referenceCategorySlugs = new Set<string>(INITIAL_CATEGORIES.map((c) => c.slug));
  const referencePlanSlugs = new Set<string>(INITIAL_SUBSCRIPTION_PLANS.map((p) => p.slug));
  const inactiveExisting: ReferenceDataPlan["inactiveExisting"] = [
    ...existing.cities.filter((c) => !c.isActive && referenceCitySlugs.has(c.slug)).map((c) => ({ kind: "city" as const, slug: c.slug })),
    ...existing.categories.filter((c) => !c.isActive && referenceCategorySlugs.has(c.slug)).map((c) => ({ kind: "category" as const, slug: c.slug })),
    ...existing.plans.filter((p) => !p.isActive && referencePlanSlugs.has(p.slug.toLowerCase())).map((p) => ({ kind: "plan" as const, slug: p.slug })),
  ];
  return { cityInserts, categoryInserts, planInserts, inactiveExisting };
}
