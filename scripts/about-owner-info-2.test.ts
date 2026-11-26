/**
 * ABOUT-OWNER-INFO-2 (owner decision 2026-11-26): the owner's details appear in one place only, the bottom of /contact,
 * in normal body text; /about no longer names the owner; on /privacy, /terms and /seller-terms the operator sentence
 * moved, byte-identical, from the first paragraph to the last paragraph; the approved "Son yenilənmə" dates became
 * 26 noyabr 2026. Supersedes scripts/about-owner-info-1.test.ts.
 *
 * No personal value is written in this test: name, VÖEN and address are read from the /contact page at run time, and
 * old and new files are compared with each other.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AboutPage from "../app/(customer)/about/page";
import ContactPage from "../app/(customer)/contact/page";
import PrivacyPage from "../app/(customer)/privacy/page";
import TermsPage from "../app/(customer)/terms/page";
import SellerTermsPage from "../app/(customer)/seller-terms/page";

// tsx compiles the pages' JSX with the classic runtime, which needs a global React (as in scripts/legal-pages.test.ts).
(globalThis as { React?: typeof React }).React = React;

const root = process.cwd();
const BASE = "d1f63ac";
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
// Scope checks compare BASE with this task's newest commit (not the working tree), so later approved changes do not
// break them. Before the task is committed, the working tree is used.
const TASK = git("log", "--format=%H", "--grep=^ABOUT-OWNER-INFO-2", `${BASE}..HEAD`).trim().split(/\r?\n/).filter(Boolean)[0] ?? null;
const atTask = (path: string) => (TASK ? git("show", `${TASK}:${path}`).replace(/\r\n/g, "\n") : read(path));
const atBase = (path: string) => git("show", `${BASE}:${path}`).replace(/\r\n/g, "\n");

const file = (name: string) => `app/(customer)/${name}/page.tsx`;
const PAGES = { about: AboutPage, contact: ContactPage, privacy: PrivacyPage, terms: TermsPage, "seller-terms": SellerTermsPage } as const;
type PageName = keyof typeof PAGES;
const html = (name: PageName) => renderToStaticMarkup(createElement(PAGES[name]));
const body = (markup: string) => {
  const match = /<div class="legal-prose">([\s\S]*)<\/div><\/article>/.exec(markup);
  assert.ok(match, "document body found");
  return match[1];
};
/** Visible text: tags removed, entities decoded, whitespace collapsed (as in scripts/legal-pages.test.ts). */
const textOf = (markup: string) => markup.replace(/<[^>]+>/g, " ")
  .replace(/&quot;/g, "\"").replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  .replace(/\s+/g, " ").trim();

/** The owner's details as shown at the bottom of /contact (read, never written here). */
function ownerDetails() {
  const values = [...read(file("contact")).matchAll(/<dt className="font-semibold text-fg">(Operator|VÖEN|Hüquqi ünvan)<\/dt>\s*<dd className="min-w-0 break-words">([^<]+)<\/dd>/g)].map((m) => [m[1], m[2]] as const);
  assert.deepEqual(values.map(([label]) => label), ["Operator", "VÖEN", "Hüquqi ünvan"]);
  const [operator, voen, address] = values.map(([, value]) => value.trim());
  assert.match(operator, /^Fərdi sahibkar \S/);
  const name = operator.replace(/^Fərdi sahibkar /, "");
  assert.match(voen, /^\d{10}$/);
  // The address and each of its longer parts (district, town, street): the legal sentences name only the town.
  const addressParts = [address, ...address.split(",").map((part) => part.trim()).filter((part) => part.length >= 6)];
  return { name, voen, addressParts };
}

/** Words of the visible text pieces between JSX tags of a page source (comments and attributes excluded). */
function words(source: string): string[] {
  const jsx = source.slice(source.indexOf("return <LegalDocument"));
  return [...jsx.matchAll(/>([^<>{}]+)</g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean).sort();
}
const multisetDiff = (a: string[], b: string[]) => {
  const count = new Map<string, number>();
  for (const w of a) count.set(w, (count.get(w) ?? 0) + 1);
  for (const w of b) count.set(w, (count.get(w) ?? 0) - 1);
  return [...count].filter(([, n]) => n !== 0).sort(([x], [y]) => x.localeCompare(y));
};

test("(a) no page shows the owner's name, VÖEN or address in its first 600 visible characters", () => {
  const { name, voen, addressParts } = ownerDetails();
  for (const name_ of Object.keys(PAGES) as PageName[]) {
    const head = textOf(html(name_)).slice(0, 600);
    for (const value of [name, voen, ...addressParts]) assert.ok(!head.includes(value), `/${name_}: an owner detail is in the first 600 characters`);
  }
  // They still appear on /contact (bottom) and in the legal pages' last paragraph.
  for (const name_ of ["contact", "privacy", "terms", "seller-terms"] as const) {
    const text = textOf(html(name_));
    assert.ok(text.includes(name) && text.includes(voen), `/${name_} still names the operator`);
  }
});

test("(b) /contact: e-mail and phone cards before the first section, operator details last in normal body text", () => {
  const doc = body(html("contact"));
  const firstH2 = doc.indexOf("<h2");
  assert.ok(firstH2 > 0);
  assert.equal(doc.indexOf("<table"), -1, "no table any more");
  const cards = doc.slice(0, firstH2);
  assert.match(cards, /<div class="grid gap-3 sm:grid-cols-2">/);
  for (const [label, scheme] of [["E-poçt", "mailto"], ["Telefon", "tel"]]) {
    assert.match(cards, new RegExp(`<div class="min-w-0 rounded-card border border-line bg-surface-page px-4 py-3"><span class="block text-sm font-semibold text-fg-secondary">${label}</span><a href="${scheme}:[^"]+" class="[^"]*min-h-11[^"]*">[^<]+</a></div>`), label);
  }
  const dl = doc.indexOf("<dl ");
  assert.ok(dl > doc.lastIndexOf("</h2>") && dl > doc.lastIndexOf("</ul>") && dl > doc.lastIndexOf("</p>"), "after the last section");
  assert.ok(doc.endsWith("</dl>"), "the last element of the document");
  const dlTag = /<dl class="([^"]+)">/.exec(doc.slice(dl))?.[1] ?? "";
  for (const cls of ["text-body", "text-fg-body", "border-t", "border-line", "grid-cols-[auto_1fr]"]) assert.ok(dlTag.split(" ").includes(cls), cls);
  for (const cls of ["text-sm", "text-xs", "text-fg-muted"]) assert.ok(!dlTag.split(" ").includes(cls), `not ${cls}`);
  assert.ok(!/text-sm|text-xs|text-fg-muted/.test(doc.slice(dl)), "nothing small or muted inside the operator block");
  assert.deepEqual([...doc.slice(dl).matchAll(/<dt[^>]*>([^<]*)<\/dt>/g)].map((m) => m[1]), ["Operator", "VÖEN", "Hüquqi ünvan"]);
  // Same values as before (moved, not retyped); only the table header words "Məlumat" and "Detal" disappeared.
  const cells = (source: string) => [...source.matchAll(/<dt[^>]*>(Operator|VÖEN|Hüquqi ünvan)<\/dt>\s*<dd[^>]*>([^<]*)<\/dd>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(cells(atTask(file("contact"))), cells(atBase(file("contact"))));
  assert.deepEqual(multisetDiff(words(atBase(file("contact"))), words(atTask(file("contact")))), [["Detal", 1], ["Məlumat", 1]]);
});

test("(c) /about: no owner name, VÖEN or town; the last section is \"Platformamızın rolu\" with the kept sentences", () => {
  const { name, voen, addressParts } = ownerDetails();
  const text = textOf(html("about"));
  for (const value of [name, voen, ...addressParts, "Qazax"]) assert.ok(!text.includes(value), "an owner detail on /about");
  assert.doesNotMatch(read(file("about")), /[Ff]ərdi sahibkar|VÖEN:/);
  const doc = body(html("about"));
  assert.deepEqual([...doc.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1]), ["Niyə BAGATI?", "Necə işləyir?", "Bizimlə əlaqə", "Platformamızın rolu"]);
  assert.match(doc.slice(doc.lastIndexOf("<h2")), /^<h2 id="bolme-4">Platformamızın rolu<\/h2><p>BAGATI məhsulları satan tərəf deyil, mağazalarla alıcıları bir araya gətirən platformadır\. Hər məhsulu müvafiq mağaza satır\. Ətraflı məlumat üçün <a [^>]*href="\/terms"[^>]*>İstifadə şərtlərinə<\/a> baxın\.<\/p>$/);
  // The heading reuses existing wording (/terms section 1); the kept sentences are byte-identical to main.
  assert.ok(atBase(file("terms")).includes("<h2>1. Platformamızın rolu</h2>"));
  const kept = (source: string) => /BAGATI məhsulları satan tərəf deyil, [^\n]*<\/p>/.exec(source)?.[0];
  assert.equal(kept(atTask(file("about"))), kept(atBase(file("about"))));
  // Words: only the removed first sentence and the heading swap (no new word except the reused heading).
  const added = multisetDiff(words(atBase(file("about"))), words(atTask(file("about")))).filter(([, n]) => n < 0).map(([w]) => w);
  assert.deepEqual(added.sort(), ["Platformamızın", "rolu"].sort(), "only the reused heading words are new");
});

const LEGAL = [
  { name: "privacy", sentence: /(Məlumatların operatoru: [^<]*\.)<\/p>/, from: "17 noyabr 2026" },
  { name: "terms", sentence: /(Platformanı fərdi sahibkar [^<]*? idarə edir\.)<\/p>/, from: "17 noyabr 2026" },
  { name: "seller-terms", sentence: /(Platformanı fərdi sahibkar [^<]*? idarə edir\.)<\/p>/, from: "18 noyabr 2026" },
] as const;

test("(d) the operator sentence is byte-identical to main and is the last paragraph of each legal page", () => {
  for (const page of LEGAL) {
    const before = atBase(file(page.name));
    const lead = before.split("\n").find((line) => line.trim().startsWith("<p><strong>")) ?? "";
    const sentence = page.sentence.exec(lead)?.[1];
    assert.ok(sentence && sentence.length > 40, `${page.name}: sentence found in main's first paragraph`);
    const now = atTask(file(page.name));
    assert.ok(!(now.split("\n").find((line) => line.trim().startsWith("<p><strong>")) ?? "").includes(sentence), `${page.name}: gone from the first paragraph`);
    assert.equal(now.split(sentence).length, 2, `${page.name}: appears once`);
    assert.match(now, new RegExp(`\\n        <p>${sentence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</p>\\n  </LegalDocument>;`), `${page.name}: last paragraph`);
    const doc = body(html(page.name as PageName));
    assert.ok(doc.endsWith(`<p>${sentence}</p>`), `${page.name}: rendered last`);
    // "Son yenilənmə" stays right before it.
    assert.ok(doc.slice(0, -`<p>${sentence}</p>`.length).endsWith("Son yenilənmə: 26 noyabr 2026.</p>"), `${page.name}: date line before it`);
  }
});

test("(e) legal pages: the same words as main, except the approved date (17/18 -> 26 noyabr 2026)", () => {
  for (const page of LEGAL) {
    const before = words(atBase(file(page.name)));
    const after = words(atTask(file(page.name)));
    const oldDay = page.from.split(" ")[0];
    assert.deepEqual(multisetDiff(before, after), [[oldDay, 1], ["26", -1]].sort(([x], [y]) => String(x).localeCompare(String(y))), page.name);
    assert.ok(atBase(file(page.name)).includes(`Son yenilənmə: ${page.from}.`) && atTask(file(page.name)).includes("Son yenilənmə: 26 noyabr 2026."), page.name);
  }
});

test("(f) section heading counts unchanged", () => {
  const expected: Record<PageName, number> = { about: 4, contact: 2, privacy: 8, terms: 12, "seller-terms": 14 };
  for (const name of Object.keys(PAGES) as PageName[]) assert.equal((html(name).match(/<h2[\s>]/g) ?? []).length, expected[name], name);
});

test("(g) footer, prisma, packages and the editable content pages untouched", () => {
  const paths = ["components/customer-footer.tsx", "prisma", "package.json", "package-lock.json", "lib/content-pages.ts", "app/(customer)/help", "app/(customer)/delivery-returns"];
  const diff = TASK ? git("diff", "--name-only", BASE, TASK, "--", ...paths) : git("diff", "--name-only", BASE, "--", ...paths);
  assert.equal(diff.trim(), "");
});
