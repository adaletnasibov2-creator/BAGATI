/**
 * /seller-terms carries the owner's seller agreement (v2 of 2026-11-18) in code. Same kinds of checks as
 * scripts/legal-pages.test.ts, without a database. Since Phase B (consent checkboxes) the page is public: indexed and
 * linked from the footer and from /terms section 9. The word-for-word comparison with the md is done at release time.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Metadata } from "next";
import SellerTermsPage, { generateMetadata } from "../app/(customer)/seller-terms/page";
import TermsPage from "../app/(customer)/terms/page";
import { CustomerFooter } from "../components/customer-footer";

(globalThis as { React?: typeof React }).React = React;

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const FILE = "app/(customer)/seller-terms/page.tsx";
const html = () => renderToStaticMarkup(createElement(SellerTermsPage));
const textOf = (markup: string) => markup.replace(/<[^>]+>/g, " ")
  .replace(/&quot;/g, "\"").replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  .replace(/\s+/g, " ").trim();

function withBaseUrl<T>(base: string | undefined, run: () => T): T {
  const saved = process.env.APP_BASE_URL;
  if (base === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = base;
  try { return run(); } finally { if (saved === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = saved; }
}

test("/seller-terms: one h1 with the title, 14 section headings in order, the owner's facts", () => {
  const markup = html();
  const h1 = [...markup.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((match) => textOf(match[1]));
  assert.deepEqual(h1, ["Satıcı şərtləri"]);
  const h2 = [...markup.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((match) => textOf(match[1]));
  assert.equal(h2.length, 14);
  h2.forEach((heading, index) => assert.ok(heading.startsWith(`${index + 1}. `), `heading ${index + 1}: ${heading}`));
  const text = textOf(markup);
  for (const fact of ["4202455532", "Nəsibov Ədalət Şücaət oğlu", "BASIC 20 AZN, PRO 50 AZN", "standart 10 %", "hazırda 500 AZN", "Son yenilənmə: 18 noyabr 2026."]) {
    assert.ok(text.includes(fact), `contains ${fact}`);
  }
});

test("/seller-terms: the v2 wording (online payment conditions, visibility after the subscription ends)", () => {
  const text = textOf(html());
  for (const sentence of [
    "Abunə müddəti bitdikdə və yenilənmədikdə mağaza və onun məhsulları saytda görünmür. Məlumatlarınız silinmir və abunə yeniləndikdə mağaza yenidən görünür.",
    "Onlayn ödəniş aktiv olduqdan sonra hər satışdan platformanın komissiyası tutulur: standart 10 %.",
    "Onlayn ödəniş aktiv olduqda hər mağaza sifarişi ayrıca ödənilir.",
    "Onlayn ödəniş aktiv olduqda bir mağaza sifarişi üçün ödəniş xidmətinin təyin etdiyi limit tətbiq olunur (hazırda 500 AZN).",
    "Onlayn ödəniş aktiv olduqda qəbul edilmiş qaytarmada geri ödənən məbləğ satıcının payından tutulur.",
    "sifarişlər „Ödəniş gözləyir“ statusu ilə qeyd olunur",
  ]) assert.ok(text.includes(sentence), sentence);
  // v1 sentences that ran ahead of the code are gone.
  for (const removed of ["saytda görünməyə bilər", "- Hər satışdan", "limit var (hazırda 500 AZN)"]) {
    assert.ok(!text.includes(removed), `removed: ${removed}`);
  }
});

test("/seller-terms: no placeholders, editorial notes or English instructions on the page", () => {
  const text = textOf(html());
  assert.doesNotMatch(text, /[[\]]/, "no [ ] placeholder or lawyer note");
  for (const note of ["route:", "title:", "=== PAGE", "=== END", "NOT FOR THE SITE", "LAWYER", "lawyer", "hüquqşünas", "TODO", "do NOT", "agent", "**", "###", "<a>"]) {
    assert.ok(!text.includes(note), `must not show "${note}"`);
  }
  assert.doesNotMatch(text, /(?<!\p{L})(the|and|should|must|page|text|wording|remove|lawyer)(?!\p{L})/iu, "no English instruction text");
});

test("/seller-terms: links to /terms and /contact with the md's link texts", () => {
  const markup = html();
  assert.match(markup, /href="\/terms"[^>]*>İstifadə şərtləri<\/a>/);
  assert.match(markup, /href="\/contact"[^>]*>Əlaqə<\/a>/);
  assert.equal((markup.match(/<a /g) ?? []).length, 2, "exactly the two links of the md");
});

test("/seller-terms: metadata title and Azerbaijani description, indexed (Phase B), canonical from APP_BASE_URL", () => {
  const withBase = withBaseUrl("https://shop.example.az", () => generateMetadata()) as Metadata;
  assert.equal(withBase.title, "Satıcı şərtləri");
  assert.ok(typeof withBase.description === "string" && withBase.description.length > 40);
  assert.match(withBase.description as string, /[əıöüğşç]/, "Azerbaijani description");
  assert.deepEqual(withBase.robots, { index: true, follow: true });
  assert.equal(withBase.alternates?.canonical, "https://shop.example.az/seller-terms");
  const withoutBase = withBaseUrl(undefined, () => generateMetadata()) as Metadata;
  assert.equal(withoutBase.alternates, undefined, "no canonical rather than a wrong one");
});

test("/seller-terms: static source with no database, client code or raw HTML", () => {
  const source = read(FILE);
  for (const forbidden of ["prisma", "getSiteSettings", "getPublicContact", "ContentPageView", "dangerouslySetInnerHTML", "\"use client\"", "await ", "force-dynamic", "cookies(", "headers("]) {
    assert.ok(!source.includes(forbidden), `${FILE} must not contain ${forbidden}`);
  }
});

test("/seller-terms is linked from the footer (Hüquqi məlumat) and from /terms section 9", () => {
  const settings = { siteName: "BAGATI", logoUrl: null, contactPhone: null, contactEmail: null, instagramUrl: null, facebookUrl: null, tiktokUrl: null };
  assert.match(renderToStaticMarkup(createElement(CustomerFooter, { settings })), /href="\/seller-terms"[^>]*>Satıcı şərtləri<\/a>/);
  const terms = renderToStaticMarkup(createElement(TermsPage));
  const section9 = terms.slice(terms.indexOf("9. Satıcılar üçün"), terms.indexOf("10. "));
  assert.match(section9, /href="\/seller-terms"[^>]*>satıcı şərtlərini<\/a>/);
  assert.equal((terms.match(/href="\/seller-terms"/g) ?? []).length, 1);
});

test("admin Səhifələr list is unchanged: seller-terms has no CMS row, so it is not in STATIC_LEGAL_PAGE_SLUGS", () => {
  assert.match(read("app/admin/_sections/pages.tsx"), /STATIC_LEGAL_PAGE_SLUGS: readonly string\[\] = \["about", "privacy", "terms"\];/);
  assert.match(read("lib/content-pages.ts"), /CONTENT_PAGE_SLUGS = \["terms", "privacy", "about", "help"\] as const;/);
});
