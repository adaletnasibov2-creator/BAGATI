/**
 * SELLER-PANEL-3: seller product form and dashboard (static / pure).
 *  - texts: exactly the 10 approved ones (T1-T10) + reused wording that already exists elsewhere;
 *  - plan meter, publish checklist (= the server's own function), duplicate prefill, server-error -> field mapping;
 *  - no fake data on the dashboard (pending money is pending, from the finance rule), Baku dates, bounded stock reads;
 *  - API routes / business rules, legal pages and admin files untouched.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { duplicatePrefill, fieldForServerError, formatCount, planLimitMeter, publishChecklist, readProductForm, SELLER_PANEL_3_REUSED, SELLER_PANEL_3_TEXT, type ProductFormState } from "../lib/seller-panel-3";
import { getProductPublicationBlockers } from "../lib/admin-store-product-publishing";
import { EntitlementError, entitlementErrorResponse, productLimitReachedMessage } from "../lib/subscription-entitlements";
import { formatPrice } from "../lib/price";
import { storeHoursLine } from "../lib/store-hours";
import { withoutAllowedAdminChanges } from "./admin-power-1-scope";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const BASE = "6611710";
// MULTI-PROCESS-1: the scope is checked on the SELLER-PANEL-3 commits (BASE..7feb228, its last commit), not on the
// working tree: later tasks change app/api (e.g. /api/maintenance-state) and would fail a tree diff.
const TASK = "7feb228";
const changedSince = (...paths: string[]) => execFileSync("git", ["diff", "--name-only", BASE, TASK, "--", ...paths], { cwd: root, encoding: "utf8" }).trim();

test("texts: exactly the approved T1-T10 (mətnlər ok)", () => {
  assert.deepEqual({ ...SELLER_PANEL_3_TEXT, duplicateNotice: SELLER_PANEL_3_TEXT.duplicateNotice("Keramika fincan") }, {
    missingHeading: "Yayımlamaq üçün çatışmayanlar",
    ready: "Yayıma hazırdır",
    unsaved: "Yadda saxlanmamış dəyişikliklər var",
    makeCover: "Əsas şəkil et",
    duplicate: "Surətini yarat",
    duplicateNotice: "Məlumatlar “Keramika fincan” məhsulundan köçürüldü. Məhsul kodları və stok boş saxlanıldı; yadda saxlayana qədər heç nə yaradılmır.",
    pendingPayment: "Ödəniş gözləyən sifarişlər",
    voenUnverified: "VÖEN yoxlanılmayıb",
    hoursMissing: "İş saatları qeyd edilməyib",
  });
  // T7: the technical sentence is gone from the add form; the rule sentence stays.
  const form = read("components/vendor-product-create-form.tsx");
  assert.doesNotMatch(form, /Server bu qaydanı ayrıca yoxlayır/);
  assert.match(form, />Endirimli qiymət əsas qiymətdən aşağı olmalıdır\.</);
});

test("reused wording already exists in main (no hidden new text)", () => {
  const at = (path: string) => execFileSync("git", ["show", `${BASE}:${path}`], { cwd: root, encoding: "utf8" });
  assert.ok(at("components/vendor-subscription-panel.tsx").includes(SELLER_PANEL_3_REUSED.activeProducts));
  assert.ok(at("components/vendor-navigation.tsx").includes(`"${SELLER_PANEL_3_REUSED.conversations}"`));
  assert.ok(at("components/vendor-navigation.tsx").includes(`"${SELLER_PANEL_3_REUSED.inquiries}"`));
  assert.ok(at("app/(customer)/stores/[storeId]/page.tsx").includes(SELLER_PANEL_3_REUSED.verifiedSeller) || at("components/storefront-contact.tsx").includes(SELLER_PANEL_3_REUSED.verifiedSeller) || /Təsdiqlənmiş satıcı/.test(at("app/admin/voen/page.tsx")));
  assert.equal(storeHoursLine({ openingTime: "10:00", closingTime: "20:00" }), "İş saatları: 10:00–20:00");
  assert.equal(storeHoursLine({ openingTime: null, closingTime: null }), null);
});

test("plan meter: real counts, '2 000' spacing, the existing limit sentence at the limit, nothing without a limit", () => {
  assert.equal(formatCount(2000), "2 000"); assert.equal(formatCount(300), "300"); assert.equal(formatCount(12345), "12 345");
  assert.deepEqual(planLimitMeter({ active: 6, limit: 2000, plan: "PRO" }), { label: "Aktiv məhsullar", value: "6 / 2 000", percent: 0, atLimit: false, message: null });
  const full = planLimitMeter({ active: 300, limit: 300, plan: "BASIC" })!;
  assert.equal(full.atLimit, true); assert.equal(full.percent, 100);
  assert.equal(full.message, productLimitReachedMessage("BASIC"));
  assert.equal(planLimitMeter({ active: 2000, limit: 2000, plan: "PRO" })!.message, "PRO paketində maksimum 2 000 aktiv məhsul yerləşdirə bilərsiniz.");
  assert.equal(planLimitMeter({ active: 5, limit: null, plan: null }), null, "no plan: no invented limit");
  assert.equal(planLimitMeter({ active: -1, limit: 300, plan: "BASIC" }), null, "failed count: nothing shown");
});

test("the limit sentence is shared with the server's 403 (wording unchanged)", async () => {
  for (const plan of ["BASIC", "PRO"] as const) {
    const body = await entitlementErrorResponse(new EntitlementError("PRODUCT_LIMIT_REACHED", plan, 300, 300)).json() as { error: string };
    assert.equal(body.error, productLimitReachedMessage(plan));
  }
  assert.equal(productLimitReachedMessage("BASIC"), "BASIC paketində maksimum 300 aktiv məhsul yerləşdirə bilərsiniz. Daha çox məhsul üçün PRO paketinə keçin.");
});

const ready: ProductFormState = { name: "Keramika fincan", description: "", price: "42.90", discountPrice: "", categoryId: "c1", categoryActive: true, quantity: "5", reserved: 0, variantsEnabled: false, variants: [] };

test("publish checklist = the server's getProductPublicationBlockers (its own messages)", () => {
  assert.deepEqual(publishChecklist(ready), []);
  assert.ok(publishChecklist({ ...ready, categoryId: "" }).includes("Məhsul üçün kateqoriya seçilməyib."));
  assert.ok(publishChecklist({ ...ready, categoryActive: false }).includes("Məhsulun kateqoriyası mövcud və aktiv deyil."));
  assert.ok(publishChecklist({ ...ready, price: "" }).includes("Məhsulun qiyməti etibarlı, müsbət məbləğ olmalıdır."));
  assert.ok(publishChecklist({ ...ready, discountPrice: "50" }).includes("Endirimli qiymət etibarlı olmalı və əsas qiymətdən aşağı qalmalıdır."));
  assert.ok(publishChecklist({ ...ready, name: "A" }).includes("Məhsul adı 2–160 simvol aralığında olmalıdır."));
  assert.ok(publishChecklist({ ...ready, quantity: "" }).includes("Stok miqdarı mənfi olmayan tam ədəd olmalıdır."));
  const variants = publishChecklist({ ...ready, variantsEnabled: true, variants: [{ name: "M", options: { Ölçü: "M" }, isActive: true, price: null, discountPrice: null, quantity: 3 }, { name: "M", options: { Ölçü: "M" }, isActive: true, price: null, discountPrice: null, quantity: 1 }] });
  assert.ok(variants.includes("Aktiv variant kombinasiyaları təkrarlanır və ya düzgün formatda deyil."));
  // Same answer as the server function for the same candidate (no copied rules).
  const candidate = { id: "x", name: "A", description: null, price: Number.NaN, discountPrice: null, categoryId: null, category: null, inventory: [{ variantId: null, quantity: 1, reserved: 0 }], variants: [] };
  assert.deepEqual(publishChecklist({ ...ready, name: "A", price: "", categoryId: "", quantity: "1" }), getProductPublicationBlockers(candidate));
});

test("readProductForm reads the form fields and the variant JSON the editor writes", () => {
  const values = new Map<string, string>([["name", "Vaza"], ["price", "18.5"], ["discountPrice", ""], ["categoryId", "c2"], ["quantity", "3"], ["variantsEnabled", "true"], ["variants", JSON.stringify([{ name: "Qırmızı", options: { Rəng: "Qırmızı" }, isActive: true, price: null, discountPrice: null, quantity: 2 }])]]);
  const state = readProductForm({ get: (key) => values.get(key) ?? null }, { categoryActive: (id) => id === "c2", reserved: 1 });
  assert.equal(state.name, "Vaza"); assert.equal(state.categoryActive, true); assert.equal(state.reserved, 1);
  assert.equal(state.variantsEnabled, true); assert.equal(state.variants.length, 1);
  assert.deepEqual(publishChecklist(state), []);
  const broken = readProductForm({ get: (key) => (key === "variants" ? "{not json" : values.get(key) ?? null) }, { categoryActive: () => true });
  assert.ok(publishChecklist(broken).length > 0, "unreadable variant data is never 'ready'");
});

test("server messages go under their field (existing texts only)", () => {
  assert.equal(fieldForServerError("Endirimli qiymət əsas qiymətdən aşağı olmalıdır"), "price");
  assert.equal(fieldForServerError("Məhsulu yayımlamaq üçün kateqoriya seçin"), "category");
  assert.equal(fieldForServerError("Bu məhsul kodu artıq istifadədədir. Başqa kod seçin."), "sku");
  assert.equal(fieldForServerError("Brend tapılmadı"), "brand");
  assert.equal(fieldForServerError("Məhsul adı 2–160 simvol aralığında olmalıdır."), "name");
  assert.equal(fieldForServerError("Seçimin endirimli qiyməti onun əsas qiymətindən aşağı olmalıdır"), null, "variant price stays in the variant block");
  assert.equal(fieldForServerError("Məhsul yaradıla bilmədi"), null);
});

test("duplicate prefill: no id, no product or variant code, stock 0, photos copied (new arrays)", () => {
  const images = ["/uploads/vendors/s1/a.webp"];
  const draft = duplicatePrefill({ name: "Pambıq köynək", description: "100% pambıq.", categoryId: "c3", brandId: "b1", price: "35.00", discountPrice: null, images, variants: [{ name: "M", options: { Ölçü: "M" }, isActive: true, price: "36.00", discountPrice: null, images: [] }] });
  assert.equal(draft.sourceName, "Pambıq köynək"); assert.equal(draft.price, 35); assert.equal(draft.quantity, 0);
  assert.notEqual(draft.images, images); assert.deepEqual(draft.images, images);
  assert.equal(draft.variants[0].sku, ""); assert.deepEqual(draft.variants[0].inventory, [{ quantity: 0, lowStockThreshold: 5 }]);
  assert.ok(!("id" in draft) && !("sku" in draft));
  assert.ok(!draft.variants.some((variant) => "id" in variant));
});

test("product forms: photos first, checklist, meter, guard, inline errors; same payload and routes", () => {
  for (const path of ["components/vendor-product-create-form.tsx", "components/vendor-product-editor.tsx"]) {
    const source = read(path);
    assert.ok(source.indexOf('title="Şəkillər"') < source.indexOf('title="Ümumi məlumat"'), `${path}: photos first`);
    assert.match(source, /<VendorPublishChecklist blockers=\{blockers\} serverBlockers=\{serverBlockers\}\/>/);
    assert.match(source, /<VendorPlanMeter storeId=\{storeId\}\/>/);
    assert.match(source, /useUnsavedGuard\(dirty\);/);
    assert.match(source, /coverAction onChange=/);
    for (const field of ["name", "sku", "brand", "category", "price", "stock"]) assert.match(source, new RegExp(`inlineError\\("${field}"\\)`), `${path}: ${field}`);
  }
  const create = read("components/vendor-product-create-form.tsx");
  assert.match(create, /fetch\(`\/api\/vendor\/\$\{storeId\}\/products`, \{ method: "POST"/);
  assert.match(create, /fetch\(`\/api\/vendor\/\$\{encodeURIComponent\(storeId\)\}\/products\/\$\{encodeURIComponent\(copyFrom\)\}`\)/, "duplicate reads the seller's own product API");
  const editor = read("components/vendor-product-editor.tsx");
  assert.match(editor, /href=\{`\/vendor\/\$\{storeId\}\/products\/new\?copy=\$\{encodeURIComponent\(product\.id\)\}`\}/);
  assert.match(read("app/vendor/[storeId]/products/new/page.tsx"), /const copyFrom=typeof copy==="string"&&\/\^\[A-Za-z0-9_-\]\{1,64\}\$\/\.test\(copy\)\?copy:null;/);
  // "Əsas şəkil et" only in the product forms; the store-profile uploader is unchanged.
  assert.doesNotMatch(read("components/vendor-store-profile-editor.tsx"), /coverAction/);
  assert.match(read("components/vendor-image-uploader.tsx"), /coverAction && index > 0 && <button type="button" onClick=\{\(\) => makeCover\(index\)\}/);
  assert.match(read("components/use-unsaved-guard.ts"), /addEventListener\("beforeunload"/);
});

test("dashboard: real data only; pending money is pending; Baku dates; bounded stock reads; new badges", () => {
  const page = read("app/vendor/[storeId]/page.tsx");
  assert.match(page, /db\.storeOrder\.aggregate\(\{ where: \{ storeId, status: \{ notIn: \["DELIVERED", "CANCELLED", "RETURNED"\] \}, order: \{ payments: \{ none: \{ status: "PAID" \} \} \} \}, _sum: \{ subtotal: true, deliveryFee: true \} \}\)/);
  assert.match(page, /\{ label: SELLER_PANEL_3_TEXT\.pendingPayment, value: formatPrice\(pendingAmount\), href: "orders", Icon: Wallet \}/);
  assert.equal(formatPrice(46.9), "46.90 ₼");
  assert.doesNotMatch(SELLER_PANEL_3_TEXT.pendingPayment, /gəlir|satış|qazanc/i, "never called income or sales");
  assert.doesNotMatch(page, /toLocaleString\(/, "dates use formatOrderDateTime (Baku)");
  assert.match(page, /formatOrderDateTime\(order\.createdAt\)/);
  assert.match(page, /LIMIT 6`/); assert.doesNotMatch(page, /db\.inventory\.findMany\(/);
  assert.match(page, /\{voenVerified \? SELLER_PANEL_3_REUSED\.verifiedSeller : SELLER_PANEL_3_TEXT\.voenUnverified\}/);
  assert.match(page, /\{hoursLine \?\? SELLER_PANEL_3_TEXT\.hoursMissing\}/);
  assert.match(page, /conversations === null \? \[\] :/, "the conversations card hides while messaging is off, like the sidebar");
  assert.match(page, /className=\{`mt-3 grid grid-cols-2 gap-3 /, "two cards per row on phones");
  assert.doesNotMatch(page, /reyting|ulduz|\brating|payout|bank hesab|ödənildi|artım|azalma/i, "no ratings, trends, bank/payout or paid claims");
});

test("unchanged: product API routes and rules, legal pages, admin files", () => {
  // ADMIN-POWER-1 added exactly two admin routes (search, list export), pinned by scripts/admin-power-1.test.ts.
  assert.equal(withoutAllowedAdminChanges(changedSince("app/api", "lib/vendor-product-patch.ts", "lib/admin-store-product-publishing.ts", "lib/vendor-product-publication.ts", "lib/stock-quantity.ts", "lib/product-category-choice.ts", "prisma")), "");
  // ADMIN-DESIGN-1 / ADMIN-POWER-1 (owner-approved) may change their listed admin UI files.
  assert.equal(withoutAllowedAdminChanges(changedSince("app/(customer)/terms", "app/(customer)/privacy", "app/(customer)/seller-terms", "app/admin", "components/admin-ui")), "");
});
