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
  assert.match(read("app/(customer)/(home)/page.tsx"), /className="bagati-on-dark relative isolate overflow-hidden rounded-\[24px\] bg-bagati-primary/);
  assert.match(read("components/announcement-bar-client.tsx"), /className=\{`bagati-focus-current \$\{ANNOUNCEMENT_TONE_CLASSES\[bar\.tone\]\}/);
});

test("top bar: fixed 44 px height, one line, nothing can change its height on font swap", () => {
  const header = read("components/header.tsx");
  assert.match(header, /<div className="container flex h-11 items-center justify-between gap-3 overflow-hidden text-xs">/);
  assert.match(header, /<p className="min-w-0 truncate text-white\/80">Sevdiyin mağazalar və məhsullar bir məkanda\.<\/p>/);
  for (const [href, label] of [["/delivery-returns", "Çatdırılma"], ["/help", "Kömək"], ["/vendor/apply", "Satıcı ol"]]) {
    assert.match(header, new RegExp(`<Link href="${href}" className="inline-flex h-11 items-center whitespace-nowrap[^"]*">${label}</Link>`), label);
  }
});

test("header: 44 px targets for icons, nav links and the search button; tokens instead of hex colours", () => {
  const header = read("components/header.tsx");
  assert.equal(header.match(/className="grid h-11 w-11 place-items-center rounded-full/g)?.length, 2, "favourites and cart");
  assert.equal(header.match(/className="inline-flex min-h-11 items-center rounded-full px-2 text-sm font-semibold/g)?.length, 6, "desktop and tablet nav links");
  assert.doesNotMatch(header, /\[#[0-9A-Fa-f]{6}\]/);
  const search = read("components/search-form.tsx");
  assert.match(search, /<button type="submit" aria-label="Axtar" className="grid h-11 w-11 shrink-0/);
  assert.match(search, /border border-line-strong bg-white/, "visible 3:1 field border");
  assert.match(search, /placeholder:text-fg-muted/, "placeholder meets AA (#56706a, 5.36:1)");
  assert.match(read("components/mobile-menu.tsx"), /className="grid h-11 w-11 place-items-center rounded-full/, "menu button 44 px");
});

test("bottom nav: 11 px labels, active tab marked by a pill as well as colour", () => {
  const nav = read("components/mobile-bottom-nav.tsx");
  assert.equal(nav.match(/text-\[0\.6875rem\]/g)?.length, 2);
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
