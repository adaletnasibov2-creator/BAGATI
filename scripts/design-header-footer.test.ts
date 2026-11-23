/**
 * Design T4: header, footer, bottom nav and the public focus ring. Source checks (same style as the other
 * markup tests) plus a render of the footer.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomerFooter } from "../components/customer-footer";

(globalThis as { React?: typeof React }).React = React;
const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8").replace(/\r\n/g, "\n");

test("focus ring: green on the public site, gold kept for admin/seller panel and on dark public surfaces", () => {
  const css = read("app/globals.css");
  const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
  assert.match(root, /--bagati-focus-outline: var\(--bagati-gold\);/, "default (admin, seller panel) stays gold");
  const scope = css.slice(css.indexOf("body:has(> .bagati-public),"), css.indexOf("}", css.indexOf("body:has(> .bagati-public),")));
  assert.match(scope, /--bagati-focus-outline: var\(--bagati-primary\);/, "public scope is green");
  assert.match(css, /\.bagati-on-dark \{\s*--bagati-focus-outline: var\(--bagati-gold\);/);
  assert.match(css, /\.bagati-focus-current \{\s*--bagati-focus-outline: currentColor;/);
  assert.match(css, /:focus-visible \{\s*outline: 3px solid var\(--bagati-focus-outline\);/);
  // Every dark public surface with focusable content opts back into gold (or the text colour).
  assert.match(read("components/header.tsx"), /<div className="bagati-on-dark bg-surface-inverse text-white">/);
  assert.match(read("components/customer-footer.tsx"), /<footer className="bagati-on-dark /);
  assert.match(read("components/home/hero-carousel.tsx"), /className="bagati-on-dark relative z-10 flex/);
  assert.match(read("app/(customer)/(home)/page.tsx"), /className="bagati-on-dark relative isolate overflow-hidden rounded-feature bg-primary /);
  assert.match(read("components/announcement-bar-client.tsx"), /className=\{`bagati-focus-current \$\{ANNOUNCEMENT_TONE_CLASSES\[bar\.tone\]\}/);
});

test("top bar: fixed 44 px height, one line, nothing can change its height on font swap", () => {
  const header = read("components/header.tsx");
  // DESIGN-POLISH-1: 15 px from 768 px (still one line in the fixed 44 px row), brighter tagline.
  assert.match(header, /<div className="container flex h-11 items-center justify-between gap-3 overflow-hidden text-xs md:text-sm">/);
  assert.match(header, /<p className="min-w-0 truncate text-white\/85">Sevdiyin mağazalar və məhsullar bir məkanda\.<\/p>/);
  for (const [href, label] of [["/delivery-returns", "Çatdırılma"], ["/help", "Kömək"], ["/vendor/apply", "Satıcı ol"]]) {
    assert.match(header, new RegExp(`<Link href="${href}" className="inline-flex h-11 items-center whitespace-nowrap[^"]*">${label}</Link>`), label);
  }
});

test("header: 44 px targets for icons, nav links and the search button; tokens instead of hex colours", () => {
  const header = read("components/header.tsx");
  // DESIGN-POLISH-1: favourites and cart live in components/header-actions.tsx (44 px round targets, 24 px icons,
  // real-data badges); the section links are HeaderNavLink (44 px pill, current-page underline).
  const actions = read("components/header-actions.tsx");
  assert.match(header, /<HeaderFavoritesLink \/>\s*<HeaderCartLink initialCount=\{cartCount\} \/>/, "favourites and cart");
  // DESIGN-POLISH-2: one link per item (icon circle + label), min 44 px; 44 px circle on phones, 48 px from 768 px.
  assert.match(actions, /"group\/action relative inline-flex min-h-11 min-w-11 shrink-0 flex-col items-center justify-center gap-1 rounded-control text-fg md:px-1"/);
  assert.match(actions, /"relative grid h-11 w-11 shrink-0 place-items-center rounded-full md:h-12 md:w-12"/);
  assert.match(actions, /<HeartIcon size=\{30\} filled=/); assert.match(actions, /<BagIcon size=\{30\} \/>/);
  assert.match(actions, /"relative inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-fg"/);
  assert.equal(header.match(/<HeaderNavLink href="\/(stores|deals|new-products)">/g)?.length, 3, "Mağazalar, Endirimlər, Yeni məhsullar");
  assert.doesNotMatch(header, /\[#[0-9A-Fa-f]{6}\]/);
  // The section links use the second row at every desktop width, so the search field is never squeezed next to the
  // city and account controls (at 1280 px it showed only the category select); one copy of each link.
  assert.doesNotMatch(header, /aria-label="Əsas naviqasiya"/);
  assert.match(header, /<nav aria-label="Alış-veriş bölmələri" className="hidden border-t border-line py-1 md:flex md:items-center md:gap-1">/);
  assert.equal(header.match(/<CategoryMegaMenu categories=\{categories\} \/>/g)?.length, 1);
  assert.match(read("components/search-form.tsx"), /"hidden max-w-\[158px\] px-2 xl:block"/, "desktop category select from 1280 px only");
  const search = read("components/search-form.tsx");
  assert.match(search, /<button type="submit" aria-label="Axtar" className="grid h-11 w-11 shrink-0/);
  assert.match(search, /border border-line-strong bg-white/, "visible 3:1 field border");
  assert.match(search, /placeholder:text-fg-muted/, "placeholder meets AA (#4f6963, 5.94:1 since DESIGN-POLISH-1)");
  assert.match(read("components/mobile-menu.tsx"), /className="grid h-11 w-11 place-items-center rounded-full/, "menu button 44 px");
});

test("bottom nav: 12 px labels, 22 px icons, active tab marked by a pill as well as colour", () => {
  const nav = read("components/mobile-bottom-nav.tsx");
  // DESIGN-POLISH-1: 12 px labels (were 11 px) and 22 px icons with stroke 2 (were 19 px, 1.8).
  assert.equal(nav.match(/text-\[0\.75rem\]/g)?.length, 2);
  assert.match(nav, /<Icon size=\{22\} strokeWidth=\{active \? 2\.25 : 2\} \/>/);
  assert.doesNotMatch(nav, /text-\[\.62rem\]/);
  assert.match(nav, /\$\{active \? "bg-primary-tint" : ""\}/);
  assert.match(nav, /\$\{accountActive \? "bg-primary-tint" : ""\}/);
  assert.match(nav, /env\(safe-area-inset-bottom\)/);
});

test("footer keeps every column, the Hüquqi məlumat links and Satıcı şərtləri", () => {
  const settings = { siteName: "BAGATI", logoUrl: null, contactPhone: null, contactEmail: null, instagramUrl: null, facebookUrl: null, tiktokUrl: null };
  const html = renderToStaticMarkup(createElement(CustomerFooter, { settings }));
  for (const title of ["Alış-veriş", "Mağazalar və satıcılar", "Yardım və dəstək", "Hüquqi məlumat"]) assert.ok(html.includes(`>${title}</h2>`), title);
  for (const [href, label] of [["/privacy", "Məxfilik siyasəti"], ["/terms", "İstifadə şərtləri"], ["/seller-terms", "Satıcı şərtləri"]]) {
    assert.match(html, new RegExp(`href="${href}"[^>]*>${label}</a>`), label);
  }
});
