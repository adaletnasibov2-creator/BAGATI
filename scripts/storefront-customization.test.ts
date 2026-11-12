import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getStorefrontTheme, isStorefrontTheme, storefrontThemes } from "../lib/storefront-themes";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sellerRoute = readFileSync(resolve(root, "app/api/vendor/[storeId]/[section]/route.ts"), "utf8");
const assetsRoute = readFileSync(resolve(root, "app/api/vendor/[storeId]/assets/route.ts"), "utf8");
const sellerEditor = readFileSync(resolve(root, "components/vendor-store-profile-editor.tsx"), "utf8");
const storesDirectory = readFileSync(resolve(root, "app/(customer)/stores/page.tsx"), "utf8");
const storefrontPage = readFileSync(resolve(root, "app/(customer)/stores/[storeId]/page.tsx"), "utf8");
const storefrontVisibility = () => readFileSync(resolve(root, "lib/store-visibility.ts"), "utf8");
const productDetailPage = readFileSync(resolve(root, "app/(customer)/products/[productId]/page.tsx"), "utf8");
const checkoutPage = readFileSync(resolve(root, "app/(customer)/checkout/page.tsx"), "utf8");
const adminPage = readFileSync(resolve(root, "app/admin/[...section]/page.tsx"), "utf8");
const activationRoute = readFileSync(resolve(root, "app/api/admin/stores/[storeId]/activation/route.ts"), "utf8");
const brandingCompatibility = readFileSync(resolve(root, "lib/storefront-branding-compat.ts"), "utf8");
const storefrontHeader = readFileSync(resolve(root, "components/storefront-branding.tsx"), "utf8");
const storefrontImage = readFileSync(resolve(root, "components/storefront-image.tsx"), "utf8");
const productImage = readFileSync(resolve(root, "components/product-card-image.tsx"), "utf8");
const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(resolve(root, "prisma/migrations/20261022000000_storefront_branding/migration.sql"), "utf8");

test("storefront themes are a controlled allowlist with a safe fallback", () => {
  assert.equal(isStorefrontTheme("forest"), true);
  assert.equal(isStorefrontTheme("ocean"), true);
  assert.equal(isStorefrontTheme("copper"), true);
  assert.equal(isStorefrontTheme("https://unsafe.example"), false);
  assert.equal(isStorefrontTheme("__proto__"), false);
  assert.equal(getStorefrontTheme("unknown"), storefrontThemes.forest);
});

test("seller branding writes are ownership-scoped and only accept owned image assets", () => {
  assert.match(sellerRoute, /const access=await scope\(storeId\)/);
  assert.match(sellerRoute, /vendor:\{userId:access\.user\.id\}/);
  assert.match(sellerRoute, /isOwnedStoreAssetUrl\(storeId,d\.logoUrl\)/);
  assert.match(sellerRoute, /isOwnedStoreAssetUrl\(storeId,d\.bannerUrl\)/);
  assert.match(sellerRoute, /isStorefrontTheme/);
  assert.match(sellerRoute, /SELLER_STOREFRONT_UPDATE/);
  assert.match(sellerRoute, /SELLER_LEGAL_INFORMATION_UPDATE/);
  assert.match(assetsRoute, /access\.user\.role !== "VENDOR"/);
  assert.match(assetsRoute, /validateAndNormalizeStoreImage/);
  assert.match(assetsRoute, /image\/jpeg.*image\/png.*image\/webp/);
  assert.match(assetsRoute, /MAX_IMAGE_BYTES = 5 \* 1024 \* 1024/);
  assert.match(assetsRoute, /isStorefrontAssetReferenced\(access\.storeId, url\)/);
  assert.match(brandingCompatibility, /to_jsonb\(store_record\)->>'bannerUrl' = \$\{url\}/);
});

test("seller profile only exposes branding edits when the database supports them", () => {
  assert.match(sellerEditor, /useState\(store\.bannerUrl\|\|""\)/);
  assert.match(sellerEditor, /store\.storefrontBrandingAvailable\?\{bannerUrl:bannerUrl\|\|null,theme\}:{}\)/);
  assert.match(sellerEditor, /store\.storefrontBrandingAvailable\?<><div/);
  assert.match(sellerEditor, /Mağaza örtüyü və rəng mövzusu hazırda bazada saxlanıla bilmir/);
  assert.match(sellerEditor, /store\.storefrontBrandingAvailable\?\{bannerUrl:bannerUrl\|\|null,theme\}/);
  assert.match(sellerEditor, /latitude:location\?\.latitude/);
  assert.match(sellerEditor, /aria-label="Mağaza görünüşünün ilkin baxışı"/);
  assert.match(sellerEditor, /Rəng mövzusu/);
});

test("public storefront is dynamic, uses shared eligibility, and keeps draft products private", () => {
  assert.match(storefrontPage, /export const dynamic = "force-dynamic"/);
  // The shared eligibility filter now arrives through publicStoreByIdOrSlugWhere (AND-combined with the id/slug match).
  assert.match(storefrontPage, /publicStoreByIdOrSlugWhere\(storeId\)/);
  assert.match(storefrontVisibility(), /export function publicStoreByIdOrSlugWhere[\s\S]*?publicStoreEligibilityBaseWhere\(now\)/);
  assert.match(storefrontPage, /isPublicStoreEligible\(store\)/);
  assert.match(storefrontPage, /publicProductVisibilityWhere/);
  assert.match(storefrontPage, /prisma\.product\.count\(\{ where: catalogWhere \}\)/);
  assert.match(storefrontPage, /Uyğun məhsul tapılmadı/);
  assert.match(storefrontPage, /Hazırda yayımlanmış məhsul yoxdur/);
  assert.match(storefrontPage, /isOwnedStoreAssetUrl\(store\.id,\s*store\.logoUrl\)/);
  assert.match(storefrontPage, /isOwnedStoreAssetUrl\(store\.id,\s*branding\.bannerUrl\)/);
  assert.match(storefrontPage, /category: \{ isActive: true \}/);
  assert.match(storefrontPage, /productCatalogOrderBy\(sort\)/);
  assert.match(storefrontPage, /skip,\s*take: STOREFRONT_PAGE_SIZE/);
  assert.match(storefrontPage, /storefrontPageHref\(store\.id,\s*currentPage \+ 1,\s*filterParams\)/);
  assert.match(storefrontPage, /AND: \[catalogWhere,\s*inStockProductWhere\]/);
  assert.match(storefrontPage, /products\.map\(\(product\) => \{\s*const campaign = promoted\.get\(product\.id\)/);
  assert.match(storefrontPage, /generateMetadata/);
  assert.match(storefrontCompatibilityPolicy(), /to_jsonb\(store_record\)/);
  assert.match(storefrontHeader, /Mağaza bölmələri/);
  // Contact: WhatsApp (new tab) and the message form; the store email is never rendered publicly.
  assert.match(storefrontHeader, /href=\{store\.whatsappUrl\} target="_blank" rel="noopener noreferrer"/);
  assert.match(storefrontHeader, /href="#store-message"/);
  assert.doesNotMatch(storefrontHeader, /mailto:|contactEmail/);
  assert.match(storefrontImage, /failedSrc === src/);
  assert.match(storefrontImage, /onError=\{\(\) => setFailedSrc\(src\)\}/);
  assert.match(productImage, /onError=\{\(\) => setFailedSources\(\(current\) => \[\.\.\.current, primarySrc\]\)\}/);
});

test("public store pages remain compatible before additive branding columns are migrated", () => {
  const discovery = readFileSync(resolve(root, "lib/public-store-discovery.ts"), "utf8");
  assert.match(storesDirectory, /findPublicStoreDiscoveryCursorPage/);
  assert.match(discovery, /id: true,\s*name: true,\s*slug: true,\s*description: true,\s*logoUrl: true,\s*latitude: true,\s*longitude: true/);
  assert.doesNotMatch(storesDirectory, /voen|legalAddress|contactEmail/);
  assert.doesNotMatch(storesDirectory, /include:\s*\{\s*city:/);
  assert.match(storefrontPage, /const storeSelect = \{[\s\S]*?description: true,[\s\S]*?logoUrl: true,[\s\S]*?contactPhone: true,/);
  assert.doesNotMatch(storefrontPage.slice(storefrontPage.indexOf("const storeSelect = {"), storefrontPage.indexOf("satisfies Prisma.StoreSelect")), /contactEmail: true/);
  assert.match(storefrontPage, /select: storeSelect/);
  assert.doesNotMatch(storefrontPage, /vendor:\s*\{\s*include:/);
  assert.match(storefrontPage, /getStorefrontBrandingCompatibility\(store\.id\)/);
  assert.match(brandingCompatibility, /to_jsonb\(store_record\)->>'bannerUrl'/);
  assert.match(brandingCompatibility, /to_jsonb\(store_record\)->>'theme'/);
  assert.match(storefrontPage, /theme:\s*branding\.theme\s*\?\?\s*"forest"/);
});

test("store, product-detail, and checkout queries do not implicitly select pending branding columns", () => {
  assert.doesNotMatch(storesDirectory, /include:\s*\{\s*city:/);
  assert.match(storefrontPage, /select:\s*\{\s*id:\s*true,\s*name:\s*true/);
  assert.match(productDetailPage, /store:\s*\{\s*select:\s*\{\s*id:\s*true,\s*name:\s*true/);
  assert.doesNotMatch(productDetailPage, /store:\s*\{\s*include:/);
  assert.match(checkoutPage, /store:\s*\{\s*select:\s*\{\s*id:\s*true,\s*name:\s*true,\s*freeDeliveryThreshold:true,deliveryFee:true/);
  assert.doesNotMatch(checkoutPage, /store:\s*\{\s*include:/);
});

test("admin store queries and activation mutations explicitly select schema-compatible fields", () => {
  assert.match(adminPage, /db\.store\.findMany\(\{where,select:/);
  assert.match(adminPage, /db\.store\.findUnique\(\{where:\{id\},select:/);
  assert.doesNotMatch(adminPage, /store:\s*\{\s*include:\s*\{\s*vendor:/);
  assert.match(activationRoute, /tx\.store\.update\(\{ where: \{ id: store\.id \}, data: visibilityUpdate, select: \{ id: true \} \}\)/);
});

test("store branding migration is additive and persisted on the Store model", () => {
  assert.match(schema, /bannerUrl\s+String\?/);
  assert.match(schema, /theme\s+String\s+@default\("forest"\)/);
  assert.match(migration, /ADD COLUMN "bannerUrl" TEXT/);
  assert.match(migration, /ADD COLUMN "theme" TEXT NOT NULL DEFAULT 'forest'/);
  assert.match(migration, /CHECK \("theme" IN \('forest', 'ocean', 'copper'\)\)/);
  assert.doesNotMatch(migration, /\b(DROP|DELETE|TRUNCATE)\b/i);
});

function storefrontCompatibilityPolicy() {
  return storesDirectory + storefrontPage + brandingCompatibility;
}
