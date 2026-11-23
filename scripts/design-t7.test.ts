/**
 * DESIGN-T7: store page, customer account area, and the three small fixes (admin switch wording, search room at
 * 768 px, no empty review section). Source checks read the files; the shared pieces are rendered with
 * renderToStaticMarkup. The real-browser check is in release-output/design-t7/.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountPageHeader } from "../components/account-shell";
import { StoreCard } from "../components/store-card";
import { MAINTENANCE_TOGGLE_ON_LABEL, toggleLabels } from "../lib/settings/admin";
import { getSettingDefinition } from "../lib/settings/registry";

(globalThis as { React?: typeof React }).React = React;

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");

// ---------------------------------------------------------------------------------------------------------------
// Fix (a): admin switch wording

test("admin switch: each switch shows its own on/off text; only maintenance keeps 'saving closes the site'", () => {
  const def = (key: string) => getSettingDefinition(key)!;
  assert.deepEqual(toggleLabels(def("maintenance.enabled")), { on: "Açıq (yadda saxladıqda sayt bağlanır)", off: "Söndürülüb" });
  assert.deepEqual(toggleLabels(def("messaging.enabled")), { on: "Açıqdır — mesajlaşma işləyir", off: "Söndürülüb — mesajlaşma bağlıdır" });
  assert.deepEqual(toggleLabels(def("messaging.allowContactDetails")), { on: "Açıqdır — telefon və e-poçt paylaşmaq olar", off: "Söndürülüb — telefon və e-poçt olan mesaj göndərilmir" });
  for (const key of ["catalog.showEmptyCategories", "orders.customerCancellationEnabled", "orders.unpaidExpiryEnabled"]) {
    const labels = toggleLabels(def(key))!;
    assert.notEqual(labels.on, MAINTENANCE_TOGGLE_ON_LABEL, key);
    assert.doesNotMatch(labels.on, /sayt bağlanır/, key);
  }
  assert.equal(toggleLabels(def("orders.unpaidExpiryMinutes")), null, "not a switch");
  const field = read("components/admin-setting-field.tsx");
  assert.doesNotMatch(field, /sayt bağlanır/, "no hard-coded maintenance text in the generic control");
  assert.match(field, /<span>\{value === "true" \? view\.toggleLabels\?\.on \?\? "Açıq" : view\.toggleLabels\?\.off \?\? "Söndürülüb"\}<\/span>/);
  assert.match(read("lib/settings/admin.ts"), /toggleLabels: toggleLabels\(definition\),/);
});

// ---------------------------------------------------------------------------------------------------------------
// Fix (b): search room at 768 px

test("header at 768-1023 px: the city selector moves to the section row, so search keeps the main row", () => {
  const header = read("components/header.tsx");
  assert.match(header, /<div className="hidden shrink-0 lg:block">\n\s*<CitySelector cities=\{cities\} \/>/, "main row: from 1024 px only");
  assert.doesNotMatch(header, /<div className="hidden shrink-0 md:block">\n\s*<CitySelector/);
  assert.match(header, /\{cities\.length > 0 && <div data-header-city-tablet="" className="ml-auto shrink-0 lg:hidden"><CitySelector cities=\{cities\} \/><\/div>\}\n\s*<\/nav>/);
  // The section row itself is unchanged (pinned by design-header-footer.test.ts too).
  assert.match(header, /<nav aria-label="Alış-veriş bölmələri" className="hidden border-t border-line py-1 md:flex md:items-center md:gap-1">/);
  // Search still takes the free width.
  assert.match(header, /<div className="hidden min-w-0 flex-1 md:block">\n\s*<SearchForm categories=\{categories\} \/>/);
});

// ---------------------------------------------------------------------------------------------------------------
// Fix (c): reviews

test("product page: the review section renders only when real reviews exist; no empty-state text, no new ratings", () => {
  const page = read("app/(customer)/products/[productId]/page.tsx");
  assert.match(page, /\{product\.reviews\.length > 0 && <section className="[^"]*" aria-labelledby="product-reviews-title">/);
  assert.doesNotMatch(page, /Bu məhsul üçün hələ rəy yoxdur/);
  assert.equal(page.match(/★/g)?.length, 2, "the stars stay inside the existing list of real reviews only");
  assert.doesNotMatch(read("components/product-card.tsx"), /rating|reviews/i, "cards still show no ratings");
});

// ---------------------------------------------------------------------------------------------------------------
// Store page

test("store header: cover and logo with fallbacks, Fraunces name, city/address, short description, green focus", () => {
  const branding = read("components/storefront-branding.tsx");
  assert.match(branding, /aspect-\[16\/7\] w-full overflow-hidden sm:aspect-\[4\/1\] lg:aspect-auto lg:h-72/, "fixed cover box: no layout shift");
  assert.match(branding, /fallback=\{<CoverFallback/);
  assert.match(branding, /fallback=\{<span className="grid h-full w-full place-items-center text-3xl font-semibold"/, "logo initial fallback");
  // STORE-HOURS: + min-w-0 (the h1 now sits in a flex row next to the hours dot).
  assert.match(branding, /<h1 className="min-w-0 break-words font-display text-h1 text-fg">\{store\.name\}<\/h1>/);
  assert.match(branding, /\{store\.address \|\| store\.cityName\}/);
  assert.match(branding, /\{store\.description && <p data-store-short-description="" className="mt-2 line-clamp-2/);
  assert.doesNotMatch(branding, /#C79A52/, "old gold accent replaced by tokens");
  const page = read("app/(customer)/stores/[storeId]/page.tsx");
  // STORE-HOURS: + hours (information-only line and dot); \r?\n for a CRLF working copy on Windows.
  assert.match(page, /description,\r?\n\s*address: formatStoreAddress\(store\.address, store\.city\.name\),\r?\n\s*hours: storeHoursOf\(store\),\r?\n\s*\} satisfies StorefrontBrand\}\/>/);
  for (const path of ["components/storefront-branding.tsx", "components/storefront-contact.tsx", "app/(customer)/stores/[storeId]/page.tsx"]) {
    assert.doesNotMatch(read(path), /outline-\[#C79A52\]/, `${path}: green focus ring`);
  }
});

test("store page: categories, catalogue, existing paging, and the shared empty state with the same three actions", () => {
  const page = read("app/(customer)/stores/[storeId]/page.tsx");
  assert.match(page, /<EmptyState\n\s*className="border-dashed"\n\s*icon=\{<PackageOpen size=\{26\}\/>\}\n\s*title="Mağaza hələ məhsul yayımlamayıb"/);
  for (const text of ["WhatsApp ilə yaz", '{messageHref ? "Mağazaya yaz" : "Mesaj yaz"}', "Digər mağazalara bax"]) assert.ok(page.includes(text), text);
  assert.match(page, /rel="prev" className=\{buttonClass\(\{ variant: "secondary", size: "sm" \}\)\}>Əvvəlki<\/Link>/);
  assert.match(page, /rel="next" className=\{buttonClass\(\{ variant: "secondary", size: "sm" \}\)\}>Növbəti<\/Link>/);
  assert.match(page, /const STOREFRONT_PAGE_SIZE = 24;/, "same paging");
  assert.match(page, /<ProductGrid\n\s*products=\{storefrontProducts\}/, "existing product cards");
  assert.match(read("components/product-grid.tsx"), /<EmptyState icon=\{<PackageSearch size=\{24\}\/>\} title=\{emptyTitle\} description=\{emptyDetail\}\/>/);
});

test("stores list card: aligned with the store header (initial fallback, tokens, focus ring), same texts", () => {
  const withLogo = renderToStaticMarkup(h(StoreCard, { id: "s1", name: "Aysel Zərgərlik", city: "Bakı", description: "Əl işi", logoUrl: "/logo.png", hasLocation: true }));
  assert.match(withLogo, /rounded-card border border-line/);
  assert.match(withLogo, /focus-visible:outline-focus/);
  assert.match(withLogo, />Aktiv mağaza</);
  const noLogo = renderToStaticMarkup(h(StoreCard, { id: "s1", name: "aysel", city: "Bakı" }));
  assert.match(noLogo, /<span aria-hidden="true" class="font-display text-xl font-semibold text-primary">A<\/span>/);
});

// ---------------------------------------------------------------------------------------------------------------
// Account area

const ACCOUNT_PAGES = [
  "app/(customer)/account/page.tsx",
  "app/(customer)/account/[...section]/page.tsx",
  "app/(customer)/account/returns/page.tsx",
  "app/(customer)/account/messages/page.tsx",
  "app/(customer)/account/messages/new/page.tsx",
  "app/(customer)/account/messages/[conversationId]/page.tsx",
  "app/(customer)/orders/page.tsx",
  "app/(customer)/orders/[orderId]/page.tsx",
  "app/(customer)/favorites/page.tsx",
];

test("every account page uses the one AccountShell (navigation + shared header); no page draws its own h1 or nav", () => {
  for (const path of ACCOUNT_PAGES) {
    const source = read(path);
    assert.match(source, /<AccountShell /, path);
    assert.doesNotMatch(source, /<AccountNavigation /, `${path}: navigation only through the shell`);
    if (path !== "app/(customer)/favorites/page.tsx") assert.doesNotMatch(source, /<h1[\s>]/, `${path}: header only through the shell`);
    assert.match(source, /customerMessagesBadge\(user\.id\)|messagesUnread=\{unread\}/, `${path}: "Mesajlarım" badge as on the other pages`);
  }
  // Favorites works without login (localStorage): only a signed-in customer gets the account layout.
  assert.match(read("app/(customer)/favorites/page.tsx"), /if \(user\?\.role === "CUSTOMER"\) \{/);
  const shell = read("components/account-shell.tsx");
  assert.match(shell, /lg:grid-cols-\[248px_minmax\(0,1fr\)\]/);
  assert.doesNotMatch(shell, /sticky/, "the side navigation never slides under the sticky site header");
  const nav = read("components/account-navigation.tsx");
  assert.match(nav, /const items = messagesUnread === null \? links : \[\.\.\.links\.slice\(0, 2\), messagesLink, \.\.\.links\.slice\(2\)\];/);
  assert.match(nav, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(nav, /focus-visible:outline-focus/);
  // The mobile pill row bleeds exactly to the container gutter (14 px up to 640 px, 28 px above): no sideways scroll at 390.
  assert.match(nav, /-mx-\[14px\] flex gap-2 overflow-x-auto px-\[14px\] pb-1 min-\[641px\]:-mx-7 min-\[641px\]:px-7/);
});

test("AccountPageHeader: kicker (Hesabım link by default), Fraunces h1, description and action", () => {
  const markup = renderToStaticMarkup(h(AccountPageHeader, { title: "Sifarişlərim", description: "Bir sətir.", action: h("a", { href: "/x" }, "X") }));
  assert.match(markup, /<header data-account-page-header="" class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">/);
  assert.match(markup, /<a class="rounded-sm hover:text-primary [^"]*" href="\/account">Hesabım<\/a>/);
  assert.match(markup, /<h1 class="mt-1\.5 break-words font-display text-h1 text-fg">Sifarişlərim<\/h1>/);
  assert.match(markup, /<p class="mt-1\.5 max-w-3xl text-sm text-fg-secondary">Bir sətir\.<\/p>/);
});

test("account content: order cards with status badges, address cards, shared empty states, consistent forms", () => {
  const orders = read("app/(customer)/orders/page.tsx");
  assert.match(orders, /<Badge tone=\{orderStatusTone\(order\.status\)\}>\{statusLabel\(order\.status\)\}<\/Badge>/);
  assert.match(orders, /<Badge tone=\{paymentStatusTone\(order\.payments\[0\]\?\.status\)\}>\{paymentStatusLabel\(order\.payments\[0\]\?\.status\)\}<\/Badge>/);
  assert.match(orders, /<EmptyState icon=\{<Package size=\{24\}\/>\} title=\{validCursor \? "Bu səhifədə sifariş yoxdur" : "Hələ sifariş yoxdur"\}/);
  const detail = read("app/(customer)/orders/[orderId]/page.tsx");
  assert.match(detail, /\{cancellationEnabled&&<OrderCancelActions orderId=\{order\.id\} direct=\{cancelView\.direct\} storeOrders=\{cancelRows\}\/>\}/);
  assert.match(detail, /<Badge tone=\{orderStatusTone\(group\.status\)\}>\{statusLabel\(group\.status\)\}<\/Badge>/);
  const overview = read("app/(customer)/account/page.tsx");
  assert.match(overview, /<Badge tone=\{orderStatusTone\(order\.status\)\}>\{statusLabel\(order\.status\)\}<\/Badge>/);
  const addresses = read("components/address-book-client.tsx");
  assert.match(addresses, /data-account-address-card=""/);
  assert.match(addresses, /\{item\.recipientName\} · \{item\.phone\}/, "broken '?' separator from the initial import fixed");
  assert.doesNotMatch(addresses, /\} \? \{item\.phone\}|" \? "\+item\.postalCode/);
  assert.match(read("components/notifications.tsx"), /<EmptyState icon=\{<Bell size=\{24\}\/>\} title="Bildiriş yoxdur" description="Yeni bildirişlər burada görünəcək\."\/>/);
  const favorites = read("components/favorites-client.tsx");
  assert.match(favorites, /<EmptyState className="flex min-h-\[18rem\] flex-col justify-center" icon=\{<Heart size=\{24\}\/>\} title="Sevimli məhsul yoxdur"/);
  assert.match(favorites, /<SkeletonRegion label="Sevimlilər yüklənir…"><Skeleton rounded="card" className="min-h-\[18rem\]"\/><\/SkeletonRegion>/, "same height as the empty state: no shift");
  for (const path of ["components/address-book-client.tsx", "components/profile-form.tsx", "components/customer-returns.tsx"]) {
    assert.match(read(path), /controlClass\(\)/, `${path}: shared inputs`);
    assert.match(read(path), /buttonClass\(/, `${path}: shared buttons`);
  }
  assert.match(read("components/customer-returns.tsx"), /<Badge tone=\{returnStatusTone\(item\.status\)\} className="h-fit">\{returnStatusLabel\(item\.status\)\}<\/Badge>/);
});

// ---------------------------------------------------------------------------------------------------------------
// Site rules

test("site rules: no new payment, free-delivery or rating claims in the changed public files", () => {
  const files = [...ACCOUNT_PAGES, "components/account-shell.tsx", "components/account-navigation.tsx", "components/storefront-branding.tsx", "components/storefront-contact.tsx", "app/(customer)/stores/[storeId]/page.tsx", "components/store-card.tsx", "components/product-grid.tsx", "components/address-book-client.tsx", "components/notifications.tsx", "components/profile-form.tsx", "components/customer-returns.tsx", "components/favorites-client.tsx", "components/header.tsx"];
  for (const path of files) {
    const source = read(path);
    assert.doesNotMatch(source, /kartla ödə|kart ilə ödə|onlayn ödəyin|pulsuz|★|reytinq|ulduz|\bUSD\b|\bEUR\b/i, path);
  }
});
