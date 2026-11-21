/**
 * DESIGN-T6: the header menu bug (closing rules), the product page (gallery, buy box, mobile buy bar), the cart and
 * checkout restyle, and the site rules (no new payment, free-delivery or rating claims). Source checks read the files;
 * the closing rules and the gallery are exercised directly. The real-browser check is in release-output/design-t6/.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { closeOnEscape, closeOnLinkActivation, closeOnNavigation, closeOnOutsidePress, type DetailsLike } from "../components/use-dismissible-details";
import ProductGallery from "../components/product-gallery";
import { CartSummary } from "../components/cart-summary";

(globalThis as { React?: typeof React }).React = React;

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");

// ---------------------------------------------------------------------------------------------------------------
// Part 1: the menu bug

function fakeDetails(open = true) {
  const inside = new Set<unknown>();
  let focused = 0;
  const details: DetailsLike & { inside: Set<unknown>; focused: () => number } = {
    open,
    inside,
    contains: (node) => inside.has(node),
    querySelector: (selector) => (selector === "summary" ? { focus: () => { focused++; } } : null),
    focused: () => focused,
  };
  return details;
}

test("menu closes on a press outside, not inside", () => {
  const details = fakeDetails();
  const insideNode = {};
  details.inside.add(insideNode);
  assert.equal(closeOnOutsidePress(details, insideNode), false);
  assert.equal(details.open, true);
  assert.equal(closeOnOutsidePress(details, {}), true);
  assert.equal(details.open, false);
  assert.equal(closeOnOutsidePress(details, {}), false, "already closed: nothing to do");
});

test("menu closes on Escape and focus goes back to its button; other keys do nothing", () => {
  const details = fakeDetails();
  assert.equal(closeOnEscape(details, "Tab"), false);
  assert.equal(details.open, true);
  assert.equal(closeOnEscape(details, "Escape"), true);
  assert.equal(details.open, false);
  assert.equal(details.focused(), 1, "summary focused");
  assert.equal(closeOnEscape(details, "Escape"), false, "a closed menu does not take Escape (or focus)");
  assert.equal(details.focused(), 1);
});

test("menu closes when a link inside is activated, not on other clicks (e.g. a subcategory chevron)", () => {
  const details = fakeDetails();
  assert.equal(closeOnLinkActivation(details, { closest: () => null }), false);
  assert.equal(details.open, true);
  assert.equal(closeOnLinkActivation(details, { closest: (selector) => (selector === "a[href]" ? {} : null) }), true);
  assert.equal(details.open, false);
});

test("menu closes on route change and Back/Forward without moving focus", () => {
  const details = fakeDetails();
  assert.equal(closeOnNavigation(details), true);
  assert.equal(details.open, false);
  assert.equal(details.focused(), 0);
  assert.equal(closeOnNavigation(null), false);
});

test("the hook is wired: pathname effect, document listeners while open, link clicks, and both header menus use it", () => {
  const hook = read("components/use-dismissible-details.ts");
  assert.match(hook, /useEffect\(\(\) => \{ closeOnNavigation\(ref\.current\); \}, \[pathname\]\);/);
  assert.match(hook, /document\.addEventListener\("pointerdown", onPointerDown\);/);
  assert.match(hook, /document\.addEventListener\("keydown", onKeyDown\);/);
  assert.match(hook, /window\.addEventListener\("popstate", onPopState\);/);
  assert.match(hook, /document\.removeEventListener\("pointerdown", onPointerDown\);/, "listeners removed when closed");
  const mega = read("components/category-mega-menu.tsx");
  assert.match(mega, /const menu = useDismissibleDetails\(\(\) => setActiveId\(null\)\);/);
  assert.match(mega, /<details ref=\{menu\.ref\} className="group relative" onToggle=\{menu\.onToggle\} onClick=\{menu\.onClick\}>/);
  const account = read("components/customer-account-menu.tsx");
  assert.match(account, /const menu = useDismissibleDetails\(\);/);
  assert.match(account, /<details ref=\{menu\.ref\} className="group relative" onToggle=\{menu\.onToggle\} onClick=\{menu\.onClick\}>/);
  assert.ok(account.indexOf("useDismissibleDetails()") < account.indexOf("if (!user) return"), "hook called before the early return");
  const mobile = read("components/mobile-menu.tsx");
  assert.match(mobile, /useEffect\(\(\) => \{ setOpen\(false\); \}, \[pathname\]\);/);
  assert.match(mobile, /window\.addEventListener\("popstate", close\);/);
});

// ---------------------------------------------------------------------------------------------------------------
// Product page

test("gallery: square stage (no layout shift), prev/next with labels, counter, roving-tabindex thumbnails", () => {
  const markup = renderToStaticMarkup(h(ProductGallery, { images: ["/a.webp", "/b.webp", "/c.webp"], name: "Üzük" }));
  assert.match(markup, /class="relative flex aspect-square max-h-\[680px\]/);
  assert.match(markup, /aria-label="Əvvəlki şəkil"/);
  assert.match(markup, /aria-label="Növbəti şəkil"/);
  assert.match(markup, />1 \/ 3<\/span>/);
  assert.match(markup, /role="group" aria-label="Məhsul şəkilləri"/);
  assert.equal(markup.match(/tabindex="0"/g)?.length, 1, "one thumbnail in the tab order");
  assert.equal(markup.match(/tabindex="-1"/g)?.length, 2);
  assert.match(markup, /aria-pressed="true"/);
  const single = renderToStaticMarkup(h(ProductGallery, { images: ["/a.webp"], name: "Üzük" }));
  assert.doesNotMatch(single, /Əvvəlki şəkil|role="group"/);
  const source = read("components/product-gallery.tsx");
  assert.match(source, /const keys: Record<string, number> = \{ ArrowRight: selected \+ 1, ArrowLeft: selected - 1, Home: 0, End: images\.length - 1 \};/);
});

test("buy box: same add-to-cart request and rules; stepper, large button, store link, stock state", () => {
  const box = read("components/product-variant-purchase.tsx");
  assert.match(box, /fetch\("\/api\/cart\/items", \{ method: "POST", headers: \{ "Content-Type": "application\/json" \}, body: JSON\.stringify\(\{ productId, \.\.\.\(selectedVariant \? \{ variantId: selectedVariant\.id \} : \{\}\), quantity \}\) \}\)/);
  assert.match(box, /setQuantity\(Number\.isFinite\(value\) \? Math\.max\(1, Math\.min\(maxQuantity \|\| 1, Math\.floor\(value\)\)\) : 1\)/, "same clamping");
  assert.match(box, /aria-label="Miqdarı azalt"/);
  assert.match(box, /aria-label="Miqdarı artır"/);
  assert.match(box, /<label className="sr-only" htmlFor="product-quantity">Miqdar<\/label>/);
  assert.match(box, /className=\{cx\(buttonClass\(\{ size: "lg" \}\), "min-w-0 flex-1"\)\}><ShoppingBag aria-hidden="true" size=\{18\}\/>\{addLabel\}<\/button>/);
  assert.match(box, /<Link href=\{`\/stores\/\$\{store\.id\}`\}/);
  assert.match(box, /`Stokda \$\{selectedStock\} ədəd` : "Tükənib"/);
  assert.match(box, /aria-pressed=\{active\}/);
});

test("mobile buy bar: sticky slot with reserved height above the bottom nav, hidden from 1024 px, focus kept clear", () => {
  const page = read("app/(customer)/products/[productId]/page.tsx");
  assert.match(page, /<div id=\{PRODUCT_BUY_BAR_SLOT_ID\} className="sticky bottom-\[calc\(62px\+env\(safe-area-inset-bottom\)\)\] z-30 [^"]*min-h-\[76px\][^"]*md:bottom-0 lg:hidden"\/>/);
  assert.doesNotMatch(page.slice(page.indexOf("PRODUCT_BUY_BAR_SLOT_ID}")), /fixed /, "sticky, not fixed: it rests before the footer");
  const box = read("components/product-variant-purchase.tsx");
  assert.match(box, /export const PRODUCT_BUY_BAR_SLOT_ID = "product-buy-bar-slot";/);
  assert.match(box, /\{slot && createPortal\(<div data-product-buy-bar=""/);
  assert.match(box, /onClick=\{\(\) => void add\(\)\} disabled=\{!canAdd\}/);
  // The bottom nav is 62 px tall below 768 px (components/mobile-bottom-nav.tsx).
  assert.match(read("components/mobile-bottom-nav.tsx"), /min-h-\[62px\]/);
  assert.match(read("app/globals.css"), /@media \(max-width: 1023px\) \{\n  html:has\(#product-buy-bar-slot\) \{\n    scroll-padding-bottom: 9rem;/);
});

test("product page: description readable, store card, delivery/returns from existing settings, no new queries", () => {
  const page = read("app/(customer)/products/[productId]/page.tsx");
  assert.match(page, /max-w-\[68ch\] whitespace-pre-wrap break-words text-body-lg leading-8/);
  assert.match(page, /siteSettings\.deliveryInfo/);
  assert.match(page, /siteSettings\.returnsInfo/);
  assert.equal(page.match(/prisma\.\w+\.(findFirst|findMany|findUnique|count)\(/g)?.length, 1, "still one product query");
  assert.doesNotMatch(page, /Mağazaya keç/, "no new wording");
});

// ---------------------------------------------------------------------------------------------------------------
// Cart and checkout

test("cart: grouped by store, 44 px stepper, remove button, summary card, EmptyState from components/ui; same API calls", () => {
  const cart = read("components/cart-page-client.tsx");
  assert.match(cart, /import \{ EmptyState \} from "@\/components\/ui\/empty-state";/);
  assert.match(cart, /title="Səbətiniz boşdur" description="Mağazalara baxın və bəyəndiyiniz məhsulları səbətə əlavə edin\."/);
  assert.match(cart, /data-cart-store=""/);
  assert.match(cart, /data-cart-summary=""/);
  assert.match(cart, /grid h-11 w-11 place-items-center/);
  assert.match(cart, /aria-label="Məhsulu səbətdən sil"/);
  assert.match(cart, /fetch\(`\/api\/cart\/items\/\$\{item\.id\}`, quantity === undefined \? \{ method: "DELETE" \} : \{ method: "PATCH"/);
  assert.match(cart, /href=\{canCheckout \? "\/checkout" : "\/cart"\}/);
  assert.match(cart, />Sifarişi rəsmiləşdir<\/Link>/);
  // No layout shift on load (measured 0.03-0.18 before): loading, empty and loaded views share one tall box, and the
  // loading view is a cart-shaped skeleton under the same heading.
  assert.match(cart, /const CART_PAGE = "container min-h-\[80svh\] py-10 md:py-14";/);
  assert.equal(cart.match(/<div className=\{CART_PAGE\}>/g)?.length, 3);
  assert.match(cart, /<SkeletonRegion label="Səbət yüklənir…"/);
});

test("checkout: four step sections, shared inputs, consent wording and handling unchanged, summary + submit", () => {
  const form = read("components/checkout-form.tsx");
  assert.equal(form.match(/data-checkout-section=""/g)?.length, 4);
  assert.match(form, /const input=`mt-1\.5 \$\{controlClass\(\)\}`;/);
  assert.match(form, /\{termsRequired&&<div className="[^"]*"><LegalConsentCheckbox id="checkout-accept-terms" checked=\{acceptTerms\}/);
  assert.match(form, /parts=\{CUSTOMER_CONSENT_PARTS\}/);
  assert.match(form, /if\(data\.code==="TERMS_REQUIRED"\)\{setTermsRequired\(true\);setAcceptTerms\(false\);setTermsError\(data\.error\|\|TERMS_ERROR\);return\}/);
  // CART-DELIVERY: the stock codes plus the item refusals (STORE_UNAVAILABLE, ...) all show "Səbətə keç".
  assert.match(form, /const CART_PROBLEM_CODES=\[\.\.\.ORDER_STOCK_ERROR_CODES,"STORE_UNAVAILABLE","PRODUCT_UNAVAILABLE","VARIANT_INVALID"\];/);
  assert.match(form, /if\(CART_PROBLEM_CODES\.includes\(data\.code\)\)\{setStockProblem\(true\);router\.refresh\(\)\}/);
  assert.match(form, /const TERMS_ERROR="Sifarişi tamamlamaq üçün İstifadə şərtləri və Məxfilik siyasəti ilə razılığınızı təsdiqləyin\.";/);
  assert.match(form, /data-checkout-summary=""/);
  // CART-DELIVERY: also disabled while any item cannot be ordered (the same notes as the cart).
  assert.match(form, /<button type="button" onClick=\{placeOrder\} disabled=\{busy\|\|!stores\.length\|\|!selected\|\|hasUnavailable\}/);
  // The legal checkbox component itself is not touched (wording stays exactly as it is).
  assert.doesNotMatch(read("components/legal-consent-checkbox.tsx"), /DESIGN-T6/);
  const summary = renderToStaticMarkup(h(CartSummary, { subtotal: "20.00", deliveryFee: "3.00", total: "23.00", totalLabel: "Sifarişin cəmi" }));
  assert.match(summary, /Ara cəm<\/dt><dd class="font-medium text-fg">20\.00 ₼/);
  assert.match(summary, /Sifarişin cəmi<\/dt><dd>23\.00 ₼/);
});

// ---------------------------------------------------------------------------------------------------------------
// Site rules

test("site rules: no online/card payment, free-delivery or rating claims added; AZN only", () => {
  const files = ["components/product-variant-purchase.tsx", "components/product-gallery.tsx", "components/cart-page-client.tsx", "components/cart-summary.tsx", "components/checkout-form.tsx", "app/(customer)/checkout/page.tsx", "components/category-mega-menu.tsx", "components/use-dismissible-details.ts", "app/(customer)/products/[productId]/page.tsx"];
  for (const path of files) {
    const source = read(path);
    assert.doesNotMatch(source, /kartla ödə|kart ilə ödə|onlayn ödəyin|ödənişsiz|USD|EUR|reytinq|ulduz/i, path);
  }
  // Free delivery: only the existing, conditional sentences (store threshold, or the fee that comes out at 0).
  const freeMentions = (source: string) => (source.match(/pulsuz/gi) ?? []).length;
  assert.equal(freeMentions(read("components/product-variant-purchase.tsx")), 1);
  assert.match(read("components/product-variant-purchase.tsx"), /<strong className="font-semibold text-fg">\{store\.freeDeliveryThreshold\} ₼<\/strong>-dan etibarən pulsuzdur\./);
  assert.equal(freeMentions(read("components/checkout-form.tsx")), 3);
  for (const path of ["components/product-gallery.tsx", "app/(customer)/products/[productId]/page.tsx", "app/(customer)/checkout/page.tsx"]) assert.equal(freeMentions(read(path)), 0, path);
  // CART-DELIVERY (owner decision 2026-11-20): the cart shows the checkout's two conditional delivery texts, only from
  // the store's real threshold: "PULSUZ" when it is reached, the threshold sentence when a fee applies.
  const cart = read("components/cart-page-client.tsx");
  // CART-POLISH (owner-approved text): + "Pulsuz çatdırılmaya {amount} AZN qaldı", shown only while a fee applies and
  // the store's own threshold is not reached (remainingForFreeDeliveryCents). Counted in source incl. comments.
  assert.equal(freeMentions(cart), 3, "components/cart-page-client.tsx");
  assert.match(cart, /\{remainingForFreeDeliveryCents\(group\.delivery\) !== null && <p[^>]*>Pulsuz çatdırılmaya \{centsToFixed\(remainingForFreeDeliveryCents\(group\.delivery\)!\)\} AZN qaldı<\/p>\}/);
  assert.match(cart, /\{group\.delivery\.freeDelivery \? "PULSUZ" : money\(group\.delivery\.deliveryFeeCents \/ 100\)\}/);
  // SMALL-FIXES-1 B (owner decision): the threshold sentence needs a fee above 0 too (showFreeDeliveryThresholdNote);
  // a fee-0 store keeps "AZN 0.00" without the sentence. The word count above is unchanged.
  assert.match(cart, /\{showFreeDeliveryThresholdNote\(group\.delivery\) && <p[^>]*>\{centsToFixed\(group\.delivery\.freeDeliveryThresholdCents\)\} AZN və yuxarı sifarişlərdə çatdırılma pulsuzdur\.<\/p>\}/);
  // Ratings: the buy box and the gallery have none; the only stars on the product page are the existing review list.
  for (const path of ["components/product-variant-purchase.tsx", "components/product-gallery.tsx", "components/cart-page-client.tsx", "components/checkout-form.tsx"]) assert.doesNotMatch(read(path), /rating|review|★/i, path);
  assert.doesNotMatch(read("components/product-card.tsx"), /rating|reviews/i, "cards stay without ratings");
});
