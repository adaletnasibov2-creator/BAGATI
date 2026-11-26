/**
 * ADMIN-DESIGN-2: the remaining admin pages on the kit and tokens (visual only) + the "%" search gap.
 *  - no old admin palette (hex or slate-*) in any admin file except /admin/login;
 *  - no new or removed visible text, no added logic calls (same counts) in the restyled files, against main 4148b5c;
 *  - the scope list equals the real diff; the two API routes changed only their q-filter lines;
 *  - one escaping helper for every admin ?q= filter: % _ \ literal, case-insensitive match kept.
 * The 5433 proof is scripts/admin-design-2.integration.test.ts (+ live HTTP checks in the report).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { adminLikePattern, adminSearchContains, adminSearchContainsExact } from "../lib/admin-list-where";
import { ADMIN_DESIGN_2_API_ROUTES, ADMIN_DESIGN_2_FILES } from "./admin-design-2-scope";
import { isAllowedAdminChange } from "./admin-power-1-scope";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const BASE = "4148b5c";
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const baseFile = (path: string) => { try { return git("show", `${BASE}:${path}`).replace(/\r\n/g, "\n"); } catch { return ""; } };
const walk = (dir: string): string[] => readdirSync(join(root, dir)).flatMap((name) => {
  const path = `${dir}/${name}`;
  return statSync(join(root, path)).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
});
const ADMIN_FILES = [...walk("app/admin"), ...walk("components").filter((path) => /^components\/admin/.test(path))];
const LOGIN = new Set(["app/admin/login/page.tsx", "components/admin-login-form.tsx"]);
const OLD_PALETTE = /#(173c40|e7e3d9|9b7840|f8f7f4|ded9cf|0d1b2a|142d38|0b1726|85621d|c7ad78|bd9a5e|eeeae2|f0ece4|fbfaf7|f3f1ec|1f5a4f|122e2e|c79a52|f5f3ee)\b|\bslate-\d{2,3}\b/i;
const RESTYLED = [...ADMIN_DESIGN_2_FILES].filter((path) => !(ADMIN_DESIGN_2_API_ROUTES as readonly string[]).includes(path));

test("no old admin palette (hex or slate-*) in any admin file; /admin/login untouched", () => {
  const hits = ADMIN_FILES.filter((path) => !LOGIN.has(path) && OLD_PALETTE.test(read(path)));
  assert.deepEqual(hits, []);
  // MULTI-PROCESS-1: on the task commit (BASE..COMMIT), not the working tree: later tasks may change package.json.
  assert.equal(git("diff", "--name-only", BASE, COMMIT, "--", ...LOGIN, "app/admin/layout.tsx", "middleware.ts", "app/robots.ts", "lib/legal", "app/(customer)/terms", "app/(customer)/privacy", "app/(customer)/seller-terms", "prisma", "package.json", "package-lock.json").trim(), "");
});

// CLEANUP-2: the scope is checked on the ADMIN-DESIGN-2 commit (62d2448), not on the working tree: after the merge,
// every later branch changes other files, and a tree diff against 4148b5c would fail on them (same as admin-design-1).
const COMMIT = "62d2448";
test("scope: the list equals the real diff of admin files and admin API routes", () => {
  const changed = git("diff", "--name-only", BASE, COMMIT, "--", "app/admin", "app/api/admin", "components").split(/\r?\n/).filter((path) => /^(app\/admin\/|app\/api\/admin\/|components\/admin)/.test(path));
  assert.deepEqual(changed.sort(), [...ADMIN_DESIGN_2_FILES].sort());
  for (const path of changed) assert.ok(isAllowedAdminChange(path), path);
  // Outside admin files only the escaping helper's callers changed (lib), plus tests.
  const other = git("diff", "--name-only", BASE, COMMIT).split(/\r?\n/).filter((path) => path && !/^(app\/admin\/|app\/api\/admin\/|components\/admin|scripts\/)/.test(path));
  assert.deepEqual(other.sort(), ["lib/admin-list-where.ts", "lib/security-center-data.ts", "lib/seller-application-service.ts", "lib/voen-verification.ts"]);
});

// Visible words: Azerbaijani fragments (as in the order-notify-1 text pin) and plain JSX text nodes.
const AZ = /[əğıöşüçƏĞİÖŞÜÇ]/;
const code = (source: string) => source.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*\*|\{\/\*)/.test(line)).join("\n");
const fragments = (source: string) => new Set(code(source).split(/["'`<>{}]|\$\{/).map((part) => part.trim()).filter((part) => AZ.test(part)));
// `(?<!=)`: the ">" of an arrow function (`=>`) is code, not the end of a tag.
const textNodes = (source: string) => new Set([...code(source).matchAll(/(?<!=)>([^<>{}]*[A-Za-z][^<>{}]*)</g)].map((match) => match[1].trim()).filter((text) => text && !/[=;()]/.test(text)));

test("texts: no new and no removed visible words in the restyled files", () => {
  for (const path of RESTYLED) {
    const before = baseFile(path), after = read(path);
    const b = fragments(before), a = fragments(after);
    assert.deepEqual([...a].filter((part) => !b.has(part)), [], `${path}: new Azerbaijani text`);
    assert.deepEqual([...b].filter((part) => !a.has(part)), [], `${path}: removed Azerbaijani text`);
    const bt = textNodes(before);
    assert.deepEqual([...textNodes(after)].filter((text) => !bt.has(text) && !b.has(text)), [], `${path}: new text node`);
  }
});

test("no logic change: the same number of data reads, auth checks, redirects, requests and handlers per file", () => {
  const LOGIC = { prisma: /prisma\./g, query: /\$query/g, role: /requireRole\(/g, redirect: /redirect\(/g, fetch: /fetch\(/g, await: /\bawait\b/g, method: /method[=:]/g, action: /\baction=/g, submit: /onSubmit/g, click: /onClick/g, change: /onChange/g };
  for (const path of RESTYLED) {
    const before = baseFile(path), after = read(path);
    for (const [name, pattern] of Object.entries(LOGIC)) assert.equal((after.match(pattern) ?? []).length, (before.match(pattern) ?? []).length, `${path}: ${name}`);
  }
});

test("escaping helper: % _ \\ are literal, ordinary text unchanged, case-insensitive match kept", () => {
  assert.deepEqual(adminSearchContains("50%_off\\x"), { contains: "50\\%\\_off\\\\x", mode: "insensitive" });
  assert.deepEqual(adminSearchContains("Moda Evi"), { contains: "Moda Evi", mode: "insensitive" });
  assert.deepEqual(adminSearchContainsExact("198.51.100.%"), { contains: "198.51.100.\\%" });
  assert.equal(adminLikePattern("a_b%"), "%a\\_b\\%%");
  assert.equal(adminLikePattern("Leyla"), "%Leyla%");
});

test("every admin ?q= filter goes through the helper (pages, list builders, services, the 2 approved routes)", () => {
  const SEARCH_FILES = [
    ...["brands", "cities", "imports", "notifications", "products", "reviews", "support", "vendors"].map((name) => `app/admin/_sections/${name}.tsx`),
    "lib/admin-list-where.ts", "lib/seller-application-service.ts", "lib/security-center-data.ts", ...ADMIN_DESIGN_2_API_ROUTES,
  ];
  for (const path of SEARCH_FILES) {
    const source = read(path);
    assert.doesNotMatch(source, /contains: ?(q|query|input\.q)\b/, `${path}: raw contains on the search text`);
    assert.match(source, /adminSearchContains\(/, path);
  }
  // No admin page, admin API route or admin lib builds a raw `contains` on a search parameter any more. (The global
  // search, ADMIN-POWER-1, already escapes its term; its order lookup takes letters/digits only.)
  for (const path of [...walk("app/admin"), ...walk("app/api/admin"), ...walk("lib").filter((p) => /^lib\/(admin|seller-application|security-center|voen)/.test(p))]) {
    assert.doesNotMatch(read(path), /contains: ?(q|query|input\.q)\b(?!\.)/, path);
  }
  assert.match(read("lib/admin-global-search.ts"), /name: like\(term\.like\)/);
  const voen = read("lib/voen-verification.ts");
  assert.match(voen, /ILIKE \$\{adminLikePattern\(q\)\} OR u\."email" ILIKE \$\{adminLikePattern\(q\)\}/);
  assert.doesNotMatch(voen, /ILIKE \$\{`%\$\{q\}%`\}/);
});

test("the 2 approved API routes changed only their q-filter lines (+ the helper import)", () => {
  for (const path of ADMIN_DESIGN_2_API_ROUTES) {
    const diff = git("diff", BASE, "--", path).split(/\r?\n/).filter((line) => /^[+-][^+-]/.test(line));
    for (const line of diff) assert.match(line, /contains: ?(q|query), mode: "insensitive"|adminSearchContains\((q|query)\)|^\+import \{ adminSearchContains \} from "@\/lib\/admin-list-where";/, `${path}: ${line}`);
  }
});

test("lib changes: only the escaping swap (no other logic)", () => {
  for (const path of ["lib/security-center-data.ts", "lib/seller-application-service.ts", "lib/voen-verification.ts"]) {
    const diff = git("diff", BASE, "--", path).split(/\r?\n/).filter((line) => /^[+-][^+-]/.test(line));
    for (const line of diff) assert.match(line, /contains|adminSearchContains|adminLikePattern|ILIKE|^\+import \{ [\w, ]+ \} from "@\/lib\/admin-list-where";/, `${path}: ${line}`);
  }
});

test("mobile: the message-reports list uses the kit table (cards under 768 px); the audited link still never prefetches", () => {
  const list = read("app/admin/messages/reports/page.tsx");
  assert.match(list, /<DataTable rows=\{items\}/);
  assert.doesNotMatch(list, /min-w-\[720px\]/);
  assert.match(list, /<Link prefetch=\{false\} href=\{`\/admin\/messages\/reports\/\$\{encodeURIComponent\(item\.id\)\}`\}/);
});

test("headers: shared PageHeader / detail header on the standalone pages; back links only with existing wording", () => {
  for (const path of ["app/admin/audit-log/page.tsx", "app/admin/security/page.tsx", "app/admin/verification/page.tsx", "app/admin/voen/page.tsx", "components/admin-system-status.tsx"]) assert.match(read(path), /<PageHeader title="/, path);
  assert.match(read("app/admin/_sections/stores-new.tsx"), /<AdminDetailHeader back=\{ADMIN_BACK_LINKS\.stores\} title="Mağaza yarat"/);
  assert.match(read("app/admin/_sections/vendors-new.tsx"), /<AdminDetailHeader back=\{ADMIN_BACK_LINKS\.vendors\} title="Satıcı hesabı yarat"/);
  for (const path of ["app/admin/_sections/product-detail.tsx", "app/admin/_sections/support-detail.tsx"]) assert.match(read(path), /<AdminDetailHeader title=\{/, `${path}: header without a new back-link text`);
});
