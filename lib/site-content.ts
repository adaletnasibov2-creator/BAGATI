import { z } from "zod";

export const SITE_SETTINGS_ID = "default";
export const HOMEPAGE_ASSET_NAMESPACE = "admin-home";
export const MAX_HOMEPAGE_SELECTIONS = 12;

export const SITE_SETTINGS_DEFAULTS = {
  id: SITE_SETTINGS_ID,
  siteName: "BAGATI Marketplace",
  logoUrl: null,
  contactPhone: null,
  contactEmail: null,
  instagramUrl: null,
  facebookUrl: null,
  tiktokUrl: null,
  deliveryInfo: "",
  returnsInfo: "",
  homeIntroTitle: "Mağazaları və məhsulları bir məkanda kəşf et.",
  homeIntroDescription: "Kataloqa nəzər sal, mağazaları araşdır və sənə uyğun seçimi et.",
  homeIntroLinkLabel: "Kataloqa bax",
  homeIntroLinkUrl: "/categories",
} as const;

const optionalHttpsUrl = z.union([
  z.literal(""),
  z.string().trim().max(1000).url().refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "HTTPS ünvanı daxil edin"),
  z.null(),
]).transform((value) => value || null);
const optionalHomepageImageUrl = z.union([
  z.literal(""),
  z.string().trim().max(1000).refine(isSafeHomepageImageUrl, "HTTPS URL və ya admin tərəfindən yüklənmiş şəkil olmalıdır"),
  z.null(),
]).transform((value) => value || null);

export function isSafeHomepageHref(value: string) {
  if (!value || value !== value.trim() || /[\u0000-\u001f\\]/.test(value)) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function isSafeHomepageImageUrl(value: string) {
  if (/^\/uploads\/vendors\/admin-home\/[a-f0-9-]+\.(?:jpg|png|webp)$/i.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export const siteSettingsSchema = z.object({
  siteName: z.string().trim().min(1).max(80),
  logoUrl: optionalHomepageImageUrl,
  contactPhone: z.union([z.string().trim().max(40), z.literal(""), z.null()]).transform((value) => value || null),
  contactEmail: z.union([z.string().trim().email().max(254), z.literal(""), z.null()]).transform((value) => value || null),
  instagramUrl: optionalHttpsUrl,
  facebookUrl: optionalHttpsUrl,
  tiktokUrl: optionalHttpsUrl,
  deliveryInfo: z.string().trim().max(5000),
  returnsInfo: z.string().trim().max(5000),
  homeIntroTitle: z.string().trim().min(1).max(160),
  homeIntroDescription: z.string().trim().max(1000),
  homeIntroLinkLabel: z.string().trim().min(1).max(80),
  homeIntroLinkUrl: z.string().trim().min(1).max(1000).refine(isSafeHomepageHref, "Yalnız daxili və ya HTTPS keçidə icazə verilir"),
});

export const homeBannerSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000),
  imageUrl: z.string().trim().min(1).max(1000).refine(isSafeHomepageImageUrl, "Şəkil HTTPS URL və ya admin yükləməsi olmalıdır"),
  buttonLabel: z.string().trim().min(1).max(80),
  href: z.string().trim().min(1).max(1000).refine(isSafeHomepageHref, "Yalnız daxili və ya HTTPS keçidə icazə verilir"),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0).max(1000),
}).refine((value) => value.endsAt > value.startsAt, {
  message: "Bitmə vaxtı başlanğıcdan sonra olmalıdır",
  path: ["endsAt"],
});

export const homepageFeaturedSchema = z.object({
  productIds: z.array(z.string().min(1).max(64)).max(MAX_HOMEPAGE_SELECTIONS),
  storeIds: z.array(z.string().min(1).max(64)).max(MAX_HOMEPAGE_SELECTIONS),
}).refine((value) => new Set(value.productIds).size === value.productIds.length && new Set(value.storeIds).size === value.storeIds.length, {
  message: "Eyni məhsul və ya mağazanı təkrar seçmək olmaz",
});

export function isHomeBannerVisible(
  banner: { isActive: boolean; startsAt: Date; endsAt: Date },
  now = new Date(),
) {
  return banner.isActive && banner.startsAt <= now && banner.endsAt >= now;
}
