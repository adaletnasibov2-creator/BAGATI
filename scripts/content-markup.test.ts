/**
 * Content page format and renderer (lib/content-markup.tsx): structure, and XSS attempts that must never produce
 * markup, script, event handlers or unsafe links.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContentBody, isSafeContentHref, parseContent, parseInline } from "../lib/content-markup";

// tsx compiles the components' JSX with the classic runtime, which needs a global React (as in store-public-contact.test.ts).
(globalThis as { React?: typeof React }).React = React;
const render = (body: string) => renderToStaticMarkup(createElement(ContentBody, { body }));

test("structure: headings, paragraphs, bulleted and numbered lists, bold and links", () => {
  const body = "## Ümumi\n\nBu **mühüm** mətndir.\nİkinci sətir.\n\n- bir\n- iki [qaydalar](/terms)\n\n1. birinci\n2. ikinci\n\n### Əlaqə\nYazın: [dəstək](https://shopbagati.com/support).";
  assert.deepEqual(parseContent(body).map((block) => block.type), ["heading", "paragraph", "list", "list", "heading", "paragraph"]);
  const html = render(body);
  assert.match(html, /<h2[^>]*>Ümumi<\/h2>/);
  assert.match(html, /<p>Bu <strong>mühüm<\/strong> mətndir\. İkinci sətir\.<\/p>/);
  assert.match(html, /<ul[^>]*><li>bir<\/li><li>iki <a href="\/terms"[^>]*>qaydalar<\/a><\/li><\/ul>/);
  assert.match(html, /<ol[^>]*><li>birinci<\/li><li>ikinci<\/li><\/ol>/);
  assert.match(html, /<h3[^>]*>Əlaqə<\/h3>/);
  assert.match(html, /<a href="https:\/\/shopbagati\.com\/support"[^>]*rel="noopener noreferrer nofollow"[^>]*>dəstək<\/a>/);
});

test("raw HTML is shown as text, never as markup", () => {
  for (const attack of ["<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "<a href=\"javascript:alert(1)\">x</a>", "<svg onload=alert(1)>", "<iframe src=//evil></iframe>", "</p><script>x</script>", "<style>body{}</style>"]) {
    const html = render(attack);
    assert.doesNotMatch(html, /<(script|img|svg|iframe|style|a )/i, attack);
    assert.match(html, /&lt;/, `${attack} escaped`);
  }
  const html = render("## <b onclick=x>baş</b>\n\n- <i>bənd</i>\n\n**<u>q</u>**");
  assert.doesNotMatch(html, /<(b|i|u)[ >]/);
  assert.doesNotMatch(html, /<[a-z0-9]+ [^>]*onclick=/i, "no element carries an event handler (the text itself is escaped)");
  assert.match(html, /&lt;b onclick=x&gt;/);
});

test("unsafe link targets are never links (label shown as text)", () => {
  const unsafe = [
    "javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "java\tscript:alert(1)", "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)", "http://insecure.example", "//evil.example", "/\\evil.example", "\\\\evil.example", "https://user:pw@evil.example",
    "https://evil.example/\" onmouseover=\"alert(1)", "&#x6A;avascript:alert(1)", "https:/no-host", "ftp://x.example", "mailto:a@b.c",
  ];
  for (const href of unsafe) {
    assert.equal(isSafeContentHref(href), false, href);
    const html = render(`[bax](${href})`);
    assert.doesNotMatch(html, /<a /, `${href} produced a link`);
    assert.doesNotMatch(html, /javascript:|onmouseover="/i, href);
  }
  for (const href of ["/terms", "/products?category=x", "https://shopbagati.com/privacy#bolme"]) assert.equal(isSafeContentHref(href), true, href);
});

test("attribute and text escaping inside safe constructs", () => {
  const html = render("[\"><script>alert(1)</script>](/terms) and **\"onerror=x**");
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&quot;&gt;&lt;script&gt;/);
  assert.match(parseInline("x **y** z").map((piece) => piece.type).join(","), /text,bold,text/);
});

test("control characters removed; very long bodies are cut at the limit; empty body renders nothing", () => {
  assert.doesNotMatch(render("a\u0000b\u0007c"), /[\u0000\u0007]/);
  assert.equal(parseContent("x".repeat(60_000)).length, 1);
  assert.equal(render(""), '<div class="grid gap-4 leading-7 text-bagati-secondary "></div>');
});

test("content code never uses dangerouslySetInnerHTML", () => {
  const root = join(__dirname, "..");
  const withoutComments = (path: string) => readFileSync(join(root, path), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const files = ["lib/content-markup.tsx", ...readdirSync(join(root, "lib")).filter((name) => /^content-/.test(name)).map((name) => `lib/${name}`)];
  for (const dir of ["app/(customer)/terms", "app/(customer)/privacy", "app/(customer)/about", "app/(customer)/help", "app/admin/_sections"]) {
    try { files.push(...readdirSync(join(root, dir)).filter((name) => /\.tsx?$/.test(name)).map((name) => `${dir}/${name}`)); } catch { /* folder may not exist yet */ }
  }
  for (const file of new Set(files)) assert.doesNotMatch(withoutComments(file), /dangerouslySetInnerHTML/, file);
});
