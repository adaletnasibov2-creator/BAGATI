/**
 * Each legal text is pinned to its version: the sha256 of the page's visible text is stored next to the version it
 * belongs to. Changing the text without a new LEGAL_VERSIONS date fails here. When you change a page on purpose:
 * set the new date in lib/legal-versions.ts and put the new date and hash in VERSIONED_TEXT below.
 * Renders without a database (same text extraction as scripts/legal-pages.test.ts).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TermsPage from "../app/(customer)/terms/page";
import SellerTermsPage from "../app/(customer)/seller-terms/page";
import { LEGAL_DOCUMENT_KEYS, LEGAL_VERSIONS, type LegalDocumentKey } from "../lib/legal-versions";

(globalThis as { React?: typeof React }).React = React;

const VERSIONED_TEXT: Record<LegalDocumentKey, { version: string; sha256: string; route: string; Page: () => React.ReactElement }> = {
  CUSTOMER_TERMS: { version: "2026-11-17", sha256: "29d569e2049e48bdfafa6add1363e00200d927df832b34ae28447306debb15fe", route: "/terms", Page: TermsPage },
  SELLER_TERMS: { version: "2026-11-18", sha256: "d8392d4b28940a099e72123f35b9cd6a98ee9458da999b2d1bf9e31999a8dd69", route: "/seller-terms", Page: SellerTermsPage },
};

/** Visible text: tags removed, entities decoded, whitespace collapsed (as in scripts/legal-pages.test.ts). */
const textOf = (markup: string) => markup.replace(/<[^>]+>/g, " ")
  .replace(/&quot;/g, "\"").replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  .replace(/\s+/g, " ").trim();
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

for (const key of LEGAL_DOCUMENT_KEYS) {
  const pinned = VERSIONED_TEXT[key];
  test(`${key}: the text of ${pinned.route} belongs to version ${LEGAL_VERSIONS[key]}`, () => {
    assert.equal(LEGAL_VERSIONS[key], pinned.version,
      `${key} version changed: update VERSIONED_TEXT with the new version and the new text hash`);
    assert.equal(sha256(textOf(renderToStaticMarkup(createElement(pinned.Page)))), pinned.sha256,
      `${pinned.route} text changed without a new LEGAL_VERSIONS.${key}: bump the date in lib/legal-versions.ts`);
  });
}

test("versions are dates (YYYY-MM-DD) that fit LegalAcceptance.version VarChar(32)", () => {
  for (const key of LEGAL_DOCUMENT_KEYS) {
    const version = LEGAL_VERSIONS[key];
    assert.match(version, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(new Date(`${version}T00:00:00Z`).toISOString().slice(0, 10), version, "a real calendar date");
    assert.ok(version.length <= 32);
  }
});

test("the version keys are exactly the LegalDocument enum values in prisma/schema.prisma", () => {
  const schema = readFileSync(join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
  const block = schema.match(/^enum LegalDocument \{([^}]*)\}/m);
  assert.ok(block, "enum LegalDocument exists");
  const values = block[1].split(/\s+/).filter(Boolean);
  assert.deepEqual([...values].sort(), [...LEGAL_DOCUMENT_KEYS].sort());
});

test("a one-character change is detected (the hash really covers the text)", () => {
  const text = textOf(renderToStaticMarkup(createElement(SellerTermsPage)));
  assert.notEqual(sha256(text.replace("standart 10 %", "standart 12 %")), VERSIONED_TEXT.SELLER_TERMS.sha256);
});
