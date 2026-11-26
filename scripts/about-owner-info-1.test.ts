/**
 * ABOUT-OWNER-INFO-1 (step A of release-output/about-owner-info-audit-1-report.md): the operator details move to the
 * end of /contact and /about. Same words, new order; the legal pages are untouched.
 *
 * (a) /contact: E-poçt and Telefon stay in the table before the first section; Operator, VÖEN and Hüquqi ünvan are a
 *     <dl> after the last section (the last element of the document).
 * (b) /about: "Kim idarə edir?" is the last <h2> and its paragraph is the last element of the document.
 * (c) The visible text pieces and link targets of both page files are the same multiset as on main 615bfad (only
 *     order and structure differ: no word added or removed). No personal value is written in this test: old and new
 *     files are compared with each other.
 * (d) /privacy, /terms, /seller-terms and lib/legal-versions.ts are byte-identical to 615bfad.
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

// tsx compiles the pages' JSX with the classic runtime, which needs a global React (as in scripts/legal-pages.test.ts).
(globalThis as { React?: typeof React }).React = React;

const root = process.cwd();
const BASE = "615bfad";
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
// Scope checks compare BASE with this task's newest commit (not the working tree), so later approved changes do not
// break them. Before the task is committed, the working tree is used.
const TASK = git("log", "--format=%H", "--grep=^ABOUT-OWNER-INFO-1", `${BASE}..HEAD`).trim().split(/\r?\n/).filter(Boolean)[0] ?? null;
const atTask = (path: string) => (TASK ? git("show", `${TASK}:${path}`).replace(/\r\n/g, "\n") : read(path));
const atBase = (path: string) => git("show", `${BASE}:${path}`).replace(/\r\n/g, "\n");

const CONTACT = "app/(customer)/contact/page.tsx";
const ABOUT = "app/(customer)/about/page.tsx";
const body = (markup: string) => {
  const match = /<div class="legal-prose">([\s\S]*)<\/div><\/article>/.exec(markup);
  assert.ok(match, "document body found");
  return match[1];
};

test("(a) /contact: e-mail and phone first, operator details as the closing list", () => {
  const doc = body(renderToStaticMarkup(createElement(ContactPage)));
  const firstH2 = doc.indexOf("<h2");
  const lastH2End = doc.lastIndexOf("</h2>");
  assert.ok(firstH2 > 0 && lastH2End > firstH2);
  for (const label of ["E-poçt", "Telefon"]) {
    const at = doc.indexOf(`<td class="border-b border-line px-3 py-2 align-top">${label}</td>`);
    assert.ok(at > 0 && at < firstH2, `${label} row before the first section`);
  }
  assert.match(doc, /<a href="mailto:[^"]+"[^>]*>[^<]+<\/a>/, "mailto link kept");
  assert.match(doc, /<a href="tel:[^"]+"[^>]*>[^<]+<\/a>/, "tel link kept");
  const dl = doc.indexOf("<dl ");
  assert.ok(dl > lastH2End, "list after the last heading");
  assert.ok(dl > doc.lastIndexOf("</ul>") && dl > doc.lastIndexOf("</p>"), "list after the last section's content");
  assert.ok(doc.endsWith("</dl>"), "list is the last element of the document");
  assert.match(doc, /<dl class="mt-8 grid grid-cols-\[auto_1fr\] gap-x-4 gap-y-1 border-t border-line pt-4 text-sm text-fg-muted">/);
  const labels = [...doc.slice(dl).matchAll(/<dt>([^<]*)<\/dt>/g)].map((m) => m[1]);
  assert.deepEqual(labels, ["Operator", "VÖEN", "Hüquqi ünvan"]);
  assert.equal((doc.slice(dl).match(/<dd>[^<]+<\/dd>/g) ?? []).length, 3, "one value per label");
  for (const label of ["Operator", "VÖEN", "Hüquqi ünvan"]) assert.ok(!doc.slice(0, dl).includes(`>${label}<`), `${label} no longer in the table`);
  assert.equal((doc.match(/<h2[\s>]/g) ?? []).length, 2, "no new section heading");
});

test("(b) /about: \"Kim idarə edir?\" is the last section", () => {
  const doc = body(renderToStaticMarkup(createElement(AboutPage)));
  const headings = [...doc.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(headings, ["Niyə BAGATI?", "Necə işləyir?", "Bizimlə əlaqə", "Kim idarə edir?"]);
  const last = doc.slice(doc.lastIndexOf("<h2"));
  assert.match(last, /^<h2 id="bolme-4">Kim idarə edir\?<\/h2><p>BAGATI-ni [\s\S]*<\/p>$/, "heading + its paragraph close the document");
});

/** Visible text pieces (between tags) and link targets of a page source, as a sorted multiset. */
function pieces(source: string): string[] {
  const jsx = source.slice(source.indexOf("return <LegalDocument"));
  const texts = [...jsx.matchAll(/>([^<>{}]+)</g)].map((m) => m[1].replace(/\s+/g, " ").trim()).filter(Boolean);
  const links = [...jsx.matchAll(/href="([^"]+)"/g)].map((m) => `href:${m[1]}`);
  return [...texts, ...links].sort();
}

test("(c) both pages: the same text pieces and links as on main 615bfad, only reordered", () => {
  for (const path of [CONTACT, ABOUT]) {
    const before = pieces(atBase(path));
    const after = pieces(atTask(path));
    assert.ok(before.length > 10, `${path}: pieces found`);
    assert.deepEqual(after, before, `${path}: a word was added or removed`);
  }
  // The about paragraph was moved byte-identically (heading + paragraph lines).
  const section = (source: string) => source.split("\n").filter((line) => /<h2>Kim idarə edir\?<\/h2>|<p>BAGATI-ni /.test(line));
  assert.deepEqual(section(atTask(ABOUT)), section(atBase(ABOUT)));
  // The contact values are the same strings that were in the table cells.
  const cells = (source: string) => [...source.matchAll(/<td className=\{td\}>(Operator|VÖEN|Hüquqi ünvan)<\/td><td className=\{td\}>([^<]*)<\/td>/g)].map((m) => [m[1], m[2]]);
  const items = (source: string) => [...source.matchAll(/<dt>([^<]*)<\/dt>\s*<dd>([^<]*)<\/dd>/g)].map((m) => [m[1], m[2]]);
  assert.equal(cells(atBase(CONTACT)).length, 3);
  assert.deepEqual(items(atTask(CONTACT)), cells(atBase(CONTACT)));
});

test("(d) the legal pages and legal versions are byte-identical to main 615bfad", () => {
  const paths = ["app/(customer)/privacy", "app/(customer)/terms", "app/(customer)/seller-terms", "lib/legal-versions.ts", "components/customer-footer.tsx", "prisma", "package.json", "package-lock.json"];
  const diff = TASK ? git("diff", "--name-only", BASE, TASK, "--", ...paths) : git("diff", "--name-only", BASE, "--", ...paths);
  assert.equal(diff.trim(), "");
});
