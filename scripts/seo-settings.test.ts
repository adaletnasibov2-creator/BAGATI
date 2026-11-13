import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { META_DESCRIPTION_MAX, rootMetadata, shortenMetaText, storeMetaDescription } from "../lib/seo";
import { getSettingDefinition, SETTING_KEYS } from "../lib/settings/registry";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const defaultDescription = getSettingDefinition(SETTING_KEYS.seoDefaultDescription)!.default as string;
const defaultTemplate = getSettingDefinition(SETTING_KEYS.seoStoreDescriptionTemplate)!.default as string;

test("root metadata with the defaults is exactly what the layout returned before (no Open Graph)", () => {
  const metadata = rootMetadata({ siteName: "BAGATI Marketplace", logoUrl: null, description: defaultDescription, ogTitle: null, ogDescription: null });
  assert.deepEqual(metadata, {
    title: { default: "BAGATI Marketplace", template: "%s | BAGATI Marketplace" },
    description: "Azərbaycan mağazalarını və məhsullarını bir marketplace-də kəşf edin.",
    applicationName: "BAGATI Marketplace",
    icons: { icon: "/icon.svg", shortcut: "/icon.svg" },
  });
  assert.equal("openGraph" in metadata, false, "empty = no Open Graph tags");
});

test("Open Graph appears only for the fields the admin filled in", () => {
  const both = rootMetadata({ siteName: "BAGATI", logoUrl: "/uploads/vendors/admin-home/logo.png", description: "Təsvir", ogTitle: "BAGATI — Azərbaycan marketplace", ogDescription: "Mağazalar və məhsullar" });
  assert.deepEqual(both.openGraph, { title: "BAGATI — Azərbaycan marketplace", description: "Mağazalar və məhsullar", siteName: "BAGATI", type: "website" });
  const titleOnly = rootMetadata({ siteName: "BAGATI", logoUrl: null, description: "Təsvir", ogTitle: "Başlıq", ogDescription: null });
  assert.deepEqual(titleOnly.openGraph, { title: "Başlıq", siteName: "BAGATI", type: "website" });
  assert.equal(titleOnly.description, "Təsvir");
});

test("store description: own description first; otherwise the template with the name inserted literally; max 160", () => {
  assert.equal(storeMetaDescription({ template: defaultTemplate, storeName: "Aysel Home", storeDescription: null }), "Məhsulları Aysel Home mağazasından BAGATI marketplace-də kəşf edin.");
  assert.equal(storeMetaDescription({ template: defaultTemplate, storeName: "Aysel Home", storeDescription: "  Əl işi ev aksesuarları  " }), "Əl işi ev aksesuarları");
  assert.equal(storeMetaDescription({ template: defaultTemplate, storeName: "X", storeDescription: "a".repeat(400) }).length, 160, "same as before for own descriptions");
  // "$&" and "$1" in a store name are not replacement patterns.
  assert.equal(storeMetaDescription({ template: "{store} BAGATI-da", storeName: "Ucuz $& $1 Mağaza", storeDescription: null }), "Ucuz $& $1 Mağaza BAGATI-da");
  const long = storeMetaDescription({ template: `${"Ə".repeat(200)} {store}`, storeName: "Mağaza", storeDescription: null });
  assert.equal(long.length, META_DESCRIPTION_MAX);
  assert.ok(long.endsWith("…"));
  assert.equal(shortenMetaText("  a \n b  "), "a b");
});

test("wiring: root metadata and the store page read the SEO settings through the cached, fail-safe read path", () => {
  const layout = read("app/layout.tsx");
  assert.match(layout, /getSetting<string>\(SETTING_KEYS\.seoDefaultDescription\)/);
  assert.match(layout, /getSetting<string>\(SETTING_KEYS\.seoDefaultOgTitle\)/);
  assert.match(layout, /getSetting<string>\(SETTING_KEYS\.seoDefaultOgDescription\)/);
  assert.match(layout, /return rootMetadata\(\{ siteName: settings\.siteName, logoUrl: settings\.logoUrl, description: description \?\? "", ogTitle, ogDescription \}\);/);
  const store = read("app/(customer)/stores/[storeId]/page.tsx");
  assert.match(store, /storeMetaDescription\(\{ template: template \?\? "", storeName: store\.name, storeDescription: store\.description \}\)/);
  assert.match(store, /openGraph: \{\s*title: store\.name,\s*description,/);
});
