/**
 * Seller-facing store setup checklist. Pure: callers pass already-scoped store data.
 * It only describes progress; it never approves, activates or submits a store.
 */
export type VendorStoreSetupInput = {
  name: string;
  slug: string;
  description: string | null;
  cityName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  address: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  /** False when the database cannot store a banner yet; the banner is then not required. */
  bannerSupported: boolean;
  /** Labels of legal fields still missing, as computed by the server-owned legal policy. */
  missingLegalFields: string[];
  legalInfoApproved: boolean;
  adminManaged: boolean;
  storeStatus: string;
  storeActive: boolean;
  reviewNote: string | null;
  subscriptionStatus: string | null;
  productCount: number;
  activeProductCount: number;
};

export type VendorSetupStepKey = "info" | "contact" | "legal" | "branding" | "products" | "approval";

export type VendorSetupStep = {
  key: VendorSetupStepKey;
  label: string;
  done: boolean;
  detail: string;
  /** Path relative to /vendor/{storeId}. */
  href: string;
  actionLabel: string;
};

export type VendorStoreSetup = {
  steps: VendorSetupStep[];
  completed: number;
  total: number;
  percent: number;
  nextStep: VendorSetupStep | null;
  approval: { tone: "neutral" | "pending" | "success" | "danger"; label: string; detail: string };
};

const filled = (value: string | null | undefined) => Boolean(value && value.trim());

export const storeStatusLabels: Record<string, string> = {
  DRAFT: "Qaralama",
  PENDING_REVIEW: "Gözləmədə",
  ACTIVE: "Aktiv",
  SUSPENDED: "Dayandırılıb",
  REJECTED: "Rədd edilib",
};

export const subscriptionStatusLabels: Record<string, string> = {
  PENDING: "Gözləmədə",
  ACTIVE: "Aktiv",
  PAST_DUE: "Ödəniş gecikib",
  SUSPENDED: "Dayandırılıb",
  CANCELLED: "Ləğv edilib",
  EXPIRED: "Müddəti bitib",
};

function describeApproval(input: VendorStoreSetupInput): VendorStoreSetup["approval"] {
  switch (input.storeStatus) {
    case "ACTIVE":
      if (!input.legalInfoApproved && !input.adminManaged) {
        return { tone: "pending", label: "Hüquqi məlumat yoxlanılmalıdır", detail: "Hüquqi məlumatlar dəyişib. Mağazanı yenidən yoxlamaya göndərin." };
      }
      return input.storeActive
        ? { tone: "success", label: "Aktiv", detail: "Mağaza təsdiqlənib və alıcılar üçün açıqdır." }
        : { tone: "pending", label: "Təsdiqlənib, görünmür", detail: "Mağaza təsdiqlənib, lakin hazırda ictimai görünmür." };
    case "PENDING_REVIEW":
      return { tone: "pending", label: "Gözləmədə", detail: "Mağaza administrator yoxlamasındadır. Nəticə bildirişlərdə görünəcək." };
    case "REJECTED":
      return { tone: "danger", label: "Rədd edilib", detail: input.reviewNote?.trim() ? `Səbəb: ${input.reviewNote.trim()}` : "Qeydləri düzəldib mağazanı yenidən göndərin." };
    case "SUSPENDED":
      return { tone: "danger", label: "Dayandırılıb", detail: "Mağaza administrator tərəfindən dayandırılıb. Dəstək ilə əlaqə saxlayın." };
    default:
      return { tone: "neutral", label: "Qaralama", detail: "Mağaza hələ yoxlamaya göndərilməyib." };
  }
}

export function buildVendorStoreSetup(input: VendorStoreSetupInput): VendorStoreSetup {
  const infoMissing = [
    !filled(input.name) && "mağaza adı",
    !filled(input.slug) && "internet ünvanı",
    !filled(input.description) && "mağaza təsviri",
    !filled(input.cityName) && "şəhər",
  ].filter(Boolean) as string[];
  const contactMissing = [
    !filled(input.contactPhone) && "telefon",
    !filled(input.contactEmail) && "e-poçt",
    !filled(input.address) && "ünvan",
  ].filter(Boolean) as string[];
  const brandingMissing = [
    !filled(input.logoUrl) && "loqo",
    input.bannerSupported && !filled(input.bannerUrl) && "örtük şəkli",
  ].filter(Boolean) as string[];
  const legalDone = input.adminManaged || input.missingLegalFields.length === 0;
  const approved = input.storeStatus === "ACTIVE" && (input.legalInfoApproved || input.adminManaged);

  const steps: VendorSetupStep[] = [
    {
      key: "info", label: "Mağaza məlumatları", done: infoMissing.length === 0,
      detail: infoMissing.length ? `Çatışmır: ${infoMissing.join(", ")}.` : "Ad, təsvir, şəhər və internet ünvanı hazırdır.",
      href: "profile", actionLabel: "Məlumatları tamamla",
    },
    {
      key: "contact", label: "Əlaqə məlumatları", done: contactMissing.length === 0,
      detail: contactMissing.length ? `Çatışmır: ${contactMissing.join(", ")}.` : "Telefon, e-poçt və ünvan daxil edilib.",
      href: "profile", actionLabel: "Əlaqəni əlavə et",
    },
    {
      key: "legal", label: "Hüquqi məlumatlar", done: legalDone,
      detail: legalDone
        ? (input.legalInfoApproved || input.adminManaged ? "Hüquqi məlumatlar təsdiqlənib." : "Məlumatlar daxil edilib, təsdiq gözlənilir.")
        : `Çatışmır: ${input.missingLegalFields.join(", ")}.`,
      href: "profile", actionLabel: "Hüquqi məlumatı daxil et",
    },
    {
      key: "branding", label: "Loqo və örtük şəkli", done: brandingMissing.length === 0,
      detail: brandingMissing.length ? `Çatışmır: ${brandingMissing.join(", ")}.` : "Mağaza görünüşü hazırdır.",
      href: "profile", actionLabel: "Şəkil yüklə",
    },
    {
      key: "products", label: "Məhsullar", done: input.productCount > 0,
      detail: input.productCount === 0
        ? "Hələ məhsul əlavə edilməyib."
        : `${input.productCount} məhsul, onlardan ${input.activeProductCount} aktivdir.`,
      href: input.productCount === 0 ? "products/new" : "products", actionLabel: input.productCount === 0 ? "İlk məhsulu əlavə et" : "Məhsullara bax",
    },
    {
      key: "approval", label: "Təsdiq və aktivləşmə", done: approved,
      detail: describeApproval(input).detail,
      href: "profile", actionLabel: input.storeStatus === "DRAFT" || input.storeStatus === "REJECTED" ? "Yoxlamaya göndər" : "Statusa bax",
    },
  ];
  const completed = steps.filter((step) => step.done).length;
  return {
    steps,
    completed,
    total: steps.length,
    percent: Math.round((completed / steps.length) * 100),
    nextStep: steps.find((step) => !step.done) ?? null,
    approval: describeApproval(input),
  };
}
