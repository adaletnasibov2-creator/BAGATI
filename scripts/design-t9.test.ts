/**
 * DESIGN-T9: legal and info pages in one reading layout, 404 / error pages, password and verify pages. The legal
 * documents are proved unchanged by hashing their title and text against hashes taken from main (6c4dc94) before
 * the change. The real-browser check is in release-output/design-t9/.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TermsPage from "../app/(customer)/terms/page";
import PrivacyPage from "../app/(customer)/privacy/page";
import SellerTermsPage from "../app/(customer)/seller-terms/page";
import AboutPage from "../app/(customer)/about/page";
import ContactPage from "../app/(customer)/contact/page";
import { LegalDocument } from "../components/legal-document";

(globalThis as { React?: typeof React }).React = React;

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const text = (node: React.ReactNode) => decode(renderToStaticMarkup(h(React.Fragment, null, node)).replace(/<[^>]+>/g, ""));
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/** Taken on main (6c4dc94) from the old markup: the <h1> text and the text of the document body, tags removed. */
const MAIN_HASHES = {
  terms: { Page: TermsPage, title: "de3eb7bce3d1745c4017241b147c8a96abdfce3e5b1d4149d6166abc26a767bc", body: "15af605a302203ceb129461b12de1ca99978899eb4e85ea4463cfaa1fda332a4", chars: 4485 },
  privacy: { Page: PrivacyPage, title: "439eb169a6c18a33627d22b7ba485d47de5a37215f05c14c95ad98c8d997862f", body: "fbd737249cf78aeeaf547ffb922bd72edc94295deefc326735def95826ea7f77", chars: 3690 },
  "seller-terms": { Page: SellerTermsPage, title: "39d4e107fcc7ef489b0a6ad95f18fd282ae4071590e76fcf339ac764051ecef1", body: "b62d1d8da44b2ad7e240e203994b3c1959ae9139ce184dffffa9a1e876fecab6", chars: 5242 },
  about: { Page: AboutPage, title: "ca073b711865f871ee7c3a730d6e549599ec8c9fcce1c6b7f9c6491ce25ab6f9", body: "5f974d23eca104794e8dcbfad4c18d0f6572d8c180192b540c07842588cb2447", chars: 1679 },
  contact: { Page: ContactPage, title: "9e5c3357ab261546a0fbd742fd96c31b7c76bcf783bc9debfa638282963867e8", body: "aba3f7a5f7129760c80db72558f0da09e8a9d25f27fc65e52fe5c1a92c0aef54", chars: 1130 },
} as const;

// ---------------------------------------------------------------------------------------------------------------
// Legal texts unchanged

for (const [name, pinned] of Object.entries(MAIN_HASHES)) {
  test(`/${name}: title and document text are byte-identical to main (sha256)`, () => {
    const doc = pinned.Page() as React.ReactElement<{ title: React.ReactNode; children: React.ReactNode }>;
    assert.equal(doc.type, LegalDocument, "rendered through the shared reading layout");
    const body = text(doc.props.children);
    assert.equal(body.length, pinned.chars);
    assert.equal(sha(text(doc.props.title)), pinned.title, "title");
    assert.equal(sha(body), pinned.body, "document text, order and numbering");
  });
}

test("the reading layout adds no visible text: page text = title + document (owner decision: no kicker, no contents list)", () => {
  // children inside the props object: LegalDocument declares `children` as required (typecheck).
  const markup = renderToStaticMarkup(h(LegalDocument, { title: "Başlıq", children: [h("p", { key: "p" }, "Mətn."), h("h2", { key: "h" }, "1. Bölmə"), h("ul", { key: "u" }, h("li", null, "Bənd"))] }));
  assert.equal(decode(markup.replace(/<[^>]+>/g, "")), "BaşlıqMətn.1. BölməBənd");
  assert.match(markup, /<h2 id="bolme-1">1\. Bölmə<\/h2>/, "headings get an anchor id only");
  assert.match(markup, /<div data-legal-document="" class="container py-8 md:py-12"><div class="mx-auto grid max-w-\[72ch\] gap-6">/, "readable column ~72ch");
  assert.match(markup, /<h1 class="break-words font-display text-h1 text-fg">Başlıq<\/h1>/);
  for (const name of ["terms", "privacy", "seller-terms", "about", "contact"]) {
    const source = read(`app/(customer)/${name}/page.tsx`);
    assert.match(source, /return <LegalDocument title=\{title\}>\n/, `${name}: no kicker, no contents`);
    assert.doesNotMatch(source, /className=\{h2\}|list-disc space-y-1 pl-6|rounded-\[24px\]/, `${name}: old wrappers gone`);
  }
  assert.doesNotMatch(read("components/legal-document.tsx"), /Bu səhifədə/, "no new text");
  // The existing guard (scripts/legal-versions.test.ts) keeps its pinned hashes and versions untouched.
  assert.match(read("scripts/legal-versions.test.ts"), /sha256: "29d569e2049e48bdfafa6add1363e00200d927df832b34ae28447306debb15fe"/);
  assert.match(read("scripts/legal-versions.test.ts"), /sha256: "5b10b20dd9249bc3f7bf47a43e3a0fc0d55ca5f4af84a2ef5d2f180997f8f1c9"/);
  assert.match(read("lib/legal-versions.ts"), /CUSTOMER_TERMS: "2026-11-17",\n\s*SELLER_TERMS: "2026-11-18",/);
});

test("typography and print styles live in CSS only (.legal-prose, @media print without site chrome)", () => {
  const css = read("app/globals.css");
  assert.match(css, /\.legal-prose h2 \{ @apply mt-10 scroll-mt-32 text-h3 text-fg; \}/);
  assert.match(css, /\.legal-prose ol \{ @apply list-decimal space-y-2 pl-6 marker:font-semibold marker:text-primary; \}/);
  assert.match(css, /@media print \{\n\s*body:has\(\[data-legal-document\]\) \.bagati-public > :not\(main\) \{ display: none !important; \}/);
  assert.match(css, /\[data-legal-document\] article \{ border: 0 !important; box-shadow: none !important; padding: 0 !important; \}/);
});

test("help (editable content) uses the same layout; the admin preview keeps its own styling", () => {
  const view = read("components/content-page-view.tsx");
  assert.match(view, /return <LegalDocument title=\{page\.title\} kicker=\{eyebrow\} after=\{showUpdated &&/);
  assert.match(view, /<ContentBody body=\{page\.body\} unstyled \/>/);
  const markup = read("lib/content-markup.tsx");
  assert.match(markup, /if \(unstyled\) return <>\{blocks\.map/);
  assert.match(read("components/admin-content-page-editor.tsx"), /<ContentBody body=\{body\} \/>/, "admin preview unchanged");
  assert.match(read("app/(customer)/help/page.tsx"), /<ContentPageView slug="help" eyebrow="Məlumat" \/>/);
});

// ---------------------------------------------------------------------------------------------------------------
// Info pages, 404 and errors

test("delivery-returns and support: tokens, Fraunces headings, shared form pieces and empty state; same texts", () => {
  const delivery = read("app/(customer)/delivery-returns/page.tsx");
  for (const text of ["Çatdırılma şərtləri sifariş və mağazaya görə göstərilir.", "Qaytarılma barədə məlumat mövcud deyil.", '<h1 className="font-display text-h2 text-fg">Çatdırılma</h1>', '<h2 className="font-display text-h2 text-fg">Qaytarılma</h2>']) assert.ok(delivery.includes(text), text);
  const support = read("app/(customer)/support/page.tsx");
  assert.match(support, /<EmptyState className="mt-4" icon=\{<Inbox size=\{24\}\/>\} title="Müraciət yoxdur" description="Göndərdiyiniz müraciətlər burada görünəcək\."\/>/);
  for (const text of ["BAGATI dəstək", "Sizə necə kömək edə bilərik?", "Müraciətinizi göndərin. Müraciəti izləmək üçün hesabınıza daxil olun.", "Yeni müraciət", "Müraciətlərim", "daxil olun"]) assert.ok(support.includes(text), text);
  const form = read("components/support-form.tsx");
  assert.match(form, /<Input id="support-subject" label="Mövzu" required minLength=\{4\} maxLength=\{160\}/);
  assert.match(form, /<Textarea id="support-message" label="Mesaj" required minLength=\{10\} maxLength=\{5000\}/);
  assert.match(form, /fetch\("\/api\/support",\{method:"POST"/);
});

test("404 and error pages share one layout; retry kept; customer error inside the site <main>, the others stand alone", () => {
  const notFound = read("app/not-found.tsx");
  assert.match(notFound, /return <PublicTheme><StatusPage\n\s*icon=\{<SearchX size=\{28\} \/>\}\n\s*kicker="404"\n\s*title="Səhifə tapılmadı"/);
  assert.match(notFound, /<ButtonLink href="\/">Ana səhifə<\/ButtonLink>\n\s*<ButtonLink href="\/products" variant="secondary">Məhsullar<\/ButtonLink>/);
  assert.match(notFound, /securityTelemetry\.recordResponse\(notFoundGroup/, "telemetry unchanged");
  const panel = read("components/error-recovery.tsx");
  assert.match(panel, /<StatusPage\n\s*role="alert"\n\s*ariaLive="assertive"\n\s*landmark=\{!inLayout\}/);
  assert.match(read("app/(customer)/error.tsx"), /<ErrorRecovery digest=\{error\.digest\} reset=\{reset\} inLayout \/>/);
  assert.match(read("app/error.tsx"), /<ErrorRecovery digest=\{error\.digest\} reset=\{reset\} \/>/);
  assert.match(read("app/global-error.tsx"), /<html lang="az">\s*<body>\s*<ErrorRecovery digest=\{error\.digest\} reset=\{reset\} \/>/);
  const layout = read("components/status-page.tsx");
  assert.match(layout, /const Root = landmark \? "main" : "div";/);
});

// ---------------------------------------------------------------------------------------------------------------
// Password, verify and Google-link pages

test("password, verify and Google-link forms: shared fields and buttons, no outline-none; token handling unchanged", () => {
  for (const path of ["components/forgot-password-form.tsx", "components/reset-password-form.tsx", "components/email-verification-form.tsx", "components/google-link-form.tsx"]) {
    const source = read(path);
    assert.doesNotMatch(source, /outline-none/, `${path}: focus ring visible`);
    assert.match(source, /import \{ Input \} from "@\/components\/ui\/field";/, path);
    assert.match(source, /<Button /, path);
  }
  const reset = read("components/reset-password-form.tsx");
  assert.match(reset, /const fragmentToken = new URLSearchParams\(window\.location\.hash\.slice\(1\)\)\.get\("token"\);/);
  assert.match(reset, /cleanUrl\.searchParams\.delete\("token"\);\n\s*cleanUrl\.hash = "";/);
  assert.match(reset, /window\.history\.replaceState\(null, "", `\$\{cleanUrl\.pathname\}\$\{cleanUrl\.search\}`\);/);
  assert.match(reset, /referrerPolicy: "no-referrer",\n\s*body: JSON\.stringify\(\{ token: activeToken, password \}\),/);
  assert.doesNotMatch(reset, /console\./, "the token is never logged");
  assert.match(read("app/reset-password/page.tsx"), /<div className="min-h-\[17rem\]"><ResetPasswordForm token=\{token\} \/><\/div>/, "no layout shift when the form decides its state");
  const frame = 'className="w-full max-w-md rounded-[28px] border border-[#E6E9EC] border-t-[3px] border-t-[#C49A50] bg-white p-6 shadow-[0_24px_70px_rgba(11,23,38,.09)] sm:p-9"';
  for (const path of ["app/(customer)/login/page.tsx", "app/forgot-password/page.tsx", "app/reset-password/page.tsx", "app/(customer)/verify-email/page.tsx", "app/vendor/verify-email/page.tsx", "app/vendor/login/page.tsx", "app/auth/google/link/page.tsx"]) {
    assert.ok(read(path).includes(frame), `${path}: same card frame as /login`);
  }
  assert.doesNotMatch(read("app/vendor/verify-email/page.tsx"), /PublicTheme/, "seller pages stay outside the public theme");
});

test("site rules: no payment, free-delivery or rating claims and no new texts in the changed files", () => {
  const files = ["components/legal-document.tsx", "components/status-page.tsx", "components/error-recovery.tsx", "app/not-found.tsx", "app/(customer)/support/page.tsx", "app/(customer)/delivery-returns/page.tsx", "components/support-form.tsx", "components/content-page-view.tsx"];
  for (const path of files) assert.doesNotMatch(read(path), /kartla ödə|kart ilə ödə|onlayn ödəyin|pulsuz|★|reytinq|ulduz|\bUSD\b|\bEUR\b|Bu səhifədə/i, path);
});
