/**
 * ADMIN-DESIGN-1: the admin panel in the seller panel's design language (visual and layout only).
 *  - scope: only the listed admin UI files changed (scripts/admin-design-1-scope.ts); admin APIs, the admin noindex
 *    layout, middleware, robots, legal pages, lib/legal, Prisma and package.json are untouched;
 *  - no new visible text and no removed text except the old inline header of /admin/seller-applications (now PageHeader,
 *    same words); no new data reads, auth checks or requests; the dashboard queries are byte-identical;
 *  - the old admin hex palette is gone from the restyled files; the kit uses the seller tokens.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ADMIN_DESIGN_1_FILES } from "./admin-design-1-scope";
import { StatCard } from "../components/admin-ui/stat-card";
import { buttonClass, cardClass, focusRing, inputClass } from "../components/admin-ui/styles";

(globalThis as { React?: typeof React }).React = React;

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const BASE = "fea627a";
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const baseFile = (path: string) => { try { return git("show", `${BASE}:${path}`).replace(/\r\n/g, "\n"); } catch { return ""; } };
// ADMIN-POWER-1: this task's own commit is checked (later owner-approved admin tasks change these files again).
const TASK = "43793b0";
const taskFile = (path: string) => { try { return git("show", `${TASK}:${path}`).replace(/\r\n/g, "\n"); } catch { return ""; } };
const FILES = [...ADMIN_DESIGN_1_FILES];

test("scope: only the listed admin UI files; APIs, noindex layout, middleware, robots, legal, Prisma and packages untouched", () => {
  const changed = git("diff", "--name-only", BASE, TASK, "--", "app/admin", "components").split(/\r?\n/).filter((path) => /^(app\/admin\/|components\/admin)/.test(path));
  assert.deepEqual(changed.filter((path) => !ADMIN_DESIGN_1_FILES.has(path)), []);
  for (const path of FILES) assert.notEqual(taskFile(path), baseFile(path), `${path} is listed, so it changed`);
  assert.equal(git("diff", "--name-only", BASE, TASK, "--", "app/api", "app/admin/layout.tsx", "middleware.ts", "app/robots.ts", "lib/admin-surface.ts", "lib/legal", "lib/auth.ts", "lib/admin-nav.ts", "prisma", "package.json", "package-lock.json", "app/(customer)/terms", "app/(customer)/privacy", "app/(customer)/seller-terms").trim(), "");
});

// Visible words: Azerbaijani fragments (as in the order-notify-1 text pin) and plain JSX text nodes.
const AZ = /[əğıöşüçƏĞİÖŞÜÇ]/;
const code = (source: string) => source.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*\*|\{\/\*)/.test(line)).join("\n");
const fragments = (source: string) => new Set(code(source).split(/["'`<>{}]|\$\{/).map((part) => part.trim()).filter((part) => AZ.test(part)));
const textNodes = (source: string) => new Set([...code(source).matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)].map((match) => match[1].trim()).filter((text) => text && !/[=;()]/.test(text)));

test("texts: no new visible words and none removed (the applications kicker now comes from PageHeader's default)", () => {
  for (const path of FILES) {
    const before = baseFile(path), after = taskFile(path);
    const beforeAz = fragments(before), afterAz = fragments(after);
    assert.deepEqual([...afterAz].filter((part) => !beforeAz.has(part)), [], `${path}: new Azerbaijani text`);
    const beforeText = textNodes(before);
    assert.deepEqual([...textNodes(after)].filter((text) => !beforeText.has(text) && !beforeAz.has(text)), [], `${path}: new text node`);
    assert.deepEqual([...beforeAz].filter((part) => !afterAz.has(part)), [], `${path}: removed text`);
  }
  // The applications page's old inline kicker "BAGATI · ADMIN" is PageHeader's default eyebrow (same words).
  assert.match(taskFile("app/admin/seller-applications/page.tsx"), /<PageHeader title="Satıcı müraciətləri" description="/);
  assert.match(read("components/admin-ui/page-header.tsx"), /eyebrow = "BAGATI · ADMIN"/);
});

test("no logic change: the same number of data reads, auth checks, redirects, requests and handlers in every file", () => {
  const LOGIC = { prisma: /prisma\./g, query: /\$query/g, role: /requireRole\(/g, redirect: /redirect\(/g, fetch: /fetch\(/g, await: /\bawait\b/g, method: /method[=:]/g, action: /\baction=/g, submit: /onSubmit/g, click: /onClick/g, change: /onChange/g, href: /href=/g };
  for (const path of FILES) {
    const before = baseFile(path), after = taskFile(path);
    for (const [name, pattern] of Object.entries(LOGIC)) assert.equal((after.match(pattern) ?? []).length, (before.match(pattern) ?? []).length, `${path}: ${name}`);
  }
  // Dashboard: the same queries (byte-identical Promise.all block) and the same 11 cards with the same links.
  const block = (source: string) => source.slice(source.indexOf("await Promise.all(["), source.indexOf("const stats = ["));
  assert.equal(block(taskFile("app/admin/page.tsx")), block(baseFile("app/admin/page.tsx")));
  const stats = (source: string) => source.slice(source.indexOf("const stats = ["), source.indexOf("] as const;"));
  assert.equal(stats(taskFile("app/admin/page.tsx")), stats(baseFile("app/admin/page.tsx")));
  // Attention edge only on the two "waiting" counts, and only above 0 (no invented signal).
  assert.match(taskFile("app/admin/page.tsx"), /const ATTENTION_HREFS = new Set<string>\(\["\/admin\/stores\?status=PENDING_REVIEW", ADMIN_PENDING_ORDERS_HREF\]\);/);
  assert.match(taskFile("app/admin/page.tsx"), /attention=\{ATTENTION_HREFS\.has\(href\) && value > 0\}/);
});

test("look: seller-panel tokens; the old admin hex palette is gone from the restyled files", () => {
  for (const path of FILES) assert.doesNotMatch(read(path), /#173c40|#e7e3d9|#9b7840|#f8f7f4|#ded9cf|#122E2E|#C79A52|#0d1b2a/i, path);
  assert.equal(cardClass, "rounded-card border border-line bg-white p-5");
  assert.match(inputClass, /rounded-control border border-line-strong/);
  assert.match(buttonClass("primary"), /bg-primary text-white/);
  assert.equal(focusRing, "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus");
  const shell = read("components/admin-shell.tsx");
  assert.match(shell, /<aside className="fixed inset-y-0 left-0 z-30 hidden w-\[264px\] flex-col border-r border-line bg-white p-4 lg:flex">/);
  assert.match(shell, /bg-primary-tint font-semibold text-primary before:absolute/, "active page: green tint, bar, bold text (+ aria-current)");
  assert.match(shell, /text-kicker uppercase text-gold-700/, "gold group kickers");
  assert.doesNotMatch(shell, /VendorTheme|bagati-vendor|public-fonts/, "no seller or public theme scope in admin");
});

test("StatCard: decorative icon is hidden from screen readers; attention adds a gold edge, never text", () => {
  const plain = renderToStaticMarkup(createElement(StatCard, { label: "Sifarişlər", value: 3, href: "/admin/orders", icon: createElement("svg") }));
  assert.match(plain, /<span aria-hidden="true"[^>]*><svg><\/svg><\/span>/);
  assert.match(plain, /border-line/);
  const attention = renderToStaticMarkup(createElement(StatCard, { label: "Gözləyən sifarişlər", value: 4, attention: true }));
  assert.match(attention, /border-gold-200/);
  assert.equal(attention.replace(/<[^>]+>/g, ""), "Gözləyən sifarişlər4");
});
