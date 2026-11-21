/**
 * DESIGN-T10 + SMALL-FIXES-2: auth headings in the display font, four forms on the shared primitives (same texts,
 * names and requests), the home canonical, the seller reviews note; /vendor/login and the legal pages unchanged.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PasswordChangeForm } from "../components/password-change-form";
import StoreInquiryForm from "../components/store-inquiry-form";
import { MessageComposer } from "../components/message-composer";
import { StoreFilterSelect } from "../components/store-filter-select";

(globalThis as { React?: typeof React }).React = React;
const h = React.createElement;
const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Visible text nodes plus placeholder / aria-label / title, in document order. */
function texts(html: string) {
  return {
    text: html.replace(/<[^>]+>/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean),
    attrs: [...html.matchAll(/(placeholder|aria-label|title)="([^"]*)"/g)].map((match) => `${match[1]}=${match[2]}`),
  };
}

// Captured from main (ebb82ed) with the same renderer before the restyle: every string must stay byte-identical.
const MAIN_TEXTS = {
  password: { text: ["Cari şifrə", "Yeni şifrə", "Ən azı 12 simvol.", "Şifrəni dəyiş"], attrs: [] as string[] },
  inquiry: {
    text: ["Adınız", "E-poçtunuz", "(cavab üçün)", "Telefonunuz", "(istəyə bağlı)", "E-poçt və ya telefondan ən azı birini yazın.", "Mesajınız", "0 / 2000", "Vebsayt", "Adımın, əlaqə məlumatlarımın və mesajımın cavab almaq üçün bu mağazaya göndərilməsinə razıyam.", "Mesajı göndər"],
    attrs: ["aria-label=Mağaza mağazasına mesaj", "placeholder=055 123 45 67"],
  },
  composer: { text: ["Mesaj", "Telefon nömrəsi və e-poçt paylaşmayın; bütün yazışma burada qalır.", "0/1000", "Göndər"], attrs: ["placeholder=Mesajınızı yazın…"] },
  storeFilter: { text: ["Mağaza axtarışı", "Axtar", "Bütün mağazalar", "A"], attrs: ["placeholder=Mağaza adı"] },
};

const FORMS = {
  password: () => renderToStaticMarkup(h(PasswordChangeForm)),
  inquiry: () => renderToStaticMarkup(h(StoreInquiryForm, { storeId: "s1", storeName: "Mağaza" })),
  composer: () => renderToStaticMarkup(h(MessageComposer, { allowContactDetails: false, onSend: async () => null })),
  storeFilter: () => renderToStaticMarkup(h(StoreFilterSelect, { initialOptions: [{ id: "a", name: "A" }], initialSelected: "", city: "" })),
};

test("the four forms show exactly the texts they showed on main (no text added, removed or changed)", () => {
  for (const [name, render] of Object.entries(FORMS)) {
    assert.deepEqual(texts(render()), MAIN_TEXTS[name as keyof typeof MAIN_TEXTS], name);
  }
  // Busy texts (not in the first render) are kept in the source.
  assert.match(read("components/password-change-form.tsx"), /loadingLabel="Yadda saxlanır…"/);
  assert.match(read("components/store-inquiry-form.tsx"), /loadingLabel="Göndərilir…"/);
  assert.match(read("components/message-composer.tsx"), /loadingLabel="Göndərilir…"/);
  assert.match(read("components/store-filter-select.tsx"), /\{busy \? "Axtarılır…" : "Axtar"\}/);
});

test("the four forms use the shared primitives: visible focus ring, no outline-none, labelled controls", () => {
  const focus = /focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus/;
  for (const [name, render] of Object.entries(FORMS)) {
    const html = render();
    assert.doesNotMatch(html, /outline-none/, name);
    for (const control of html.match(/<(input|textarea|select|button)\b[^>]*>/g) ?? []) {
      if (/type="hidden"|tabindex="-1"/.test(control)) continue; // hidden fields and the inquiry honeypot
      assert.match(control, focus, `${name}: ${control.slice(0, 80)}`);
    }
  }
  for (const path of ["components/password-change-form.tsx", "components/store-inquiry-form.tsx", "components/message-composer.tsx", "components/store-filter-select.tsx", "app/(customer)/products/(list)/page.tsx"]) {
    const source = read(path);
    assert.match(source, /from "@\/components\/ui\/(field|button)"/, path);
    assert.doesNotMatch(source, /outline-none/, path);
  }
  // Every visible field has a label tied to it.
  const password = FORMS.password();
  assert.match(password, /<label for="password-change-current"[^>]*>Cari şifrə<\/label>/);
  assert.match(password, /<label for="password-change-new"[^>]*>Yeni şifrə<\/label>/);
  assert.match(password, /id="password-change-new"[^>]*aria-describedby="password-change-new-hint"/);
  const inquiry = FORMS.inquiry();
  for (const id of ["store-inquiry-name", "store-inquiry-email", "store-inquiry-phone", "store-inquiry-message"]) assert.match(inquiry, new RegExp(`<label for="${id}"`), id);
  assert.match(inquiry, /id="store-inquiry-email"[^>]*aria-describedby="store-inquiry-contact-note"/, "the 'at least one' note is read with the field");
  assert.match(FORMS.composer(), /<label for="message-body" class="sr-only">Mesaj<\/label>/);
});

test("field names, limits, requests and hooks are unchanged", () => {
  const password = read("components/password-change-form.tsx");
  assert.match(password, /fetch\("\/api\/account\/security\/password", \{ method: "PATCH"/);
  for (const attr of [/name="currentPassword" autoComplete="current-password" required maxLength=\{128\}/, /name="newPassword" autoComplete="new-password" required minLength=\{12\} maxLength=\{128\}/]) assert.match(password, attr);
  const inquiry = read("components/store-inquiry-form.tsx");
  assert.match(inquiry, /fetch\(`\/api\/stores\/\$\{encodeURIComponent\(storeId\)\}\/inquiries`/);
  for (const name of ["name", "contactEmail", "contactPhone", "message", "website", "consent"]) assert.match(inquiry, new RegExp(`name="${name}"`), name);
  assert.doesNotMatch(inquiry, /contactEmail\s*[:?]|mailto:/, "the store email never reaches this component");
  const composer = read("components/message-composer.tsx");
  assert.match(composer, /const checked = validateMessageBody\(text, \{ allowContactDetails \}\);/);
  assert.match(composer, /disabled=\{!text\.trim\(\)\}/);
  const list = read("app/(customer)/products/(list)/page.tsx");
  assert.match(list, /<form action="\/products" data-products-search-form=""/);
  for (const field of [/<input name="q" maxLength=\{PRODUCT_SEARCH_MAX_LENGTH\} defaultValue=\{searchQuery\}/, /<select name="sort" defaultValue=\{sort\} aria-label="Məhsulları sırala"/, /<input type="hidden" name="category" value=\{params\.category\}\/>/, /<input type="hidden" name="city" value=\{params\.city\}\/>/]) assert.match(list, field);
  assert.match(read("components/store-filter-select.tsx"), /fetch\(`\/api\/store-options\?\$\{params\}`/);
});

test("auth headings: display font tokens on /login and /register; the card frame is unchanged", () => {
  const frame = 'border-t-[3px] border-t-[#C49A50] bg-white p-6 shadow-[0_24px_70px_rgba(11,23,38,.09)] sm:p-9"';
  for (const [path, title] of [["app/(customer)/login/page.tsx", "Xoş gəlmisiniz"], ["app/(customer)/register/page.tsx", "Hesab yarat"]]) {
    const page = read(path);
    assert.match(page, new RegExp(`<h1 className="mt-2 font-display text-h1 text-fg">${title}</h1>`), path);
    assert.match(page, /<p className="text-kicker uppercase text-gold-700">BAGATI hesabı<\/p>/, path);
    assert.ok(page.includes(frame), `${path}: same card frame`);
  }
  assert.match(read("app/(customer)/register/page.tsx"), /Artıq hesabın var\? <TextLink href=\{authTabHref\("\/login", nextPath\)\} className="font-semibold">Daxil ol<\/TextLink>/);
});

test("/vendor/login and the legal pages are byte-identical to main", () => {
  const pinned: Record<string, string> = {
    // Owner decision (T8): the seller login keeps the system font and stays outside the public theme.
    // MAINTENANCE-PAGE 3A (owner-approved text): one sentence changed (raw "/vendor/apply" replaced); the hash is the new
    // file, and the check below proves every other byte is still the DESIGN-T10 file (old hash 4164d8d3…).
    "app/vendor/login/page.tsx": "6faed9767dbd69820a3f8a39f0a7356818b2f377ee3e293702ca06f6ad7d6130",
    "components/vendor-login-form.tsx": "9ed3fc560723c3324cb4e2c95bd6c4617fc814882f7dda39b86abc59bbb560f8",
    "app/(customer)/terms/page.tsx": "d9eee92220cd6cd6cb3588c5c159d7f3f038ff912efa83face3e4bc41138bf25",
    "app/(customer)/privacy/page.tsx": "3d645770b9750e70143c10c7dcd16a6bb9aab019d7dc845720c03a4a73f0d222",
    "app/(customer)/seller-terms/page.tsx": "028f51c7d4a61cceaeb4b09f96620a0ff6513a35368d85b4bbb35dda87195ac2",
  };
  for (const [path, hash] of Object.entries(pinned)) assert.equal(sha256(read(path)), hash, path);
  assert.doesNotMatch(read("app/vendor/login/page.tsx"), /PublicTheme|font-display/);
  const oldSentence = "Satıcı müraciəti üçün müştəri hesabınızla daxil olun və /vendor/apply səhifəsinə keçin.";
  const newSentence = "Satıcı müraciəti üçün müştəri hesabınızla daxil olun və “Satıcı olmaq istəyirəm” keçidinə basın.";
  assert.equal(sha256(read("app/vendor/login/page.tsx").replace(newSentence, oldSentence)), "4164d8d38780ef939e82ebf950d683493b2960e989052eadf675fe6a09e3a2a8", "only that sentence changed");
});

test("SMALL-FIXES-2: home canonical, store eligibility fields kept, reviews note without the promise", () => {
  assert.match(read("app/(customer)/(home)/page.tsx"), /\.\.\.canonicalMetadata\("\/"\) \};/);
  // Item 2 NOT done on purpose: legalName/legalAddress feed isPublicStoreEligible (missingSellerLegalFields) on the
  // server; without them every store page would be a 404. They never reach the browser.
  const store = read("app/(customer)/stores/[storeId]/page.tsx");
  assert.match(store, /legalName: true,\n\s*voen: true,\n\s*legalAddress: true,/);
  assert.match(store, /return store && isPublicStoreEligible\(store\) \? store : null;/);
  const reviews = read("components/vendor-reviews.tsx");
  assert.match(reviews, /\{rating \? "Bu qiymətlə rəy yoxdur\." : "Hələ rəy yoxdur\."\}/);
  assert.doesNotMatch(reviews, /Alıcılar məhsul aldıqdan sonra rəy yaza bilər/);
  assert.match(reviews, /Rəylər alıcılara məxsusdur və satıcı tərəfindən dəyişdirilə və ya silinə bilməz\. Rəyə cavab yazmaq və uyğunsuz rəyi bildirmək imkanı hazırda mövcud deyil\./);
});

test("site rules: no payment, free-delivery or rating claims in the changed public files", () => {
  const files = ["app/(customer)/login/page.tsx", "app/(customer)/register/page.tsx", "app/(customer)/products/(list)/page.tsx", "components/store-inquiry-form.tsx", "components/message-composer.tsx", "components/password-change-form.tsx", "components/store-filter-select.tsx"];
  for (const path of files) assert.doesNotMatch(read(path), /kartla ödə|kart ilə ödə|onlayn ödəyin|pulsuz|★|reytinq|ulduz|\bUSD\b|\bEUR\b/i, path);
});

test("focus is never hidden under the public mobile bottom nav (found on /login and /register at 390 px)", () => {
  assert.match(read("components/mobile-bottom-nav.tsx"), /<nav aria-label="Mobil əsas naviqasiya" data-mobile-bottom-nav="" className="fixed inset-x-0 bottom-0 [^"]*md:hidden">/);
  assert.match(read("app/globals.css"), /@media \(max-width: 767px\) \{\n\s*html:has\(\[data-mobile-bottom-nav\]\) \{\n\s*scroll-padding-bottom: calc\(6rem \+ env\(safe-area-inset-bottom\)\);/);
  // The product page keeps its larger padding (buy bar + nav); its rule is more specific (#id).
  assert.match(read("app/globals.css"), /html:has\(#product-buy-bar-slot\) \{\n\s*scroll-padding-bottom: 9rem;/);
});
