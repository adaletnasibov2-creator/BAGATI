/**
 * Content pages: built-in texts (= today's texts), input rules, seed SQL and the migration file. No database.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { CONTENT_PAGE_DEFAULTS, CONTENT_PAGE_META, CONTENT_PAGE_SLUGS, CONTENT_REVISIONS_KEPT, contentPageRestoreSchema, contentPageSaveSchema, isContentPageSlug } from "../lib/content-pages";
import { CONTENT_BODY_MAX, parseContent } from "../lib/content-markup";
import { SEED_NOTE, seedSql } from "./seed-content-pages";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("four pages, closed slug set, 20 revisions kept", () => {
  assert.deepEqual([...CONTENT_PAGE_SLUGS], ["terms", "privacy", "about", "help"]);
  assert.equal(CONTENT_REVISIONS_KEPT, 20);
  assert.equal(isContentPageSlug("terms"), true);
  for (const bad of ["contact", "TERMS", "../terms", "", null]) assert.equal(isContentPageSlug(bad), false, String(bad));
  assert.deepEqual(CONTENT_PAGE_SLUGS.map((slug) => CONTENT_PAGE_META[slug].path), ["/terms", "/privacy", "/about", "/help"]);
  assert.deepEqual(CONTENT_PAGE_SLUGS.filter((slug) => CONTENT_PAGE_META[slug].showUpdatedAt), ["terms", "privacy"]);
});

test("built-in texts keep today's wording and only use the safe format", () => {
  const texts: Record<string, string[]> = {
    terms: ["Hüquqi yoxlama üçün ilkin layihə — yekun təsdiq tələb olunur.", "Hazırda burada təsdiqlənmiş istifadə şərtləri dərc olunmayıb.", "[buradan](/delivery-returns)", "[dəstəyə müraciət edin](/support)"],
    privacy: ["Hazırda burada təsdiqlənmiş gizlilik siyasəti dərc olunmayıb.", "[dəstək bölməsinə](/support)"],
    about: ["BAGATI müştərilərə platformada qeydiyyatdan keçmiş aktiv mağazaların məhsullarına baxmaq", "[Mağazalara bax](/stores)", "[Əlaqə](/contact)"],
    help: ["Səbətimdə müxtəlif mağazalardan məhsul ola bilərmi?", "Ödəniş provayderi hələ qoşulmayıb.", "Şəhərimi necə dəyişə bilərəm?", "[Dəstək müraciəti göndərin.](/support)"],
  };
  for (const slug of CONTENT_PAGE_SLUGS) {
    const { title, body } = CONTENT_PAGE_DEFAULTS[slug];
    assert.ok(title.length > 0 && title.length <= 160, slug);
    for (const text of texts[slug]) assert.ok(body.includes(text), `${slug}: ${text}`);
    assert.doesNotMatch(body, /<[a-z]/i, `${slug}: no HTML`);
    assert.ok(parseContent(body).length > 0, `${slug}: renders`);
    // The hard-coded wording is still the reference: each old page file contains the same sentences.
  }
  assert.equal(parseContent(CONTENT_PAGE_DEFAULTS.help.body).filter((block) => block.type === "heading").length, 4, "four questions");
});

test("save input: trimmed one-line title, body 1..50 000, short note, expected version", () => {
  const ok = contentPageSaveSchema.safeParse({ title: "  İstifadə\n şərtləri ", body: "\r\n## Başlıq\r\nMətn\r\n", note: "  düzəliş   edildi ", expectedUpdatedAt: null });
  assert.ok(ok.success);
  assert.deepEqual(ok.success && { title: ok.data.title, body: ok.data.body, note: ok.data.note }, { title: "İstifadə şərtləri", body: "## Başlıq\nMətn", note: "düzəliş edildi" });
  assert.equal(contentPageSaveSchema.safeParse({ title: " ", body: "x", expectedUpdatedAt: null }).success, false);
  assert.equal(contentPageSaveSchema.safeParse({ title: "x", body: "  ", expectedUpdatedAt: null }).success, false);
  assert.equal(contentPageSaveSchema.safeParse({ title: "x", body: "y".repeat(CONTENT_BODY_MAX + 1), expectedUpdatedAt: null }).success, false);
  assert.equal(contentPageSaveSchema.safeParse({ title: "x".repeat(161), body: "y", expectedUpdatedAt: null }).success, false);
  assert.equal(contentPageSaveSchema.safeParse({ title: "x", body: "y", expectedUpdatedAt: "dünən" }).success, false);
  assert.equal(contentPageSaveSchema.safeParse({ title: "x", body: "y", expectedUpdatedAt: null, published: false }).success, false, "strict: no extra fields");
  assert.equal(contentPageRestoreSchema.safeParse({ revisionId: "abc", expectedUpdatedAt: "2026-11-14T10:00:00.000Z" }).success, true);
});

test("seed SQL: idempotent insert per slug, one initial revision only for a new page, dollar quoting", () => {
  const sql = seedSql();
  for (const slug of CONTENT_PAGE_SLUGS) assert.match(sql, new RegExp(`VALUES \\(gen_random_uuid\\(\\)::text, '${slug}', `));
  assert.equal(sql.split('ON CONFLICT ("slug") DO NOTHING RETURNING').length - 1, 4);
  assert.equal(sql.split("FROM page;").length - 1, 4, "revision only for rows inserted now");
  assert.ok(sql.includes(SEED_NOTE));
  assert.match(sql, /^BEGIN;$/m);
  assert.match(sql, /^COMMIT;$/m);
  // Every text (title, body, note) of the 4 pages is a dollar-quoted literal: 12 literals, 24 tags.
  assert.equal(sql.split("$c$").length - 1, 24, "texts are dollar-quoted");
  assert.match(sql, /RAISE EXCEPTION 'ABORT: table ContentPage not found/);
});

test("migration: additive tables with CHECKs on slugs, title and lengths; checksum recorded in the release SQL", () => {
  // LF-normalised: with core.autocrlf=true a Windows checkout has CRLF; Prisma's recorded checksum is of the LF file.
  const migration = read("prisma/migrations/20261114030000_content_pages/migration.sql").replace(/\r\n/g, "\n");
  assert.doesNotMatch(migration, /\bDROP\b|\bALTER TABLE "(?!ContentPage)/, "touches only the new tables");
  assert.match(migration, /"slug" IN \('terms', 'privacy', 'about', 'help'\)/);
  assert.match(migration, /char_length\("body"\) <= 50000/);
  assert.match(migration, /"note" IS NULL OR char_length\("note"\) <= 200/);
  assert.match(migration, /ON DELETE SET NULL/);
  const checksum = createHash("sha256").update(migration).digest("hex");
  assert.equal(checksum, "275a9851704cf041b662029a3e5f4415c9ede8b1cfeb5eb278f7caf55bcbd94a", "matches the checksum written into release-output/prod-migration-20261114030000.sql");
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /model ContentPage \{[\s\S]*slug\s+String\s+@unique @db\.VarChar\(32\)/);
  assert.match(schema, /model ContentPageRevision \{[\s\S]*@@index\(\[pageId, createdAt\]\)/);
});
