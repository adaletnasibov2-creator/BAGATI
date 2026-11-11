import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homeBannerSchema, homepageFeaturedSchema, isHomeBannerVisible, isSafeHomepageHref, siteSettingsSchema } from "../lib/site-content";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");
const now = new Date("2026-10-12T08:00:00.000Z");

test("site settings validate bounded content and reject unsafe links and image URLs", () => {
  const valid = siteSettingsSchema.safeParse({
    siteName: "BAGATI Market",
    logoUrl: "/uploads/vendors/admin-home/123e4567-e89b-12d3-a456-426614174000.webp",
    contactPhone: "",
    contactEmail: "help@example.test",
    instagramUrl: "https://instagram.com/example",
    facebookUrl: "",
    tiktokUrl: null,
    deliveryInfo: "Çatdırılma şərtləri",
    returnsInfo: "Qaytarılma şərtləri",
    homeIntroTitle: "Yeni başlıq",
    homeIntroDescription: "Mətn",
    homeIntroLinkLabel: "Bax",
    homeIntroLinkUrl: "/categories",
  });
  assert.equal(valid.success, true);
  assert.equal(siteSettingsSchema.safeParse({
    siteName: "X",
    logoUrl: "javascript:alert(1)",
    contactPhone: "",
    contactEmail: "",
    instagramUrl: "",
    facebookUrl: "",
    tiktokUrl: "",
    deliveryInfo: "",
    returnsInfo: "",
    homeIntroTitle: "Başlıq",
    homeIntroDescription: "",
    homeIntroLinkLabel: "Bax",
    homeIntroLinkUrl: "//evil.example",
  }).success, false);
});

test("homepage links allow internal paths or HTTPS only", () => {
  assert.equal(isSafeHomepageHref("/products?id=1"), true);
  assert.equal(isSafeHomepageHref("https://example.com/campaign"), true);
  assert.equal(isSafeHomepageHref("//example.com"), false);
  assert.equal(isSafeHomepageHref("javascript:alert(1)"), false);
  assert.equal(isSafeHomepageHref("https://user:pass@example.com"), false);
});

test("banners require valid ranges and are hidden when inactive or outside their schedule", () => {
  const validBanner = {
    title: "Payız endirimi",
    description: "Məhdud müddət",
    imageUrl: "/uploads/vendors/admin-home/123e4567-e89b-12d3-a456-426614174000.jpg",
    buttonLabel: "Bax",
    href: "/deals",
    startsAt: "2026-10-12T07:00:00.000Z",
    endsAt: "2026-10-12T09:00:00.000Z",
    isActive: true,
    sortOrder: 0,
  };
  assert.equal(homeBannerSchema.safeParse(validBanner).success, true);
  assert.equal(homeBannerSchema.safeParse({ ...validBanner, endsAt: validBanner.startsAt }).success, false);
  assert.equal(isHomeBannerVisible({ isActive: true, startsAt: new Date("2026-10-12T07:00:00.000Z"), endsAt: new Date("2026-10-12T09:00:00.000Z") }, now), true);
  assert.equal(isHomeBannerVisible({ isActive: false, startsAt: new Date("2026-10-12T07:00:00.000Z"), endsAt: new Date("2026-10-12T09:00:00.000Z") }, now), false);
  assert.equal(isHomeBannerVisible({ isActive: true, startsAt: new Date("2026-10-12T09:00:00.000Z"), endsAt: new Date("2026-10-12T10:00:00.000Z") }, now), false);
});

test("featured homepage selections are unique and capped", () => {
  assert.equal(homepageFeaturedSchema.safeParse({ productIds: ["p1", "p2"], storeIds: ["s1"] }).success, true);
  assert.equal(homepageFeaturedSchema.safeParse({ productIds: ["p1", "p1"], storeIds: [] }).success, false);
  assert.equal(homepageFeaturedSchema.safeParse({ productIds: Array.from({ length: 13 }, (_, index) => `p${index}`), storeIds: [] }).success, false);
});

test("admin content and upload endpoints require ADMIN and record content changes", () => {
  for (const path of [
    "app/api/admin/site-settings/route.ts",
    "app/api/admin/homepage/banners/route.ts",
    "app/api/admin/homepage/banners/[bannerId]/route.ts",
    "app/api/admin/homepage/featured/route.ts",
    "app/api/admin/homepage/assets/route.ts",
  ]) {
    assert.match(source(path), /requireRole\("ADMIN"\)/, path);
  }
  assert.match(source("app/api/admin/homepage/assets/route.ts"), /validateAndNormalizeStoreImage/);
  assert.match(source("app/api/admin/homepage/assets/route.ts"), /getStoreAssetStorage\(\)\.save/);
  assert.match(source("app/api/admin/site-settings/route.ts"), /SITE_SETTINGS_UPDATE/);
  assert.match(source("app/api/admin/homepage/banners/route.ts"), /HOME_BANNER_CREATE/);
  assert.match(source("app/api/admin/homepage/featured/route.ts"), /HOMEPAGE_FEATURED_UPDATE/);
});

test("saved site branding is rendered in the public header, footer, and metadata", () => {
  const brand = source("components/brand-logo.tsx");
  const header = source("components/header.tsx");
  const layout = source("app/(customer)/layout.tsx");
  const footer = source("components/customer-footer.tsx");
  const rootLayout = source("app/layout.tsx");

  assert.match(brand, /src=\{logoUrl\}/);
  assert.match(brand, /\{siteName\}/);
  assert.match(header, /\.\.\.branding/);
  assert.match(header, /<BrandLogo variant="icon"[^>]*priority \{\.\.\.branding\}/);
  assert.match(header, /<BrandLogo variant="full"[^>]*priority \{\.\.\.branding\}/);
  assert.match(brand, /priority=\{priority\}/);
  assert.match(layout, /<Header\s+branding=\{\{ siteName: settings\.siteName, logoUrl: settings\.logoUrl \}\}/);
  assert.match(footer, /<BrandLogo variant="full"[^>]*siteName=\{settings\.siteName\} logoUrl=\{settings\.logoUrl\}/);
  assert.match(rootLayout, /icon: settings\.logoUrl \?\? "\/icon\.svg"/);
});

test("admin payment route clearly reports that transactions are unavailable", () => {
  const page = source("app/admin/[...section]/page.tsx");
  assert.match(page, /if\(route==="payments"\)/);
  assert.match(page, /Bu səhifə kart məlumatı saxlamır və ödəniş əməliyyatı göndərmir/);
});

test("homepage reads only active scheduled banners and retains existing seller promotion display", () => {
  const page = source("app/(customer)/page.tsx");
  assert.match(page, /where: \{ isActive: true, startsAt: \{ lte: now \}, endsAt: \{ gte: now \} \}/);
  assert.match(page, /homepageFeaturedProduct\.findMany/);
  assert.match(page, /homepageFeaturedStore\.findMany/);
  assert.match(page, /promotionalCampaigns/);
  assert.match(source("components/home/hero-carousel.tsx"), /banners\.length/);
});

test("storefront layout uses data-backed sections and preserves the BAGATI brand", () => {
  const page = source("app/(customer)/page.tsx");
  const header = source("components/header.tsx");
  const brand = source("components/brand-logo.tsx");
  const hero = source("components/home/hero-carousel.tsx");
  const layout = source("app/(customer)/layout.tsx");
  const footer = source("components/customer-footer.tsx");

  assert.match(header, /Sevdiyin mağazalar və məhsullar bir məkanda\./);
  assert.match(header, /<CategoryMegaMenu categories=\{categories\}/);
  assert.match(header, /<SearchForm categories=\{categories\}/);
  assert.doesNotMatch(header, /idarəçi girişləri/);
  assert.match(brand, /BAGATI/);
  assert.match(brand, /h-14 w-auto/);
  assert.match(brand, /h-16/);
  assert.match(page, /homepageStores\.length > 0/);
  assert.match(page, /promotionalById\.size > 0/);
  assert.match(page, /discounted\.length > 0/);
  assert.match(page, /<ProductShelf/);
  assert.match(page, /city\?\.slug === "qazax"/);
  assert.doesNotMatch(page, /CompactEmpty/);
  assert.match(hero, /object-cover/);
  assert.match(hero, /<picture/);
  assert.match(hero, /hero-electronics-devices-desktop\.webp/);
  assert.match(hero, /hero-electronics-devices-tablet\.webp/);
  assert.match(hero, /hero-electronics-devices-mobile\.webp/);
  assert.match(hero, /hero-beauty-skincare\.webp/);
  assert.doesNotMatch(hero, /images\.pexels\.com/);
  assert.doesNotMatch(hero, /hero-tech-campaign\.svg/);
  assert.doesNotMatch(hero, /hero-tech\.webp/);
  assert.match(hero, /hero-fashion-collection\.webp/);
  assert.match(hero, /hero-home\.webp/);
  const heroAssets = hero.match(/\/images\/home\/[\w-]+\.webp/g) ?? [];
  assert.ok(heroAssets.length >= 6);
  for (const asset of heroAssets) assert.ok(existsSync(resolve(root, "public", `.${asset}`)), `${asset} exists`);
  assert.match(hero, /id: "beauty"/);
  assert.match(hero, /onTouchStart/);
  assert.match(hero, /prefers-reduced-motion/);
  assert.match(source("components/mobile-menu.tsx"), /aria-modal="true"/);
  assert.match(source("components/mobile-menu.tsx"), /event\.key === "Escape"/);
  assert.match(source("components/mobile-bottom-nav.tsx"), /env\(safe-area-inset-bottom\)/);
  assert.match(layout, /<MobileBottomNav/);
  assert.match(footer, /\/privacy/);
  assert.match(footer, /\/terms/);
});

test("storefront palette is tokenized and product imagery remains catalog-backed", () => {
  const styles = source("app/globals.css");
  const theme = source("tailwind.config.ts");
  const card = source("components/product-card.tsx");
  const image = source("components/product-card-image.tsx");

  for (const [token, value] of [
    ["--bagati-deep-teal", "#173a3a"],
    ["--bagati-primary", "#174746"],
    ["--bagati-hover", "#23635d"],
    ["--bagati-accent", "#2f6f68"],
    ["--bagati-muted-green", "#638078"],
    ["--bagati-text", "#405451"],
    ["--bagati-text-secondary", "#566b65"],
    ["--bagati-page", "#f7f8f6"],
    ["--bagati-section", "#eef3f0"],
    ["--bagati-border", "#e5eae6"],
    ["--bagati-cream", "#f3e9d5"],
    ["--bagati-gold", "#c79a52"],
  ]) {
    assert.match(styles, new RegExp(`${token}:\\s*${value}`, "i"), token);
  }
  assert.match(theme, /"gold-dark": "var\(--bagati-gold-dark\)"/);
  assert.match(card, /secondaryImage/);
  assert.match(card, /getProductDiscount\(price, originalPrice\)/);
  assert.match(image, /placeholder="blur"/);
  assert.match(image, /onError=\{\(\) => setFailedSources/);
  assert.doesNotMatch(card, /rating|reviews|people viewing/i);
});

test("Prisma migration adds settings, banners, and referentially safe featured selections", () => {
  const schema = source("prisma/schema.prisma");
  const migration = source("prisma/migrations/20261012120000_admin_homepage_management/migration.sql");
  assert.match(schema, /model SiteSettings/);
  assert.match(schema, /model HomeBanner/);
  assert.match(schema, /model HomepageFeaturedProduct/);
  assert.match(schema, /model HomepageFeaturedStore/);
  assert.match(migration, /ON DELETE CASCADE/);
  assert.match(migration, /CREATE TABLE "SiteSettings"/);
  assert.match(migration, /CREATE TABLE "HomeBanner"/);
});
