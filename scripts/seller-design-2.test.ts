/**
 * SELLER-DESIGN-2: seller forms (product create/edit, Məhsullarım list, Mağazam), the shared form pieces, the sticky
 * save bars, the sidebar fit and the admin/public scope. Source checks read the files; the form pieces are rendered
 * with renderToStaticMarkup.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VendorFormSection, VendorStickyActions, vendorInput } from "../components/vendor-form";
import { CategoryPicker } from "../components/category-picker";

(globalThis as { React?: typeof React }).React = React;

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
function walk(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(root, path)).isDirectory() ? walk(path) : /\.(tsx?|css)$/.test(name) ? [path.replace(/\\/g, "/")] : [];
  });
}
const sectionTitles = (source: string) => [...source.matchAll(/<VendorFormSection[^>]*?title="([^"]+)"/g)].map((match) => match[1]);

// ---------------------------------------------------------------------------------------------------------------
// Shared pieces

test("vendorInput: 48 px, 12 px radius, token border, visible green focus ring and an error state", () => {
  for (const part of ["min-h-12", "rounded-control", "border-line-strong", "focus-visible:outline-focus", "focus-visible:outline-2", "aria-[invalid=true]:border-danger", "[&:user-invalid]:border-danger"]) {
    assert.ok(vendorInput.split(" ").includes(part), part);
  }
  // Tailwind 3.4 cannot put /alpha on the CSS-variable colours; the form pieces use none.
  assert.doesNotMatch(read("components/vendor-form.tsx"), /\b(bg|border|text|ring)-(primary|gold-\d+|danger|line|surface-\w+|fg)\/\d+/);
});

test("VendorFormSection: a card with kicker, Fraunces title, description and a body grid", () => {
  const markup = renderToStaticMarkup(h(VendorFormSection, { eyebrow: "Məhsul kartı", title: "Ümumi məlumat", description: "Bir sətir.", bodyClassName: "sm:grid-cols-2", children: h("input", { name: "x" }) }));
  assert.match(markup, /^<section data-vendor-form-section="" class="min-w-0 rounded-card border border-line bg-white">/);
  assert.match(markup, /<p class="text-kicker uppercase text-gold-700">Məhsul kartı<\/p><h2 class="font-display text-h3 text-fg mt-1">Ümumi məlumat<\/h2><p class="mt-1 max-w-3xl text-sm font-normal text-fg-secondary">Bir sətir\.<\/p>/);
  assert.match(markup, /<div class="grid grid-cols-1 gap-5 p-5 sm:p-7 sm:grid-cols-2"><input name="x"\/><\/div><\/section>$/);
});

test("VendorStickyActions: sticks to the bottom in normal flow, full main width, status next to the buttons", () => {
  const markup = renderToStaticMarkup(h(VendorStickyActions, { status: h("p", { role: "alert" }, "Xəta"), children: h("button", { type: "submit" }, "Yadda saxla") }));
  assert.match(markup, /^<div data-vendor-sticky-actions="" class="sticky bottom-0 z-10 -mx-4 border-t border-line bg-white\/95/);
  // The negative margins match the main padding of the seller layout (p-4 sm:p-7 lg:p-9 xl:p-10).
  assert.match(markup, /sm:-mx-7 sm:px-7 lg:-mx-9 lg:px-9 xl:-mx-10 xl:px-10/);
  assert.match(read("app/vendor/[storeId]/layout.tsx"), /p-4 sm:p-7 lg:ml-\[248px\] lg:p-9 xl:p-10/);
  assert.match(markup, /<div class="min-w-0 sm:flex-1" aria-live="polite"><p role="alert">Xəta<\/p><\/div><div class="flex flex-wrap items-center gap-2 sm:justify-end"><button type="submit">Yadda saxla<\/button><\/div>/);
  assert.doesNotMatch(markup, /position:\s*fixed|fixed /, "not fixed: it never covers the last field");
  // A field scrolled into view (Tab, validation) stays above the bar: WCAG 2.4.11. Only pages with the bar get it.
  assert.match(read("app/globals.css"), /html:has\(\[data-vendor-sticky-actions\]\) \{\n  scroll-padding-bottom: 9rem;\n\}/);
});

// ---------------------------------------------------------------------------------------------------------------
// Product create / edit

test("Məhsul əlavə et: five sections and a sticky bar with Qaralama saxla and Yayımla (same submit intents)", () => {
  const form = read("components/vendor-product-create-form.tsx");
  assert.deepEqual(sectionTitles(form), ["Ümumi məlumat", "Qiymətləndirmə", "Anbar", "Şəkillər"]);
  assert.match(read("components/vendor-variant-editor.tsx"), /<VendorFormSection title="Məhsul seçimləri"/);
  const bar = form.slice(form.indexOf("<VendorStickyActions"), form.indexOf("</VendorStickyActions>"));
  assert.match(bar, /<button type="submit" name="intent" value="draft" disabled=\{busy\} onClick=\{\(\) => setPublish\(false\)\}[^>]*>\{busy && !publish \? "Saxlanılır…" : "Qaralama saxla"\}<\/button>/);
  assert.match(bar, /<button type="submit" name="intent" value="publish" disabled=\{busy \|\| !canSell \|\| !categories\.length\} onClick=\{\(\) => setPublish\(true\)\}[^>]*>\{busy && publish \? "Yayımlanır…" : "Yayımla"\}<\/button>/);
  // Submit logic unchanged: draft vs publish, payload status, the same request.
  assert.match(form, /const shouldPublish = submitter\?\.value === "publish";/);
  assert.match(form, /status: shouldPublish \? "ACTIVE" : "DRAFT",/);
  assert.match(form, /fetch\(`\/api\/vendor\/\$\{storeId\}\/products`, \{ method: "POST"/);
  assert.match(form, /<CategoryPicker categories=\{categories\} name appearance="vendor"/);
});

test("Məhsulu redaktə et: the same sections; sticky bar keeps its own save and archive buttons", () => {
  const editor = read("components/vendor-product-editor.tsx");
  assert.deepEqual(sectionTitles(editor), ["Ümumi məlumat", "Qiymətləndirmə", "Anbar", "Şəkillər"]);
  const bar = editor.slice(editor.indexOf("<VendorStickyActions"), editor.indexOf("</VendorStickyActions>"));
  assert.match(bar, /\{busy\?"Yadda saxlanılır…":"Dəyişiklikləri yadda saxla"\}/);
  assert.match(bar, /onClick=\{\(\)=>void archive\(\)\}[^>]*>Məhsulu arxivlə<\/button>/);
  assert.match(editor, /fetch\(url, \{ method: "PATCH"/);
  assert.match(editor, /<select name="status" defaultValue=\{product\.status\}/, "draft/publish stays the status select");
  assert.match(editor, /appearance="vendor"/);
});

test("inline errors: the existing stock and variant messages show next to their block; texts unchanged", () => {
  for (const path of ["components/vendor-product-create-form.tsx", "components/vendor-product-editor.tsx"]) {
    const source = read(path);
    assert.match(source, /type ErrorField = "stock" \| "variants" \| null;/, path);
    assert.match(source, /inlineError\("stock"\)/, path);
    assert.match(source, /error=\{inlineError\("variants"\)\}/, path);
    // One announcement: the copy in the sticky bar is hidden from screen readers when the inline one is shown.
    assert.match(source, /errorField ?&& ?<p aria-hidden="true"/, path);
  }
  const create = read("components/vendor-product-create-form.tsx");
  for (const text of ["Variant məlumatlarının formatı yanlışdır.", "Əvvəlcə xüsusiyyətləri və variant kombinasiyalarını yaradın.", "Hər variantın stoku tam ədəd olmalıdır. Boş sahə 0 kimi saxlanmır.", "İlkin stok və az stok həddi tam ədəd olmalıdır. Boş sahə 0 kimi saxlanmır; sıfır yazıla bilər."]) assert.ok(create.includes(text), text);
  const variants = read("components/vendor-variant-editor.tsx");
  assert.match(variants, /error\?: ReactNode/);
  assert.match(variants, /\{error\}\n  <\/VendorFormSection>;/);
});

test("image uploader: a dropzone box (same input, limits and messages) and the Əsas şəkil marker", () => {
  const uploader = read("components/vendor-image-uploader.tsx");
  assert.match(uploader, /<label data-vendor-dropzone="" className=\{`relative flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-control border-2 border-dashed/);
  assert.match(uploader, /<input type="file" accept="image\/jpeg,image\/png,image\/webp" multiple disabled=\{busy\} onChange=\{upload\} className="absolute inset-0 h-full w-full cursor-pointer opacity-0/);
  assert.match(uploader, /if \(urls\.length \+ files\.length > 12\) \{ setMessage\("Bir variant üçün ən çox 12 şəkil əlavə etmək olar\."\); return; \}/);
  assert.match(uploader, /JPEG, PNG və ya WebP · hər fayl maksimum 5 MB · ən çox 12 şəkil/);
  assert.match(uploader, /\{index === 0 && <span className="absolute left-1\.5 top-1\.5"><Badge tone="primary" className="shadow-subtle">Əsas şəkil<\/Badge><\/span>\}/);
  for (const label of ["Şəkli sola çək", "Şəkli sağa çək", "Şəkli sil"]) assert.ok(uploader.includes(`aria-label="${label}"`), label);
  // No column span: inside a variant row (one column) a span made a second column and split the row (seen in screenshots).
  assert.doesNotMatch(uploader, /col-span/);
  assert.match(uploader, /return <section className="grid min-w-0 gap-3">/);
});

test("variants: the 'has options' checkbox is a clear card row; the logic is untouched", () => {
  const variants = read("components/vendor-variant-editor.tsx");
  assert.match(variants, /<label className=\{`flex min-h-14 cursor-pointer items-center gap-3 rounded-control border px-4 py-3[^`]*`\}><input type="checkbox" checked=\{enabled\} onChange=\{event => setEnabled\(event\.target\.checked\)\} className=\{vendorCheckbox\}\/> Məhsulun ölçü, rəng və ya başqa seçimləri var<\/label>/);
  assert.match(variants, /if \(matrix\.length > 100\)/);
  assert.match(variants, /<input type="hidden" name=\{name\} value=\{JSON\.stringify\(payload\)\}\/>/);
});

test("CategoryPicker: admin and preview keep the exact old look; only appearance=\"vendor\" changes it", () => {
  const picker = read("components/category-picker.tsx");
  for (const literal of [
    'fieldset: "grid min-w-0 gap-2 text-sm sm:col-span-2"', 'legend: "mb-1"',
    'topSelected: "border-[#173c40] bg-[#f1f6f3] font-semibold"', 'childSelected: "border-[#173c40] bg-white font-semibold"',
    'idle: "border-[#ded9cf] bg-white hover:bg-[#f8f7f4]"', 'count: "shrink-0 text-xs text-slate-500"', 'check: "shrink-0 text-[#173c40]"',
    'panel: "grid gap-2 rounded-2xl border border-[#e7e3d9] bg-[#fbfaf7] p-3"', 'selectedLine: "text-xs text-slate-500"',
  ]) assert.ok(picker.includes(literal), literal);
  assert.match(picker, /const look = appearance === "vendor" \? VENDOR_LOOK : \{ \.\.\.DEFAULT_LOOK, button \};/);
  const categories = [{ id: "a", name: "Zərgərlik", slug: "z", parentId: null, sortOrder: 0 }, { id: "b", name: "Üzük", slug: "u", parentId: "a", sortOrder: 0 }];
  const legacy = renderToStaticMarkup(h(CategoryPicker, { categories, name: true }));
  assert.match(legacy, /<fieldset class="grid min-w-0 gap-2 text-sm sm:col-span-2"><legend class="mb-1">Kateqoriya<\/legend>/);
  assert.match(legacy, /rounded-xl border px-2\.5 py-2 text-left text-sm transition focus-visible:outline/);
  assert.doesNotMatch(legacy, /rounded-control|text-fg|bg-primary-subtle/);
  const vendor = renderToStaticMarkup(h(CategoryPicker, { categories, name: true, appearance: "vendor" }));
  assert.match(vendor, /rounded-control border px-3 py-2/);
  for (const path of ["components/admin-product-edit-form.tsx", "app/storefront-preview/categories/page.tsx"]) assert.doesNotMatch(read(path), /appearance=/, path);
});

// ---------------------------------------------------------------------------------------------------------------
// Məhsullarım list

test("Məhsullarım: one filter bar that keeps Stok in the row from 1024 px; rows, empty state and pagination", () => {
  const section = read("components/vendor-section.tsx");
  assert.match(section, /<div data-vendor-filter-bar="" className="mt-6 grid gap-3 rounded-card border border-line bg-white p-4 sm:grid-cols-3 sm:p-5 lg:grid-cols-\[minmax\(0,2fr\)_repeat\(3,minmax\(0,1fr\)\)\]"><label className=\{`\$\{vendorLabel\} sm:col-span-3 lg:col-span-1`\}>Axtar/);
  for (const label of ["Kateqoriya", "Status", "Stok"]) assert.match(section, new RegExp(`<label className=\\{vendorLabel\\}>${label}<select className=\\{vendorInput\\}`));
  assert.match(section, /data-vendor-product-row=""/);
  assert.match(section, /className="relative grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-control border border-line bg-surface-page text-center"/);
  assert.match(section, /className="line-clamp-2 break-words font-semibold text-fg/, "long names wrap, never overflow");
  assert.match(section, /available===0\?"text-red-700":available<=.*\?"text-amber-700":"text-fg-muted"/, "stock warning colours kept");
  assert.match(section, /<EmptyState className="mt-4" icon=\{<Package size=\{24\}\/>\} title=\{data\.total\?"Bu səhifədə nəticə yoxdur\.":"Məhsul yoxdur\."\}/);
  assert.match(section, /<nav aria-label="Səhifələr"/);
  assert.equal(section.match(/className=\{buttonClass\(\{variant:"secondary",size:"sm"\}\)\}>(Əvvəlki|Növbəti)<\/button>/g)?.length, 2);
});

// ---------------------------------------------------------------------------------------------------------------
// Mağazam

test("Mağazam: grouped cards, logo and cover upload boxes with preview, setup block kept, sticky save bar", () => {
  const editor = read("components/vendor-store-profile-editor.tsx");
  const form = editor.slice(editor.indexOf("<form ref={profileForm} onSubmit={save}"), editor.indexOf("</form>"));
  assert.ok(form.length > 0, "same form element and submit handler");
  assert.equal(form.match(/<section data-vendor-form-section=""/g)?.length, 7);
  for (const title of ["Mağaza ünvanı", "MAĞAZA GÖRÜNÜŞÜ", "ƏLAQƏ MƏLUMATLARI", "SATICI / HÜQUQİ MƏLUMATLAR", "ÇATDIRILMA QİYMƏTLƏRİ", "YERLƏŞMƏ", "ABUNƏLİK"]) assert.ok(form.includes(`sectionHead("${title}")`), title);
  assert.match(form, /uploadBox\("Yüklənir…","Loqo yüklə","logo"\)/);
  assert.match(form, /uploadBox\("Yüklənir…","Örtük şəkli yüklə","banner"\)/);
  assert.match(editor, /<input type="file" accept="image\/jpeg,image\/png,image\/webp" disabled=\{uploading\} onChange=\{e=>\{void upload\(e\.target\.files\?\.\[0\],kind\);e\.currentTarget\.value=""\}\}/);
  assert.match(editor, /if\(file\.size<1\|\|file\.size>5\*1024\*1024\)\{setError\("Şəkil faylı 5 MB-dan böyük olmamalıdır\."\);return\}/);
  assert.match(form, /<div className="grid aspect-\[3\/1\] place-items-center rounded-control border-2 border-dashed/, "empty cover box");
  assert.match(form, /<VendorStickyActions status=\{[\s\S]*?<button disabled=\{busy\|\|uploading\} className=\{buttonClass\(\{size:"sm"\}\)\}>\{busy\?"Saxlanılır…":"Profili yadda saxla"\}<\/button><\/VendorStickyActions>/);
  assert.match(editor, /Qurulumun gedişi/);
  assert.match(editor, /<button type="button" disabled=\{busy\|\|uploading\} onClick=\{\(\)=>void submitReview\(\)\}/);
});

// ---------------------------------------------------------------------------------------------------------------
// Sidebar, orders/returns, scope

test("sidebar: Məhsulları toplu əlavə et fits on one line (spacing only, text unchanged)", () => {
  const nav = read("components/vendor-navigation.tsx");
  assert.match(nav, /\{ path: "imports", label: "Məhsulları toplu əlavə et", Icon: FileSpreadsheet \}/);
  // 248 - 1 border - 2x12 aside padding - 2x10 link padding - 20 icon - 10 gap = 173 px; the label is 164.8 px in
  // Inter 14 px semibold (161 px regular), measured in Chromium. Before: 159 px, so it wrapped.
  assert.match(nav, /hidden w-\[248px\] flex-col border-r border-line bg-white px-3 py-5 lg:flex/);
  assert.match(nav, /"relative flex min-h-11 items-center gap-2\.5 rounded-control px-2\.5 py-2 text-sm/);
  assert.match(nav, /<span aria-hidden="true" className="grid h-5 w-5 shrink-0 place-items-center"><Icon size=\{18\}\/><\/span>/);
});

test("orders and returns only inherit the shared input and button styles", () => {
  for (const path of ["components/vendor-orders.tsx", "components/vendor-returns.tsx", "components/vendor-order-actions.tsx"]) {
    const source = read(path);
    assert.match(source, /buttonClass\(/, path);
    assert.doesNotMatch(source, /bg-\[#173c40\]|border-\[#ded9cf\]|border-\[#d9d4c9\]/, path);
  }
});

test("scope: admin, the public site and the root layout never use the seller form pieces; globals.css only gains the seller scroll padding", () => {
  const outside = [...walk("app/admin"), ...walk("app/(customer)"), "app/layout.tsx", "components/admin-shell.tsx", "components/public-theme.tsx", "components/header.tsx", "components/customer-footer.tsx", ...walk("components").filter((path) => /components\/admin-/.test(path))];
  for (const path of outside) assert.doesNotMatch(read(path), /vendor-form|VendorFormSection|VendorStickyActions/, path);
  // The seller pieces are imported only by seller components.
  for (const path of walk("components").filter((path) => read(path).includes("@/components/vendor-form"))) {
    assert.match(path, /components\/vendor-[\w-]+\.tsx$/, path);
  }
  // Theme scope from stage 1 still in place.
  assert.match(read("app/globals.css"), /body:has\(> \.bagati-vendor\),\n\.bagati-vendor \{/);
});
