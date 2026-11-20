/**
 * SELLER-DESIGN-1: seller-panel theme scope, the shared page header on every seller page, the grouped dashboard and
 * the status badges. Source checks read the files; the header is rendered with renderToStaticMarkup.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VendorPageHeader } from "../components/vendor-page-header";
import { approvalTone, orderStatusTone, paymentStatusTone, productStatusTone, returnStatusTone, storeStatusTone, subscriptionStatusTone } from "../lib/vendor-status-tone";

(globalThis as { React?: typeof React }).React = React;

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
function walk(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(root, path)).isDirectory() ? walk(path) : /\.(tsx?|css)$/.test(name) ? [path.replace(/\\/g, "/")] : [];
  });
}
const cssBlock = (css: string, selector: string) => css.slice(css.indexOf(selector), css.indexOf("}", css.indexOf(selector)));

// Pages behind the seller login. Login, register, e-mail verification and the customer "become a seller" form are
// entry pages, not the panel; [...section] is the old catch-all placeholder.
// SELLER-ALERTS: the notification-email verify page is opened from an email link without login, like verify-email.
const ENTRY_PAGES = new Set(["app/vendor/login/page.tsx", "app/vendor/register/page.tsx", "app/vendor/verify-email/page.tsx", "app/vendor/apply/page.tsx", "app/vendor/[...section]/page.tsx", "app/vendor/notification-email/verify/page.tsx"]);
const panelPages = () => walk("app/vendor").filter((path) => path.endsWith("/page.tsx") && !ENTRY_PAGES.has(path));
// A page that hands its whole body to one client component: the header lives in that component.
const DELEGATES: Record<string, string[]> = {
  "app/vendor/[storeId]/[section]/page.tsx": ["components/vendor-section.tsx"],
  "app/vendor/[storeId]/products/new/page.tsx": ["components/vendor-section.tsx"],
  "app/vendor/[storeId]/products/[productId]/page.tsx": ["components/vendor-product-editor.tsx"],
};
// VendorSection hands two sections to components that draw their own (shared) header.
const SECTION_COMPONENTS = ["components/vendor-orders.tsx", "components/vendor-returns.tsx"];

// ---------------------------------------------------------------------------------------------------------------
// Theme scope

test("seller scope: Inter + Fraunces, AA muted colour and green focus; the small text sizes stay at the :root values", () => {
  const css = read("app/globals.css");
  const scope = cssBlock(css, "body:has(> .bagati-vendor),");
  assert.match(scope, /\.bagati-vendor \{/);
  assert.match(scope, /--bagati-font-sans: var\(--bagati-font-inter/);
  assert.match(scope, /--bagati-font-serif: var\(--bagati-font-fraunces/);
  assert.match(scope, /--bagati-muted-green: #56706a;/);
  assert.match(scope, /--bagati-focus-outline: var\(--bagati-primary\);/);
  assert.match(scope, /font-family: var\(--bagati-font-sans\);/);
  // No global scale change: the panel keeps 12/14 px small text and every width.
  assert.doesNotMatch(scope, /--bagati-text-(xs|sm)/);
  assert.doesNotMatch(scope, /width|max-width|zoom|font-size/);
  // Page titles in Fraunces, scoped to the seller wrapper only.
  assert.match(css, /:where\(body:has\(> \.bagati-vendor\), \.bagati-vendor\) :where\(h1\) \{\n\s+font-family: var\(--bagati-font-serif\);/);
  // The public scope is untouched.
  const publicScope = cssBlock(css, "body:has(> .bagati-public),");
  assert.match(publicScope, /--bagati-text-sm: 0\.9375rem;/);
  assert.doesNotMatch(publicScope, /bagati-vendor/);
});

test("VendorTheme: a display:contents wrapper with its own font style tag, like PublicTheme", () => {
  const theme = read("components/vendor-theme.tsx");
  assert.match(theme, /import \{ fraunces, inter \} from "@\/app\/fonts\/public-fonts";/);
  assert.match(theme, /<div className="bagati-vendor contents">\{children\}<\/div>/, "no extra box: widths stay as before");
  assert.match(theme, /<style href="bagati-vendor-fonts" precedence="default">/);
  assert.doesNotMatch(theme, /bagati-public/);
});

test("the seller layout and the four portal pages render VendorTheme; admin, the public site and the root layout do not", () => {
  const layout = read("app/vendor/[storeId]/layout.tsx");
  assert.match(layout, /return <VendorTheme><div className="min-h-screen bg-surface-page text-fg-body">/);
  assert.match(layout, /<\/div><\/VendorTheme>;\n\}/);
  for (const path of ["app/vendor/page.tsx", "app/vendor/stores/new/page.tsx", "app/vendor/subscription/page.tsx", "app/vendor/security/page.tsx"]) {
    const source = read(path);
    assert.match(source, /<VendorTheme>/, path);
    assert.match(source, /<\/VendorTheme>/, path);
  }
  const outside = [...walk("app/admin"), ...walk("app/(customer)"), "app/layout.tsx", "components/admin-shell.tsx", "components/public-theme.tsx", "components/header.tsx", "components/customer-footer.tsx"];
  for (const path of outside) assert.doesNotMatch(read(path), /VendorTheme|vendor-theme|bagati-vendor/, path);
  for (const path of walk("components").filter((path) => /components\/admin-/.test(path))) assert.doesNotMatch(read(path), /VendorTheme|bagati-vendor/, path);
  // The seller panel still never renders the public theme.
  for (const path of walk("app/vendor")) assert.doesNotMatch(read(path), /PublicTheme|bagati-public/, path);
});

test("shell keeps its widths: 72 px header, 1600 px container, 248 px sidebar, same main padding", () => {
  const layout = read("app/vendor/[storeId]/layout.tsx");
  assert.match(layout, /mx-auto flex min-h-\[72px\] max-w-\[1600px\] items-center justify-between gap-3 px-4 sm:px-7 lg:px-8/);
  assert.match(layout, /<main className="mx-auto min-h-\[calc\(100vh-72px\)\] max-w-\[1600px\] p-4 sm:p-7 lg:ml-\[248px\] lg:p-9 xl:p-10">/);
  const nav = read("components/vendor-navigation.tsx");
  assert.match(nav, /fixed inset-y-\[73px\] left-0 z-20 hidden w-\[248px\]/);
  // Mobile menu: same toggle, dialog and close behaviour.
  assert.match(nav, /aria-expanded=\{open\} aria-controls="vendor-mobile-navigation"/);
  assert.match(nav, /id="vendor-mobile-navigation" role="dialog" aria-modal="true"/);
  assert.match(nav, /onClick=\{\(\) => mobile && setOpen\(false\)\}/);
  // Clear active state that is not colour alone: aria-current, bold text and a bar.
  assert.match(nav, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(nav, /bg-primary-tint font-semibold text-primary before:absolute/);
  assert.match(nav, /grid h-5 w-5 shrink-0 place-items-center/, "icons sit in a fixed box");
  for (const title of ["Mağaza", "Məhsullar", "Satış", "Hesab"]) assert.match(nav, new RegExp(`title: "${title}"`));
});

// ---------------------------------------------------------------------------------------------------------------
// Shared page header

test("VendorPageHeader: eyebrow, Fraunces h1 and description stacked on the left, the action on the right", () => {
  const markup = renderToStaticMarkup(h(VendorPageHeader, { eyebrow: "SATIŞ İDARƏETMƏSİ", title: "Məhsullarım", description: "Məlumatlar yalnız bu mağazaya aiddir.", action: h("a", { href: "/x" }, "+ Məhsul əlavə et") }));
  assert.match(markup, /^<header class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between" data-vendor-page-header="">/);
  // One left column holds all three texts, in order; the action is the header's second child.
  assert.match(markup, /<div class="min-w-0"><p class="text-kicker uppercase text-gold-700">SATIŞ İDARƏETMƏSİ<\/p><h1 class="break-words font-display text-h1 text-fg mt-1\.5">Məhsullarım<\/h1><p class="mt-1\.5 max-w-3xl text-sm text-fg-secondary">Məlumatlar yalnız bu mağazaya aiddir\.<\/p><\/div><div class="flex shrink-0 flex-wrap items-center gap-2"><a href="\/x">\+ Məhsul əlavə et<\/a><\/div><\/header>$/);
  assert.equal(markup.match(/<h1/g)?.length, 1);
  const bare = renderToStaticMarkup(h(VendorPageHeader, { title: "Söhbətlər" }));
  assert.doesNotMatch(bare, /text-kicker|<p class="mt-1\.5|shrink-0/);
});

test("every seller-panel page uses the shared header, and no seller page draws its own h1", () => {
  const pages = panelPages();
  assert.deepEqual(pages.sort(), [
    "app/vendor/[storeId]/[section]/page.tsx", "app/vendor/[storeId]/inquiries/page.tsx", "app/vendor/[storeId]/messages/[conversationId]/page.tsx",
    "app/vendor/[storeId]/messages/page.tsx", "app/vendor/[storeId]/orders/[storeOrderId]/page.tsx", "app/vendor/[storeId]/page.tsx",
    "app/vendor/[storeId]/products/[productId]/page.tsx", "app/vendor/[storeId]/products/new/page.tsx", "app/vendor/page.tsx",
    "app/vendor/security/page.tsx", "app/vendor/stores/new/page.tsx", "app/vendor/subscription/page.tsx",
  ].sort(), "a new seller page must be added here and use VendorPageHeader");
  for (const page of pages) {
    const holders = DELEGATES[page] ?? [page];
    for (const holder of holders) assert.match(read(holder), /<VendorPageHeader/, `${page} → ${holder}`);
  }
  for (const path of SECTION_COMPONENTS) assert.match(read(path), /<VendorPageHeader/, path);
  const section = read("components/vendor-section.tsx");
  assert.match(section, /if\(section==="orders"\)return <VendorOrders storeId=\{storeId\}\/>;/);
  assert.match(section, /if\(section==="returns"\)return <VendorReturns storeId=\{storeId\}\/>;/);
  // No other h1 anywhere in the seller panel: the header is the only one.
  const sources = [...pages, ...Object.values(DELEGATES).flat(), ...SECTION_COMPONENTS, ...walk("components").filter((path) => /components\/vendor-/.test(path) && path !== "components/vendor-page-header.tsx")];
  for (const path of new Set(sources)) assert.doesNotMatch(read(path), /<h1[\s>]/, path);
});

test("Məhsullarım: the header is no longer split across a flex row; the add button is the header action", () => {
  const section = read("components/vendor-section.tsx");
  assert.doesNotMatch(section, /<div className="flex flex-wrap items-end justify-between gap-4">\{heading\}/);
  assert.doesNotMatch(section, /<div>\{heading\}<\/div>/);
  assert.match(section, /const heading=<VendorPageHeader eyebrow="SATIŞ İDARƏETMƏSİ" title=\{title\} description="Məlumatlar yalnız bu mağazaya aiddir\." action=\{section==="products"\?<ButtonLink href=\{`\/vendor\/\$\{storeId\}\/products\/new`\} size="sm">\+ Məhsul əlavə et<\/ButtonLink>:undefined\}\/>;/);
  // SELLER-DESIGN-2: the products branch is a block now; the header still comes first, outside any flex row.
  assert.match(section, /if\(section==="products"\)\{const items=data\.items,[^;]+;return <>\{heading\}\n/);
});

// ---------------------------------------------------------------------------------------------------------------
// Dashboard

test("dashboard: same queries as before (latest 5 orders reused), three groups, quick actions, setup block kept", () => {
  const page = read("app/vendor/[storeId]/page.tsx");
  // The Promise.all list is unchanged: no new query was added for the redesign.
  assert.match(page, /const \[store, today, pending, returnRequests, completed, productTotal, activeProducts, recentOrders, products, stockRows, salesToday, newOrders, branding, recentNotifications\] = await Promise\.all\(\[/);
  assert.match(page, /db\.storeOrder\.findMany\(\{ where: \{ storeId \}, take: 5, orderBy: \{ createdAt: "desc" \}/);
  assert.equal(page.match(/\bdb\.\w+\.(findMany|findUnique|count|aggregate|findFirst)\(/g)?.length, 13, "13 reads, as on main");
  assert.doesNotMatch(page, /\b(create|update|upsert|delete)(Many)?\(/, "read-only page");
  for (const title of ["Sifarişlər", "Məhsullar", "Satış"]) assert.match(page, new RegExp(`title: "${title}", cards: \\[`));
  assert.match(page, /Tez əməliyyatlar/);
  for (const [label, href] of [["Məhsul əlavə et", "products/new"], ["Sifarişlər", "orders"], ["Anbar qalığı", "inventory"], ["Mağazam", "profile"]]) {
    assert.match(page, new RegExp(`\\{ label: "${label}", href: "${href.replace("/", "\\/")}", Icon: \\w+ \\}`));
  }
  assert.match(page, /panelHead\("Son fəaliyyət", "Son sifarişlər"/);
  assert.match(page, /recentOrders\.map\(/);
  assert.match(page, /aria-labelledby="setup-heading"/);
  assert.match(page, /role="progressbar" aria-label="Mağaza qurulumu"/);
  assert.doesNotMatch(page, /chart|recharts|<svg/i, "no charts that need new data");
  // All ten numbers are still there.
  for (const label of ["Yeni sifarişlər (cavab gözləyir)", "Bu gün sifarişlər", "Gözləyən sifarişlər", "Yeni qaytarılma sorğuları", "Məhsullar", "Aktiv məhsullar", "Az stok", "Stokda yoxdur", "Bu gün təhvil verilmiş satış", "Tamamlanmış sifarişlər"]) {
    assert.ok(page.includes(`{ label: "${label}", value: `), label);
  }
  assert.equal(page.match(/\{ label: "[^"]+", value: /g)?.length, 10);
});

test("dashboard: the warning style is set only when the number is above 0", () => {
  const page = read("app/vendor/[storeId]/page.tsx");
  assert.match(page, /value: newOrders, href: "orders", Icon: ClipboardList, attention: newOrders > 0 \? "warning" : null/);
  assert.match(page, /value: returnRequests, href: "returns", Icon: RotateCcw, attention: returnRequests > 0 \? "warning" : null/);
  assert.match(page, /value: lowStock, href: "inventory", Icon: AlertTriangle, attention: lowStock > 0 \? "warning" : null/);
  assert.match(page, /value: outOfStock, href: "inventory", Icon: ShoppingBag, attention: outOfStock > 0 \? "danger" : null/);
  assert.equal(page.match(/attention: /g)?.length, 4, "only the four attention numbers");
  assert.match(page, /data-attention=\{attention \?\? undefined\}/);
});

// ---------------------------------------------------------------------------------------------------------------
// Badges

test("Mağazam: one badge per status instead of the duplicated \"Aktiv · Aktiv\"", () => {
  const editor = read("components/vendor-store-profile-editor.tsx");
  assert.doesNotMatch(editor, /\{storeStatusLabels\[store\.status\]\|\|"Status məlum deyil"\} · \{store\.subscription/);
  assert.match(editor, /<Badge tone=\{storeStatusTone\(store\.status,store\.isActive\)\}>Mağaza: \{storeStatusLabels\[store\.status\]/);
  assert.match(editor, /`Abunəlik: \$\{subscriptionStatusLabels\[store\.subscription\.status\]/);
});

test("status pills in the seller panel use the components/ui Badge", () => {
  const files = ["app/vendor/[storeId]/layout.tsx", "app/vendor/[storeId]/page.tsx", "app/vendor/[storeId]/orders/[storeOrderId]/page.tsx", "app/vendor/[storeId]/inquiries/page.tsx", "app/vendor/page.tsx", "components/vendor-orders.tsx", "components/vendor-returns.tsx", "components/vendor-store-profile-editor.tsx", "components/vendor-inventory-panel.tsx", "components/vendor-campaign-manager.tsx", "components/vendor-product-editor.tsx", "components/vendor-section.tsx"];
  for (const path of files) {
    const source = read(path);
    assert.match(source, /import \{ Badge \} from "@\/components\/ui\/badge";/, path);
    // The old hand-made pills (bg-emerald-50 / bg-amber-50 / bg-[#f3f1eb] rounded-full status spans) are gone.
    assert.doesNotMatch(source, /rounded-full[^"`]*bg-(emerald|amber)-50|bg-(emerald|amber)-50[^"`]*rounded-full|rounded-full bg-\[#f3f1eb\] px-(2\.5|3) py-(1|1\.5|2) text-(xs|sm) font-medium/, path);
  }
});

test("status tones: attention gold, done green, stopped red, the rest neutral", () => {
  assert.equal(orderStatusTone("NEW"), "gold");
  assert.equal(orderStatusTone("PENDING"), "gold");
  assert.equal(orderStatusTone("PREPARING"), "neutral");
  assert.equal(orderStatusTone("DELIVERED"), "primary");
  assert.equal(orderStatusTone("CANCELLED"), "danger");
  assert.equal(storeStatusTone("ACTIVE"), "primary");
  assert.equal(storeStatusTone("ACTIVE", false), "gold");
  assert.equal(storeStatusTone("PENDING_REVIEW"), "gold");
  assert.equal(storeStatusTone("REJECTED"), "danger");
  assert.equal(storeStatusTone("DRAFT"), "neutral");
  assert.equal(subscriptionStatusTone("ACTIVE"), "primary");
  assert.equal(subscriptionStatusTone("PAST_DUE"), "gold");
  assert.equal(subscriptionStatusTone("EXPIRED"), "danger");
  assert.equal(subscriptionStatusTone(null), "neutral");
  assert.equal(productStatusTone("ACTIVE"), "primary");
  assert.equal(productStatusTone("DRAFT"), "gold");
  assert.equal(productStatusTone("ARCHIVED"), "neutral");
  assert.equal(returnStatusTone("REQUESTED"), "gold");
  assert.equal(returnStatusTone("REFUNDED"), "primary");
  assert.equal(returnStatusTone("REJECTED"), "danger");
  assert.equal(paymentStatusTone("PAID"), "primary");
  assert.equal(paymentStatusTone("FAILED"), "danger");
  assert.equal(paymentStatusTone("PENDING"), "gold");
  assert.equal(approvalTone("success"), "primary");
  assert.equal(approvalTone("pending"), "gold");
  assert.equal(approvalTone("danger"), "danger");
  assert.equal(approvalTone("neutral"), "neutral");
});

test("legal acceptance stays as it was: the consent checkbox and seller-terms card are not restyled", () => {
  for (const path of ["components/legal-consent-checkbox.tsx", "components/seller-terms-card.tsx"]) {
    assert.doesNotMatch(read(path), /VendorPageHeader|vendor-status-tone|bagati-vendor/, path);
  }
  // Still rendered above every store page until the current terms are accepted.
  assert.match(read("app/vendor/[storeId]/layout.tsx"), /\{!sellerTermsAccepted && <div className="mb-6"><SellerTermsCard\/><\/div>\}\{children\}/);
});
