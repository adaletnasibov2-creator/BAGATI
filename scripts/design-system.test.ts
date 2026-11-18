/**
 * Design T1 + T2: tokens, fonts and the components/ui primitives (render, aria, variants).
 * Source checks read the files; the primitives are rendered with renderToStaticMarkup.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, ButtonLink, buttonClass } from "../components/ui/button";
import { Input, Select, Textarea } from "../components/ui/field";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Container, Section } from "../components/ui/container";
import { Skeleton, SkeletonRegion, SkeletonText } from "../components/ui/skeleton";
import { EmptyState } from "../components/ui/empty-state";
import { TextLink } from "../components/ui/text-link";

(globalThis as { React?: typeof React }).React = React;

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

// ---------------------------------------------------------------------------------------------------------------
// T1: tokens and fonts

test("fonts: next/font/local with committed woff2 files, Inter optional and Fraunces swap, metric-adjusted fallbacks; no font CDN", () => {
  const fonts = read("app/fonts/public-fonts.ts");
  assert.match(fonts, /import localFont from "next\/font\/local";/);
  for (const file of ["inter-variable-az.woff2", "fraunces-variable-az.woff2"]) {
    assert.match(fonts, new RegExp(`src: "\\./${file.replace(/\./g, "\\.")}"`));
    const bytes = readFileSync(join(root, "app/fonts", file));
    assert.equal(bytes.subarray(0, 4).toString("latin1"), "wOF2", `${file} is woff2`);
    assert.ok(bytes.length < 80_000, `${file} stays small (${bytes.length} bytes)`);
  }
  // Inter: optional, so body text never re-wraps after the first paint (T4 CLS fix). Fraunces: swap.
  assert.match(fonts, /src: "\.\/inter-variable-az\.woff2",[\s\S]*?display: "optional",/);
  assert.match(fonts, /src: "\.\/fraunces-variable-az\.woff2",[\s\S]*?display: "swap",/);
  assert.equal(fonts.match(/^  display: "/gm)?.length, 2, "one display setting per font");
  assert.match(fonts, /adjustFontFallback: "Arial"/);
  assert.match(fonts, /adjustFontFallback: "Times New Roman"/);
  assert.ok(existsSync(join(root, "app/fonts/Inter-OFL.txt")) && existsSync(join(root, "app/fonts/Fraunces-OFL.txt")), "OFL licences ship with the fonts");
  const sources = [...walk("app"), ...walk("components")].map(read).join("\n");
  assert.doesNotMatch(sources, /fonts\.googleapis\.com|fonts\.gstatic\.com|next\/font\/google/);
});

test("the old Inter name that never loaded is gone; the stacks are variables", () => {
  const styles = read("app/globals.css");
  const theme = read("tailwind.config.ts");
  assert.doesNotMatch(styles, /^\s*Inter,/m);
  assert.doesNotMatch(theme, /"Inter"/);
  assert.match(styles, /body \{[^}]*font-family: var\(--bagati-font-sans\);/);
  assert.match(theme, /sans: \["var\(--bagati-font-sans\)"\]/);
  assert.match(theme, /serif: \["var\(--bagati-font-serif\)"\]/);
});

test("public scope: fonts, larger small text and the AA muted colour; :root keeps the values admin uses", () => {
  const styles = read("app/globals.css");
  const scope = styles.slice(styles.indexOf("body:has(> .bagati-public),"), styles.indexOf("}", styles.indexOf("body:has(> .bagati-public),")));
  assert.match(scope, /--bagati-muted-green: #56706a;/);
  assert.match(scope, /--bagati-text-sm: 0\.9375rem;/);
  assert.match(scope, /--bagati-text-xs: 0\.8125rem;/);
  assert.match(scope, /--bagati-font-sans: var\(--bagati-font-inter/);
  assert.match(scope, /--bagati-font-serif: var\(--bagati-font-fraunces/);
  const rootBlock = styles.slice(styles.indexOf(":root {"), styles.indexOf("}", styles.indexOf(":root {")));
  assert.match(rootBlock, /--bagati-muted-green: #638078;/);
  assert.match(rootBlock, /--bagati-text-sm: 0\.875rem;/);
  assert.match(rootBlock, /--bagati-text-xs: 0\.75rem;/);
  assert.match(rootBlock, /--bagati-primary: #174746;/);
  assert.match(rootBlock, /--bagati-gold: #c79a52;/);
  assert.match(rootBlock, /--bagati-gold-700: #7a5c2e;/);
});

test("exactly three standard radii; brand colours; nothing overrides Tailwind's default palettes", () => {
  const theme = read("tailwind.config.ts");
  const radii = theme.slice(theme.indexOf("borderRadius: {"), theme.indexOf("}", theme.indexOf("borderRadius: {")));
  assert.deepEqual([...radii.matchAll(/(\w+): "var\(--bagati-radius-/g)].map((match) => match[1]), ["control", "card", "feature"]);
  for (const palette of ["green", "red", "amber", "slate", "gray"]) assert.doesNotMatch(theme, new RegExp(`\\n\\s+${palette}: \\{`), palette);
  assert.match(theme, /DEFAULT: "var\(--bagati-primary\)"/);
});

test("only public routes render the public theme; admin and the seller panel do not", () => {
  assert.match(read("app/(customer)/layout.tsx"), /<PublicTheme>\n\s*<AnnouncementBar \/>[\s\S]*<\/PublicTheme>/);
  assert.match(read("app/forgot-password/page.tsx"), /<PublicTheme>/);
  assert.match(read("app/reset-password/page.tsx"), /<PublicTheme>/);
  for (const path of [...walk("app/admin"), ...walk("app/vendor"), "app/layout.tsx", "components/admin-shell.tsx"]) {
    assert.doesNotMatch(read(path), /PublicTheme|public-fonts|bagati-public/, path);
  }
  const theme = read("components/public-theme.tsx");
  assert.match(theme, /<div className="bagati-public contents">/, "no extra box around the layout");
  assert.match(theme, /<style href="bagati-public-fonts" precedence="default">/);
});

// ---------------------------------------------------------------------------------------------------------------
// T2: primitives

test("Button: variants, sizes ≥ 44 px, pill by default, visible focus ring, submit only when asked", () => {
  const markup = html(h(Button, null, "Davam et"));
  assert.match(markup, /^<button type="button" class="[^"]*rounded-full[^"]*bg-primary[^"]*min-h-12/);
  assert.match(markup, /focus-visible:outline-2/);
  assert.match(markup, /focus-visible:outline-focus/);
  assert.match(html(h(Button, { type: "submit", pill: false }, "x")), /type="submit" class="[^"]*rounded-control/);
  for (const size of ["sm", "md", "lg"] as const) assert.match(buttonClass({ size }), /min-h-(11|12|\[3\.25rem\])/);
  assert.match(buttonClass({ variant: "secondary" }), /border-primary bg-white text-primary/);
  assert.match(buttonClass({ variant: "ghost" }), /text-primary hover:bg-primary-subtle/);
  assert.match(buttonClass({ variant: "danger" }), /bg-danger text-white/);
  assert.match(buttonClass({ fullWidth: true }), /\bw-full\b/);
});

test("Button loading: disabled, aria-busy, spinner hidden from screen readers, optional loading text", () => {
  const markup = html(h(Button, { loading: true, loadingLabel: "Yoxlanılır..." }, "Daxil ol"));
  assert.match(markup, /disabled=""/);
  assert.match(markup, /aria-busy="true"/);
  assert.match(markup, /<span aria-hidden="true" class="[^"]*animate-spin[^"]*motion-reduce:animate-none/);
  assert.match(markup, /Yoxlanılır\.\.\.<\/button>$/);
  assert.doesNotMatch(markup, /Daxil ol/);
  assert.doesNotMatch(html(h(Button, null, "x")), / aria-busy="| disabled="/);
});

test("ButtonLink renders an <a> with the button look", () => {
  assert.match(html(h(ButtonLink, { href: "/products", variant: "secondary" }, "Məhsullar")), /^<a class="[^"]*border-primary[^"]*" href="\/products">Məhsullar<\/a>$/);
});

test("Input: label for the id, hint and error described, aria-invalid only with an error", () => {
  const plain = html(h(Input, { id: "email", label: "E-poçt", type: "email", hint: "Ən azı 12 simvol" }));
  assert.match(plain, /<label for="email"[^>]*>E-poçt<\/label>/);
  assert.match(plain, /<input id="email" aria-describedby="email-hint" class="[^"]*min-h-12[^"]*border-line-strong[^"]*" type="email"\/>/);
  assert.match(plain, /<p id="email-hint"[^>]*>Ən azı 12 simvol<\/p>/);
  assert.doesNotMatch(plain, /aria-invalid|role="alert"/);
  const invalid = html(h(Input, { id: "email", label: "E-poçt", hint: "h", error: "Səhv e-poçt", "aria-describedby": "extra" }));
  assert.match(invalid, /aria-invalid="true" aria-describedby="extra email-hint email-error"/);
  assert.match(invalid, /border-danger/);
  assert.match(invalid, /<p id="email-error" role="alert"[^>]*>Səhv e-poçt<\/p>/);
});

test("Textarea and Select share the field shell", () => {
  assert.match(html(h(Textarea, { id: "note", label: "Qeyd", error: "Boşdur" })), /<textarea id="note" aria-invalid="true" aria-describedby="note-error"/);
  const select = html(h(Select, { id: "city", label: "Şəhər", defaultValue: "b" }, h("option", { value: "a" }, "Bakı"), h("option", { value: "b" }, "Qazax")));
  assert.match(select, /<label for="city"[^>]*>Şəhər<\/label><select id="city"/);
  assert.match(select, /<option value="b" selected="">Qazax<\/option>/);
});

test("Card, Badge, Container and Section", () => {
  assert.match(html(h(Card, { as: "article", padding: "lg", elevation: "subtle" }, "x")), /^<article class="rounded-card border border-line bg-white p-6 sm:p-10 shadow-subtle">x<\/article>$/);
  assert.match(html(h(Card, { tone: "sunken", padding: "sm", interactive: true }, "x")), /bg-surface-page p-4[^"]*motion-safe:hover:-translate-y-0\.5/);
  assert.match(html(h(Badge, { tone: "gold" }, "Yeni")), /^<span class="[^"]*rounded-full[^"]*text-gold-700[^"]*">Yeni<\/span>$/);
  assert.match(html(h(Container, { width: "narrow" }, "x")), /^<div class="container max-w-3xl">x<\/div>$/);
  assert.match(html(h(Section, { spacing: "lg" }, "x")), /^<section class="py-14 sm:py-20">x<\/section>$/);
});

test("Skeleton shapes are hidden; the region announces loading once", () => {
  assert.match(html(h(Skeleton, { className: "h-4" })), /^<div aria-hidden="true" class="bagati-skeleton rounded-control h-4"><\/div>$/);
  assert.equal(html(h(SkeletonText, { lines: 3 })).match(/bagati-skeleton/g)?.length, 3);
  const region = html(h(SkeletonRegion, null, h(Skeleton)));
  assert.match(region, /^<div role="status" aria-live="polite" aria-busy="true"><span class="sr-only">Yüklənir…<\/span>/);
});

test("EmptyState: decorative icon, heading, text and action", () => {
  const markup = html(h(EmptyState, { title: "Səbət boşdur", description: "Məhsul əlavə edin.", icon: h("svg"), action: h(ButtonLink, { href: "/products" }, "Məhsullara bax") }));
  assert.match(markup, /<div aria-hidden="true" class="[^"]*rounded-full[^"]*"><svg><\/svg><\/div><h2 class="text-h3 text-fg mt-4">Səbət boşdur<\/h2>/);
  assert.match(markup, /<a class="[^"]*" href="\/products">Məhsullara bax<\/a>/);
  assert.match(html(h(EmptyState, { title: "x", titleAs: "h3" })), /<h3 class="text-h3 text-fg">x<\/h3>/);
});

test("TextLink: underlined primary link, or the light footer link with the gold ring", () => {
  const link = html(h(TextLink, { href: "/terms" }, "Şərtlər"));
  assert.match(link, /^<a class="[^"]*" href="\/terms">Şərtlər<\/a>$/);
  for (const name of ["text-primary", "underline", "focus-visible:outline-focus"]) assert.ok(link.split('"')[1].split(" ").includes(name), name);
  const inverse = html(h(TextLink, { href: "/privacy", tone: "inverse", underline: false }, "Məxfilik"));
  assert.match(inverse, /text-white\/70 hover:text-white/);
  assert.match(inverse, /focus-visible:outline-bagati-gold/);
  assert.doesNotMatch(inverse, /\bunderline\b/);
});

test("primitives stay server-component friendly: no 'use client', no hooks", () => {
  for (const path of walk("components/ui")) {
    const source = read(path);
    assert.doesNotMatch(source, /^["']use client["']/m, path);
    assert.doesNotMatch(source, /\buse(State|Effect|Ref|Id|Context|Reducer|LayoutEffect)\(/, path);
  }
});

function walk(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(join(root, path)).isDirectory()) return walk(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
