/**
 * Admin content pages (/admin/pages): API check order, editor wiring, navigation. Source-level (the database
 * behaviour is covered by content-pages.integration.test.ts).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ADMIN_NAV_GROUPS } from "../lib/admin-nav";

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8").replace(/\r\n/g, "\n");

test("save and restore APIs: same-origin -> ADMIN -> known slug -> bounded body -> validation -> one transaction", () => {
  for (const [file, call] of [["app/api/admin/pages/[slug]/route.ts", "saveContentPage("], ["app/api/admin/pages/[slug]/restore/route.ts", "restoreContentRevision("]] as const) {
    const source = read(file);
    const order = ["csrfRejection(request)", 'requireRole("ADMIN")', "isContentPageSlug(slug)", "readJsonBodyLimited(request", ".safeParse(body.value)", call].map((needle) => source.indexOf(needle));
    assert.ok(order.every((position) => position > 0), `${file}: every step present`);
    assert.deepEqual([...order].sort((a, b) => a - b), order, `${file}: in order`);
    assert.match(source, /status: 409/);
    assert.match(source, /"Cache-Control": "no-store"/);
    assert.doesNotMatch(source, /^export const (?!dynamic)/m, `${file}: only route exports`);
  }
  assert.match(read("lib/content-pages-admin.ts"), /SELECT "id", "updatedAt" FROM "ContentPage" WHERE "slug" = \$\{slug\} FOR UPDATE/);
  assert.match(read("lib/content-pages-admin.ts"), /action: "CONTENT_PAGE_UPDATE"/);
  assert.match(read("lib/content-pages-admin.ts"), /action: "CONTENT_PAGE_RESTORE"/);
});

test("editor: preview with the same safe renderer, confirm before restore, sends the version it was opened with", () => {
  const editor = read("components/admin-content-page-editor.tsx");
  assert.match(editor, /^"use client";/);
  assert.match(editor, /<ContentBody body=\{body\} \/>/);
  assert.match(editor, /await confirm\(\{ title: "Bu versiyaya qayıt"/);
  assert.match(editor, /expectedUpdatedAt: data\.updatedAt/);
  assert.match(editor, />Bu versiyaya qayıt<\/button>/);
  assert.doesNotMatch(editor, /dangerouslySetInnerHTML|@\/lib\/settings|@\/lib\/prisma/);
  const list = read("app/admin/_sections/pages.tsx");
  assert.match(list, /label: "Son yenilənmə"/);
  const index = read("app/admin/_sections/index.ts");
  assert.match(index, /\{ match: \(\{ route \}\) => route==="pages", render: renderPages \}/);
  assert.match(index, /\{ match: \(\{ parts \}\) => parts\[0\]==="pages"&&parts\.length===2, render: renderPageEditor \}/);
  assert.match(read("app/admin/_sections/page-editor.tsx"), /if \(!isContentPageSlug\(slug\)\) notFound\(\);/);
});

test("navigation: Səhifələr in the Məzmun group", () => {
  const content = ADMIN_NAV_GROUPS.find((group) => group.id === "content");
  assert.ok(content?.items.some(([href, label]) => href === "/admin/pages" && label === "Səhifələr"));
});
