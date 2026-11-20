/**
 * DESIGN-T8: seller application page (/vendor/apply) and its states, plus the seller login alignment. The field
 * rules are checked against the real server schema; the page and form are checked by source. The real-browser check
 * is in release-output/design-t8/.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { AZ_PHONE_ERROR } from "../lib/az-phone";
import { SELLER_APPLICATION_MESSAGES } from "../lib/seller-application";
import { firstInvalidField, SELLER_APPLICATION_FIELDS, sellerApplicationFieldErrors } from "../lib/seller-application-form";
import { VOEN_MESSAGES } from "../lib/voen";
import { sellerApplicationTone } from "../lib/vendor-status-tone";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const valid = { sellerType: "INDIVIDUAL_ENTREPRENEUR", displayName: "Aysel Zərgərlik", legalName: "Aysel Məmmədova", voen: "1234567892", phone: "055 123 45 67", legalAddress: "", plannedStoreName: "", applicantNote: "", acceptSellerTerms: true };

// ---------------------------------------------------------------------------------------------------------------
// Required / optional: decided by the server schema only

test("inline errors come from the server schema: what the API rejects, with its own texts", () => {
  assert.deepEqual(sellerApplicationFieldErrors(valid), {}, "sole entrepreneur without legal address, store name or note is accepted");
  const empty = sellerApplicationFieldErrors({ sellerType: "INDIVIDUAL_ENTREPRENEUR", displayName: "", legalName: "", voen: "", phone: "", legalAddress: "", plannedStoreName: "", applicantNote: "" });
  assert.deepEqual(empty, {
    displayName: "Satıcı adı ən azı 2 simvol olmalıdır.",
    legalName: "Hüquqi adı yazın.",
    voen: VOEN_MESSAGES.EMPTY,
    phone: AZ_PHONE_ERROR,
    acceptSellerTerms: SELLER_APPLICATION_MESSAGES.sellerTerms,
  });
  assert.equal(firstInvalidField(empty), "displayName", "focus goes to the first invalid field in page order");
  assert.deepEqual(sellerApplicationFieldErrors({ ...valid, voen: "1234567893" }), { voen: VOEN_MESSAGES.LAST_DIGIT });
  assert.deepEqual(sellerApplicationFieldErrors({ ...valid, phone: "12345" }), { phone: AZ_PHONE_ERROR });
  // A registered company must give the legal address (server superRefine).
  assert.deepEqual(sellerApplicationFieldErrors({ ...valid, sellerType: "REGISTERED_COMPANY" }), { legalAddress: SELLER_APPLICATION_MESSAGES.legalAddress });
  assert.deepEqual(sellerApplicationFieldErrors({ ...valid, sellerType: "REGISTERED_COMPANY", legalAddress: "Bakı, Nizami küç. 10" }), {});
  assert.deepEqual([...SELLER_APPLICATION_FIELDS], ["sellerType", "displayName", "legalName", "voen", "phone", "legalAddress", "plannedStoreName", "applicantNote", "acceptSellerTerms"]);
  // The helper reads the same schema object as the API route.
  assert.match(read("lib/seller-application-form.ts"), /sellerApplicationInputSchema\.safeParse\(values\)/);
  assert.match(read("app/api/vendor/apply/route.ts"), /sellerApplicationInputSchema\.safeParse\(body\.value\)/);
});

test("required marks follow the server: * on the five required fields, legal address only for a company", () => {
  const form = read("components/vendor-apply-form.tsx");
  assert.match(form, /function Required\(\) \{\n\s*return <span aria-hidden="true" className="ml-0\.5 font-semibold text-gold-700">\*<\/span>;/, "red-free, hidden from screen readers");
  assert.match(form, /<p aria-hidden="true" className="text-sm text-fg-secondary"><span className="font-semibold text-gold-700">\*<\/span> məcburi xanadır<\/p>/);
  for (const name of ["sellerType", "displayName", "legalName", "phone"]) assert.match(form, new RegExp(`name="${name}"[^\\n]* required[ >][^\\n]*<Required/>`), name);
  assert.match(form, /VÖEN<Required\/><\/label>\n\s*<input id=\{fieldId\("voen"\)\} name="voen" required/);
  assert.match(form, /name="legalAddress" required=\{company\}[^\n]*label=\{<>Hüquqi ünvan\{company \? <Required\/> : " \(istəyə bağlı\)"\}<\/>\}/);
  assert.match(form, /label="Planlaşdırdığınız mağaza adı \(istəyə bağlı\)"/);
  assert.match(form, />Admin üçün qeyd \(istəyə bağlı\)<\/label>/);
  assert.equal(form.match(/<Required\/>/g)?.length, 6, "5 always-required fields + the company-only legal address");
  assert.doesNotMatch(form, /text-red|bg-red/, "no red marks or legacy red classes");
});

test("form UX: shared fields, inline errors, focus on the first invalid field, consent unchanged, busy button", () => {
  const form = read("components/vendor-apply-form.tsx");
  assert.match(form, /<form noValidate onSubmit=\{submit\}/, "our inline errors instead of browser bubbles");
  assert.match(form, /import \{ Input, Select, controlClass \} from "@\/components\/ui\/field";/);
  assert.match(form, /name="phone" type="tel" inputMode="tel" required maxLength=\{40\} defaultValue=\{defaults\.phone\} autoComplete="tel"/);
  assert.match(form, /const found = sellerApplicationFieldErrors\(\{ \.\.\.values, acceptSellerTerms: acceptSellerTerms \|\| undefined \}\);/);
  assert.match(form, /className="mt-5 grid gap-5 md:grid-cols-2"/, "two columns for short fields from 768 px");
  assert.match(form, /<LegalConsentCheckbox id="vendor-apply-accept-terms" checked=\{acceptSellerTerms\}[^\n]*error=\{termsError\} parts=\{SELLER_CONSENT_PARTS\}\/>/);
  assert.match(form, /<Button type="submit" loading=\{busy\} loadingLabel="Göndərilir…" className="mt-5 w-full sm:w-auto">Müraciəti göndər<\/Button>/);
  assert.match(form, /aria-describedby="voen-help voen-error"/);
  assert.match(form, /aria-describedby=\{cx\("vendor-apply-note-count"/, "note counter tied to the textarea");
  // Same request as before: field names, JSON body, the consent flag.
  assert.match(form, /fetch\("\/api\/vendor\/apply", \{ method: "POST", headers: \{ "Content-Type": "application\/json" \}, body: JSON\.stringify\(values\) \}\)/);
  for (const name of ["sellerType", "displayName", "legalName", "voen", "phone", "legalAddress", "plannedStoreName", "applicantNote"]) assert.match(form, new RegExp(`name="${name}"`), name);
});

// ---------------------------------------------------------------------------------------------------------------
// Page layout and states

test("page: customer layout (header/footer), header block, three section cards, side card only from existing text", () => {
  assert.equal(read("app/vendor/apply/layout.tsx").trim().split("\n").pop(), 'export { default } from "@/app/(customer)/layout";', "owner decision: site chrome on /vendor/apply only");
  assert.doesNotMatch(read("app/vendor/login/page.tsx"), /PublicTheme|\(customer\)\/layout/, "the seller login stays outside the public theme");
  const page = read("app/vendor/apply/page.tsx");
  assert.doesNotMatch(page, /<main[\s>]/, "the customer layout already renders <main>");
  assert.match(page, /<h1 className="mt-2 font-display text-h1 text-fg">BAGATI-da satıcı olun<\/h1>/);
  assert.match(page, /lg:grid-cols-\[minmax\(0,1fr\)_320px\]/);
  assert.match(page, /className="hidden rounded-card border border-line bg-surface-page p-5 lg:block"/, "side card from 1024 px");
  const form = read("components/vendor-apply-form.tsx");
  const steps = ["Müraciət göndərildikdən sonra admin məlumatları yoxlayır.", "Təsdiqə qədər hesabınız müştəri hesabı olaraq qalır.", "Təsdiqdən sonra satıcı panelində mağaza qaralaması yarada bilərsiniz; mağaza ictimai satış üçün ayrıca yoxlanılır."];
  for (const step of steps) {
    assert.ok(page.includes(`"${step}"`), step);
    assert.ok(form.includes(step), `${step}: the same sentence the form already shows below 1024 px`);
  }
  assert.match(form, /<p className="mt-5 text-sm leading-6 text-fg-secondary lg:hidden">Müraciət göndərildikdən sonra/);
  for (const title of ["Satıcı məlumatları", "Əlavə məlumat", "Qeyd və razılıq"]) assert.ok(form.includes(`title="${title}"`) || form.includes(`>${title}</h2>`), title);
});

test("states: shared Badge with the existing labels, existing texts and pinned behaviour", () => {
  assert.equal(sellerApplicationTone("PENDING"), "gold");
  assert.equal(sellerApplicationTone("APPROVED"), "primary");
  assert.equal(sellerApplicationTone("REJECTED"), "danger");
  assert.equal(sellerApplicationTone("WITHDRAWN"), "neutral");
  const page = read("app/vendor/apply/page.tsx");
  assert.match(page, /<Badge tone=\{sellerApplicationTone\(status\)\} size="md" className="whitespace-nowrap">\{SELLER_APPLICATION_STATUS_LABELS\[status\]\}<\/Badge>/);
  for (const text of ["Müraciətiniz yoxlanılır", "Əvvəlki müraciətiniz rədd edildi", "Müraciətinizi geri götürdünüz", "Müraciətiniz təsdiqlənib", "Yeni müraciət", "Qərar verildikdə bu səhifədə görünəcək; e-poçt bildirişi də göndəriləcək."]) assert.ok(page.includes(text), text);
  assert.match(page, /<VendorApplyWithdraw applicationId=\{latest\.id\} confirmText=\{texts\.withdrawConfirm\} \/>/);
  // The admin pages keep their own status badge component.
  assert.match(read("app/admin/seller-applications/page.tsx"), /seller-application-status-badge/);
  const withdraw = read("components/vendor-apply-withdraw.tsx");
  assert.match(withdraw, /<Button variant="danger" size="sm" loading=\{busy\} loadingLabel="Göndərilir…" onClick=\{withdraw\}>Bəli, geri götür<\/Button>/);
  assert.match(withdraw, /<Button variant="secondary" size="sm" onClick=\{\(\) => setConfirming\(true\)\}>Müraciəti geri götür<\/Button>/);
});

test("seller login: same shared fields, links and button as the customer login; texts unchanged; focus ring kept", () => {
  const form = read("components/vendor-login-form.tsx");
  assert.match(form, /<Input id="vendor-login-email" label="E-poçt" type="email" autoComplete="email" required/);
  assert.match(form, /<Input id="vendor-login-password" label="Şifrə" type="password" autoComplete="current-password" required/);
  assert.match(form, /<Button type="submit" size="lg" fullWidth disabled=\{busy\} loading=\{busy\} loadingLabel="Yoxlanılır\.\.\.">Satıcı kimi daxil ol<\/Button>/);
  for (const text of ["Şifrəmi unutdum", "Satıcı hesabınız yoxdur?", "Satıcı olmaq istəyirəm", "müştəri girişindən", "Ana səhifəyə qayıt", "Satıcı müraciətinə keç"]) assert.ok(form.includes(text), text);
  assert.doesNotMatch(form, /outline-none/, "the input no longer removes the focus outline");
});

// ---------------------------------------------------------------------------------------------------------------
// Site rules and new texts

test("site rules and new texts: only the listed headings/legend are new; no payment, free-delivery or rating claims", () => {
  const files = ["app/vendor/apply/page.tsx", "components/vendor-apply-form.tsx", "components/vendor-apply-withdraw.tsx", "components/vendor-login-form.tsx", "app/vendor/login/page.tsx"];
  for (const path of files) assert.doesNotMatch(read(path), /kartla ödə|kart ilə ödə|onlayn ödə|pulsuz|★|reytinq|ulduz|\bUSD\b|\bEUR\b|₼/i, path);
  const newTexts = ["məcburi xanadır", "Satıcı məlumatları", "Əlavə məlumat", "Qeyd və razılıq", "Müraciət necə işləyir"];
  const both = read("app/vendor/apply/page.tsx") + read("components/vendor-apply-form.tsx");
  for (const text of newTexts) assert.ok(both.includes(text), text);
});
