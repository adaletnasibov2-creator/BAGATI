/**
 * Public content pages read the database with a fallback to the built-in texts. Source-level wiring; the database
 * read and the fallback are exercised in content-pages.integration.test.ts.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { CONTENT_PAGE_DEFAULTS } from "../lib/content-pages";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");

test("terms, privacy, about and help render ContentPageView with their slug and are dynamic", () => {
  for (const slug of ["terms", "privacy", "about", "help"]) {
    const page = read(`app/(customer)/${slug}/page.tsx`);
    assert.match(page, new RegExp(`<ContentPageView slug="${slug}"`), slug);
    assert.match(page, /export const dynamic = "force-dynamic";/, `${slug}: a save shows at once`);
    assert.doesNotMatch(page, /Hüquqi yoxlama|BAGATI müştərilərə|Səbətimdə müxtəlif/, `${slug}: text lives in lib/content-pages.ts`);
  }
});

test("view: database row or built-in text (never empty); 'Son yenilənmə' only on terms/privacy after a save", () => {
  const view = read("components/content-page-view.tsx");
  assert.match(view, /const page = await getPublicContentPage\(slug\);/);
  assert.match(view, /<ContentBody body=\{page\.body\}/);
  assert.match(view, /const showUpdated = CONTENT_PAGE_META\[slug\]\.showUpdatedAt && page\.updatedAt;/);
  assert.match(view, /Son yenilənmə: \{formatContentDate\(page\.updatedAt!\)\}/);
  assert.doesNotMatch(view, /dangerouslySetInnerHTML/);
  const reader = read("lib/content-pages.ts");
  assert.match(reader, /if \(row\?\.published && row\.body\.trim\(\)\) return/);
  assert.match(reader, /return \{ slug, \.\.\.CONTENT_PAGE_DEFAULTS\[slug\], updatedAt: null, fromDatabase: false \};/);
});

test("the built-in texts contain every sentence of the former hard-coded pages (git main)", () => {
  let gitAvailable = true;
  const sentencesOf = (slug: string) => {
    const source = execFileSync("git", ["show", `main:app/(customer)/${slug}/page.tsx`], { cwd: root, encoding: "utf8" });
    // Visible text: JSX text nodes and the help FAQ strings, split into sentences.
    const texts = [...source.matchAll(/>([^<>{}]{12,})</g), ...source.matchAll(/[qa]:"([^"]{12,})"/g)].map((match) => match[1].replace(/\s+/g, " ").trim());
    return texts.flatMap((text) => text.split(/(?<=\.)\s+/)).filter((sentence) => sentence.length > 15);
  };
  let checked = 0;
  for (const slug of ["terms", "privacy", "about", "help"] as const) {
    let sentences: string[] = [];
    try { sentences = sentencesOf(slug); } catch { gitAvailable = false; break; }
    const body = CONTENT_PAGE_DEFAULTS[slug].body.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*/g, "").replace(/\s+/g, " ");
    for (const sentence of sentences) {
      if (/^(Hamısı|Platforma haqqında|Məlumat)$/.test(sentence)) continue;
      assert.ok(body.includes(sentence) || CONTENT_PAGE_DEFAULTS[slug].title === sentence, `${slug}: "${sentence}" kept`);
      checked += 1;
    }
  }
  if (gitAvailable) assert.ok(checked >= 10, `checked ${checked} sentences`);
});
