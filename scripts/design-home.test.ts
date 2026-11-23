/**
 * Design T5: home page. Source checks plus renders of the trust row and the stores strip.
 * Data sources, ordering and show/hide conditions are pinned by admin-homepage, deals-campaigns,
 * homepage-campaign-products and public-store-eligibility tests; this file checks the new presentation.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TrustRow } from "../components/home/trust-row";
import { StoreStrip } from "../components/home/store-strip";
import { HomeSectionHeading } from "../components/home/section-heading";

(globalThis as { React?: typeof React }).React = React;
const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8").replace(/\r\n/g, "\n");
const page = read("app/(customer)/(home)/page.tsx");
const carousel = read("components/home/hero-carousel.tsx");

test("every home section keeps its data and its show/hide condition", () => {
  for (const condition of [
    "{categories.length > 0 && <section",
    "{featuredProducts.length > 0 && (",
    "{popular.length > 0 && (",
    "{newestVisible.length > 0 && (",
    "{promotionalById.size > 0 && (",
    "{discounted.length > 0 && (",
    "{eligibleCampaigns.length > 0 && (",
    "{homepageStores.length > 0 && (",
    "{!hasHomepageContent && (",
  ]) assert.ok(page.includes(condition), condition);
  assert.match(page, /<HeroCarousel banners=\{banners\} \/>/);
  assert.match(page, /<StoreStrip stores=\{homepageStores\.slice\(0, 4\)\} \/>/, "same 4 stores as before");
  assert.doesNotMatch(page, /Spotlight|function SectionHeading/, "unused cards and the old heading are gone");
});

test("one heading style: shelves, categories, campaigns and stores use HomeSectionHeading", () => {
  assert.equal(page.match(/<HomeSectionHeading /g)?.length, 3, "categories, campaigns, stores");
  assert.match(read("components/home/product-shelf.tsx"), /<HomeSectionHeading id=\{`\$\{id\}-title`\}/);
  const html = renderToStaticMarkup(createElement(HomeSectionHeading, { id: "x", eyebrow: "BAGATI seçimi", title: "Seçilmiş məhsullar", href: "/products" }));
  assert.match(html, /<h2 id="x" class="mt-2 text-h2 text-fg">Seçilmiş məhsullar<\/h2>/, "Fraunces via the global h2 rule (text-h2 is not excluded)");
  assert.match(html, /<a class="inline-flex min-h-11[^"]*" href="\/products">Hamısına bax/);
  assert.doesNotMatch(html, /Seçilmiş məhsullar\.|Hamısına bax\./, "no terminal punctuation");
});

test("trust row: only the three true claims; no payment, free delivery or rating claims", () => {
  const text = renderToStaticMarkup(createElement(TrustRow)).replace(/<[^>]+>/g, " ");
  for (const claim of ["Doğrulanmış satıcılar", "VÖEN", "Hər mağazanın öz çatdırılma şərtləri", "Satıcı olmaq asandır"]) assert.ok(text.includes(claim), claim);
  assert.doesNotMatch(text, /ödəniş|kart|təhlükəsiz|pulsuz|reytinq|ulduz/i);
  assert.match(renderToStaticMarkup(createElement(TrustRow)), /href="\/vendor\/apply"/);
  assert.match(read("components/home/trust-row.tsx"), /border-t border-gold-200/, "under a gold hairline");
});

test("stores strip: round logo or initial avatar, link to the store", () => {
  const html = renderToStaticMarkup(createElement(StoreStrip, { stores: [
    { id: "s1", name: "Qazax Elektronika", logoUrl: null, city: { name: "Qazax" } },
    { id: "s2", name: "əl işi", logoUrl: "https://cdn.example.com/l.webp", city: { name: "Bakı" } },
  ] }));
  assert.match(html, /href="\/stores\/s1"/);
  assert.match(html, />Q<\/span>/, "initial for a store without a logo");
  assert.match(html, />Ə<\/span>|<img/, "Azerbaijani upper-casing of the initial");
  assert.match(html, /rounded-full/);
});

test("hero: 44 px controls and dots, eager first image, gold hairline, uploaded banners do not borrow default labels", () => {
  assert.match(carousel, /"inline-flex h-11 w-11 items-center justify-center rounded-full/);
  // DESIGN-POLISH-1 adds a short pressed state (no scale under reduced motion); the 44 px hit area is unchanged.
  assert.match(carousel, /className="group\/dot grid h-11 min-w-11 place-items-center rounded-full px-1\.5 active:scale-95 motion-reduce:active:scale-100"/);
  assert.match(carousel, /loading=\{index === 0 \? "eager" : "lazy"\}/);
  assert.match(carousel, /fetchPriority=\{index === 0 \? "high" : "low"\}/);
  assert.match(carousel, /<span aria-hidden="true" className="h-px w-8 shrink-0 bg-gold-400" \/>/);
  assert.match(carousel, /visualLabel: banner\.imageUrl \? "" : visual\.visualLabel,/);
  assert.match(carousel, /imageAlt: banner\.imageUrl \? "" : visual\.imageAlt,/);
  assert.match(carousel, /\{slide\.visualLabel && <span/);
  assert.match(carousel, /const autoplay = hydrated && !reducedMotion && slides\.length > 1;/, "reduced motion still stops autoplay");
});

test("home skeleton mirrors the new hero, trust row, category cards and shelf", () => {
  const loading = read("app/(customer)/(home)/loading.tsx");
  assert.match(loading, /className="bagati-hero [^"]*lg:h-\[var\(--bagati-hero-h\)\]"/);
  assert.match(loading, /min-h-\[404px\][^"]*lg:h-full lg:min-h-0 lg:w-\[46%\]/);
  assert.match(loading, /border-t border-gold-200/);
  assert.match(loading, /h-\[148px\] w-\[112px\]/);
  assert.match(loading, /<ProductCardSkeleton key=\{index\} \/>/);
});
