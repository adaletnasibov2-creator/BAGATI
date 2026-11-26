/**
 * The four legal pages (/about, /contact, /privacy, /terms) carry the owner's final text of 2026-11-17 in code.
 * Renders each page and the footer without a database. The reference text itself is checked word for word at release
 * time; this test guards the facts, the structure, the metadata and that no editorial notes leak onto the site.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Metadata } from "next";
import AboutPage, { generateMetadata as aboutMetadata } from "../app/(customer)/about/page";
import ContactPage, { generateMetadata as contactMetadata } from "../app/(customer)/contact/page";
import PrivacyPage, { generateMetadata as privacyMetadata } from "../app/(customer)/privacy/page";
import TermsPage, { generateMetadata as termsMetadata } from "../app/(customer)/terms/page";
import { CustomerFooter } from "../components/customer-footer";

// tsx compiles the components' JSX with the classic runtime, which needs a global React (as in public-contact.test.ts).
(globalThis as { React?: typeof React }).React = React;

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");
const VOEN = "4202455532";
const OWNER = "Nəsibov Ədalət Şücaət oğlu";
const EMAIL = "adaletnasibov2@gmail.com";
const PHONE = "+994 55 761 43 32";

const PAGES = [
  { route: "/about", file: "app/(customer)/about/page.tsx", title: "Haqqımızda", Page: AboutPage, metadata: aboutMetadata, h2: 4, facts: [] }, // ABOUT-OWNER-INFO-2: /about no longer names the owner (owner decision 2026-11-26)
  { route: "/contact", file: "app/(customer)/contact/page.tsx", title: "Əlaqə", Page: ContactPage, metadata: contactMetadata, h2: 2, facts: [VOEN, OWNER, EMAIL, PHONE] },
  { route: "/privacy", file: "app/(customer)/privacy/page.tsx", title: "Məxfilik siyasəti", Page: PrivacyPage, metadata: privacyMetadata, h2: 8, facts: [VOEN, OWNER] },
  { route: "/terms", file: "app/(customer)/terms/page.tsx", title: "İstifadə şərtləri", Page: TermsPage, metadata: termsMetadata, h2: 12, facts: [VOEN, OWNER] },
] as const;

const html = (Page: () => React.ReactElement) => renderToStaticMarkup(createElement(Page));
/** Visible text: tags removed, entities decoded, whitespace collapsed. */
const textOf = (markup: string) => markup.replace(/<[^>]+>/g, " ")
  .replace(/&quot;/g, "\"").replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  .replace(/\s+/g, " ").trim();

function withBaseUrl<T>(base: string | undefined, run: () => T): T {
  const saved = process.env.APP_BASE_URL;
  if (base === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = base;
  try { return run(); } finally { if (saved === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = saved; }
}

for (const page of PAGES) {
  test(`${page.route}: one h1 with the title, ${page.h2} section headings, the owner's facts`, () => {
    const markup = html(page.Page);
    const h1 = [...markup.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((match) => textOf(match[1]));
    assert.deepEqual(h1, [page.title]);
    assert.equal((markup.match(/<h2[\s>]/g) ?? []).length, page.h2);
    const text = textOf(markup);
    for (const fact of page.facts) assert.ok(text.includes(fact), `${page.route} contains ${fact}`);
  });

  test(`${page.route}: no placeholders, editorial notes or English instructions on the page`, () => {
    const text = textOf(html(page.Page));
    assert.doesNotMatch(text, /[[\]]/, "no [ ] placeholder or lawyer note");
    for (const note of ["route:", "title:", "=== PAGE", "=== END", "NOT FOR THE SITE", "lawyer", "TODO", "do NOT", "agent", "**", "###"]) {
      assert.ok(!text.includes(note), `${page.route} must not show "${note}"`);
    }
    // Unicode letter boundaries: plain \b would see "and" inside "qadağandır" (ğ is not an ASCII word character).
    assert.doesNotMatch(text, /(?<!\p{L})(the|and|should|must|page|text|wording|remove|lawyer)(?!\p{L})/iu, "no English instruction text");
  });

  test(`${page.route}: metadata title and Azerbaijani description, indexable, canonical from APP_BASE_URL`, () => {
    const withBase = withBaseUrl("https://shop.example.az", () => page.metadata()) as Metadata;
    assert.equal(withBase.title, page.title);
    assert.ok(typeof withBase.description === "string" && withBase.description.length > 40);
    assert.match(withBase.description as string, /[əıöüğşç]/, "Azerbaijani description");
    assert.deepEqual(withBase.robots, { index: true, follow: true });
    assert.equal(withBase.alternates?.canonical, `https://shop.example.az${page.route}`);
    const withoutBase = withBaseUrl(undefined, () => page.metadata()) as Metadata;
    assert.equal(withoutBase.alternates, undefined, "no canonical rather than a wrong one");
  });

  test(`${page.route}: static source with no database, client code or raw HTML`, () => {
    const source = read(page.file);
    for (const forbidden of ["prisma", "getSiteSettings", "getPublicContact", "ContentPageView", "dangerouslySetInnerHTML", "\"use client\"", "await ", "force-dynamic", "cookies(", "headers("]) {
      assert.ok(!source.includes(forbidden), `${page.file} must not contain ${forbidden}`);
    }
  });
}

test("contact: e-mail is a mailto: link and the phone a tel: link, with the text unchanged", () => {
  const markup = html(ContactPage);
  assert.match(markup, /<a href="mailto:adaletnasibov2@gmail\.com"[^>]*>adaletnasibov2@gmail\.com<\/a>/);
  assert.match(markup, /<a href="tel:\+994557614332"[^>]*>\+994 55 761 43 32<\/a>/);
  assert.match(textOf(markup), /AZ3500, Qazax rayonu, Qazax şəhəri, N\. Nərimanov küçəsi, ev 17/);
});

test("tables scroll horizontally on narrow screens", () => {
  // ABOUT-OWNER-INFO-2 (owner decision 2026-11-26): /contact has no table any more (e-mail and phone cards); /privacy keeps one.
  for (const Page of [PrivacyPage]) {
    assert.match(html(Page), /<div class="overflow-x-auto"><table /);
  }
});

test("internal links in the text point to /terms and /contact", () => {
  assert.match(html(AboutPage), /href="\/terms"[^>]*>İstifadə şərtlərinə<\/a>/);
  assert.match(html(AboutPage), /href="\/contact"[^>]*>Əlaqə<\/a>/);
  assert.match(html(PrivacyPage), /href="\/contact"[^>]*>Əlaqə<\/a>/);
  assert.match(html(TermsPage), /href="\/contact"[^>]*>Əlaqə<\/a>/);
});

test("typographic characters are exact („ “ quotes, – dash)", () => {
  assert.ok(textOf(html(ContactPage)).includes("„Satıcı ol“"));
  assert.ok(textOf(html(ContactPage)).includes("1–2 iş günü"));
  assert.ok(textOf(html(TermsPage)).includes("„Sifarişlərim“"));
  assert.ok(textOf(html(TermsPage)).includes("„Qaytarılma sorğuları“"));
});

test("revision of 2026-11-18: wording matches what the code does today", () => {
  const about = textOf(html(AboutPage));
  const terms = textOf(html(TermsPage));
  const privacy = textOf(html(PrivacyPage));
  assert.ok(about.includes("Problem olsa, hesabınızdan qaytarma sorğusu göndərin. Qaytarma şərtləri mağazadan asılı ola bilər; sifarişdən əvvəl mağazadan soruşa bilərsiniz."));
  for (const sentence of [
    "Bir səbətdə bir neçə mağazanın məhsulu ola bilər. Hər mağaza üçün ayrı sifariş yaradılır və ayrıca çatdırılır.",
    "ləğv edə bilər; ödəniş edilibsə, ödədiyiniz məbləğ geri qaytarılır.",
    "Onlayn ödəniş aktiv olduqda ödəniş lisenziyalı ödəniş xidməti Epoint vasitəsilə həyata keçirilir. Kart məlumatlarını biz görmürük və saxlamırıq. Onlayn ödəniş aktiv olmayan müddətdə sifariş „Ödəniş gözləyir“ statusu ilə qeyd olunur.",
    "Onlayn ödəniş aktiv olduqda hər mağaza sifarişi ayrıca ödənilir. Məbləğ mağazaya və platformaya ödəniş xidməti tərəfindən bölünür.",
    "Qaytarma şərtləri mağazalar üzrə fərqlənə bilər. Alışdan əvvəl mağazadan soruşun və ya mağaza ilə mesajlaşın.",
    "Qəbul edilmiş qaytarmada ödənilmiş məbləğ geri qaytarılır. Qaytarma üsulu və müddəti ödəniş üsulundan, ödəniş xidmətindən və bankdan asılıdır.",
    "Son yenilənmə: 26 noyabr 2026.", // ABOUT-OWNER-INFO-2: owner-approved date (was 17 noyabr 2026)
  ]) assert.ok(terms.includes(sentence), sentence);
  for (const sentence of [
    "Google-dan ad, e-poçt və Google hesabının identifikatorunu alırıq, başqa məlumat saxlamırıq.",
    "Texniki məlumatlar: giriş cəhdləri və təhlükəsizlik jurnalı (məsələn, şübhəli girişləri müəyyən etmək üçün).",
    "OpenStreetMap Xəritələri göstərmək Xəritə açılanda brauzer sorğusu: IP ünvanı və brauzer məlumatı",
    "Sayt giriş etdiyinizi xatırlamaq, Google ilə daxil olmaq və hesabınızı qorumaq üçün yalnız zəruri cookie-lərdən istifadə edir. Reklam və izləmə cookie-ləri istifadə etmirik. Seçdiyiniz şəhər və sevimli məhsullarınız brauzerinizin yaddaşında saxlanılır.",
  ]) assert.ok(privacy.includes(sentence), sentence);
  // The OpenStreetMap row comes right after the Google row.
  assert.match(privacy, /Google Google hesabı ilə giriş Ad, e-poçt OpenStreetMap /);
  // Claims the code does not support any more are gone.
  for (const removed of ["Qaytarma qaydası hər mağazanın", "pul eyni ödəniş üsulu ilə", "ayrı sifariş yaradılır, ayrıca ödənilir", "yalnız ad və e-poçtunuzu", "sessiya cookie-si", "Hər mağaza sifarişi üçün ödəniş ayrı aparılır"]) {
    assert.ok(!`${about} ${terms} ${privacy}`.includes(removed), `removed: ${removed}`);
  }
});

test("admin Səhifələr list hides about, privacy and terms (static in code) and keeps help", () => {
  const list = read("app/admin/_sections/pages.tsx");
  assert.match(list, /STATIC_LEGAL_PAGE_SLUGS: readonly string\[\] = \["about", "privacy", "terms"\];/);
  assert.match(list, /\(await listContentPages\(prisma\)\)\.filter\(\(page\) => !STATIC_LEGAL_PAGE_SLUGS\.includes\(page\.slug\)\)/);
  assert.doesNotMatch(list, /"help"/, "help stays listed");
  // The CMS itself is unchanged: all four slugs still exist (database rows and defaults untouched).
  assert.match(read("lib/content-pages.ts"), /CONTENT_PAGE_SLUGS = \["terms", "privacy", "about", "help"\] as const;/);
});

test("footer links to the four legal pages with their labels", () => {
  const settings = { siteName: "BAGATI", logoUrl: null, contactPhone: null, contactEmail: null, instagramUrl: null, facebookUrl: null, tiktokUrl: null };
  const markup = renderToStaticMarkup(createElement(CustomerFooter, { settings }));
  for (const [href, label] of [["/about", "Haqqımızda"], ["/contact", "Əlaqə"], ["/privacy", "Məxfilik siyasəti"], ["/terms", "İstifadə şərtləri"]]) {
    assert.match(markup, new RegExp(`href="${href}"[^>]*>${label}</a>`), `${href} ${label}`);
  }
});
