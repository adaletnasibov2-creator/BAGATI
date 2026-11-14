/**
 * Admin navigation (lib/admin-nav.ts + components/admin-shell.tsx) and the section split (app/admin/_sections).
 * No database: routes are resolved from the file system and the section router's matchers.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ADMIN_HIDDEN_ROUTES, ADMIN_NAV_GROUPS, activeAdminNavGroup, activeAdminNavHref } from "../lib/admin-nav";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const sectionIndex = read("app/admin/_sections/index.ts");
/** Single-segment routes served by the section router (route==="x"). */
const routedSections = new Set([...sectionIndex.matchAll(/route==="([a-z/-]+)"/g)].map((match) => `/admin/${match[1]}`));

function routeExists(href: string): boolean {
  if (href === "/admin") return existsSync(join(root, "app/admin/page.tsx"));
  if (existsSync(join(root, "app", href, "page.tsx"))) return true;
  return routedSections.has(href);
}

const navItems = ADMIN_NAV_GROUPS.flatMap((group) => group.items.map(([href, label]) => ({ href, label, group: group.id })));

test("groups: Satış, Kataloq, Mağazalar, Məzmun, Sistem, each non-empty", () => {
  assert.deepEqual(ADMIN_NAV_GROUPS.map((group) => group.label), ["Satış", "Kataloq", "Mağazalar", "Məzmun", "Sistem"]);
  for (const group of ADMIN_NAV_GROUPS) assert.ok(group.items.length > 0, group.id);
  assert.equal(new Set(navItems.map((item) => item.href)).size, navItems.length, "no page listed twice");
});

test("every menu link points to an existing admin route", () => {
  for (const item of navItems) assert.ok(routeExists(item.href), `${item.href} (${item.label}) has no page`);
});

test("stub pages are hidden from the menu but still reachable", () => {
  assert.deepEqual([...ADMIN_HIDDEN_ROUTES], ["/admin/payments", "/admin/refunds"]);
  for (const href of ADMIN_HIDDEN_ROUTES) {
    assert.ok(!navItems.some((item) => item.href === href), `${href} hidden`);
    assert.ok(routeExists(href), `${href} still routed`);
  }
});

test("no page disappeared from the menu: every former menu item is still listed (except the two stubs)", () => {
  const former = ["/admin/security-center", "/admin/security", "/admin/security/sessions", "/admin", "/admin/settings", "/admin/homepage", "/admin/promotions", "/admin/stores", "/admin/vendors", "/admin/seller-applications", "/admin/customers", "/admin/verification", "/admin/products", "/admin/categories", "/admin/brands", "/admin/cities", "/admin/orders", "/admin/subscriptions", "/admin/commissions", "/admin/payments", "/admin/returns", "/admin/refunds", "/admin/reviews", "/admin/support", "/admin/imports", "/admin/reports", "/admin/notifications", "/admin/email", "/admin/system", "/admin/audit-log"];
  const listed = new Set(navItems.map((item) => item.href));
  assert.deepEqual(former.filter((href) => !listed.has(href)), ["/admin/payments", "/admin/refunds"]);
  assert.deepEqual([...listed].filter((href) => !former.includes(href)), [], "no new, unknown entries");
});

test("requested placement", () => {
  const groupOf = (href: string) => navItems.find((item) => item.href === href)?.group;
  for (const href of ["/admin", "/admin/orders", "/admin/customers", "/admin/verification"]) assert.equal(groupOf(href), "sales", href);
  for (const href of ["/admin/products", "/admin/categories", "/admin/brands"]) assert.equal(groupOf(href), "catalog", href);
  for (const href of ["/admin/stores", "/admin/seller-applications", "/admin/subscriptions", "/admin/commissions", "/admin/cities"]) assert.equal(groupOf(href), "stores", href);
  for (const href of ["/admin/homepage", "/admin/reviews", "/admin/support"]) assert.equal(groupOf(href), "content", href);
  for (const href of ["/admin/settings", "/admin/security-center", "/admin/security", "/admin/audit-log", "/admin/imports", "/admin/notifications"]) assert.equal(groupOf(href), "system", href);
  // Pages not in the requested list, placed in the closest group (agreed).
  assert.deepEqual(["/admin/returns", "/admin/reports", "/admin/vendors", "/admin/promotions", "/admin/email", "/admin/system", "/admin/security/sessions"].map(groupOf), ["sales", "sales", "stores", "content", "system", "system", "system"]);
});

test("active item is the most specific match and its group opens", () => {
  assert.equal(activeAdminNavHref("/admin"), "/admin");
  assert.equal(activeAdminNavHref("/admin/security/sessions"), "/admin/security/sessions");
  assert.equal(activeAdminNavHref("/admin/security"), "/admin/security");
  assert.equal(activeAdminNavHref("/admin/stores/abc123"), "/admin/stores");
  assert.equal(activeAdminNavHref("/admin/payments"), undefined, "a hidden page highlights nothing");
  assert.equal(activeAdminNavGroup("/admin/orders/x"), "sales");
  assert.equal(activeAdminNavGroup("/admin/security/sessions"), "system");
  assert.equal(activeAdminNavGroup("/admin/payments"), undefined);
});

test("shell: collapsible groups with aria-expanded, keyboard focus ring, active page marked; mobile drawer unchanged", () => {
  const shell = read("components/admin-shell.tsx");
  assert.match(shell, /ADMIN_NAV_GROUPS\.map\(/);
  assert.doesNotMatch(shell, /const items = \[/, "no second hard-coded list");
  assert.match(shell, /aria-expanded=\{expanded\}/);
  assert.match(shell, /aria-controls=\{listId\}/);
  assert.match(shell, /aria-current=\{href === activeHref \? "page" : undefined\}/);
  assert.match(shell, /focus-visible:outline-2/);
  assert.match(shell, /new Set\(activeGroup \? \[activeGroup\] : \[\]\)/, "the active page's group starts open");
  assert.match(shell, /const expanded = Boolean\(needle\) \|\| openGroups\.has\(group\.id\);/, "search shows every matching group");
  assert.match(shell, /role="dialog"[\s\S]*aria-modal="true"/);
  assert.match(shell, /\{navigation\(true\)\}/);
});

test("section split: thin router, typed sections, no admin file keeps the removed helpers", () => {
  const router = read("app/admin/[...section]/page.tsx");
  assert.ok(router.split("\n").length < 40, "the catch-all is a thin router");
  assert.match(router, /for \(const section of ADMIN_SECTIONS\) if \(section\.match\(\{ route, parts \}\)\) return section\.render\(ctx\);/);
  assert.doesNotMatch(router, /prisma|db:any|function (Header|Table|Pager|StatusForm|Filters)\b/);
  const sectionFiles = readdirSync(join(root, "app/admin/_sections")).filter((name) => name.endsWith(".tsx"));
  assert.equal(sectionFiles.length, 30, "29 sections + shared.tsx");
  const adminFiles = [...readdirSync(join(root, "app/admin"), { recursive: true }).map(String)].filter((name) => name.endsWith(".tsx")).map((name) => `app/admin/${name.replace(/\\/g, "/")}`);
  for (const file of adminFiles) {
    const source = read(file);
    assert.doesNotMatch(source, /from ["'][^"']*\[\.\.\.section\][^"']*["']/, `${file}: nothing imports from the catch-all`);
    if (file.startsWith("app/admin/_sections/") || file.startsWith("app/admin/[...section]/")) assert.doesNotMatch(source, /const db: ?any ?= ?prisma/, `${file}: db:any removed`);
    // Scope: the split code. (app/admin/audit-log has its own, older Pager with a different signature.)
    const splitCode = file.startsWith("app/admin/_sections/") || file.startsWith("app/admin/[...section]/");
    if (splitCode && file !== "app/admin/_sections/shared.tsx") assert.doesNotMatch(source, /^(export )?function (Header|Table|Pager|StatusForm|formatSubscriptionSummary)\(/m, `${file}: helper defined once, in shared.tsx`);
  }
  // Every section module is registered exactly once.
  for (const file of sectionFiles.filter((name) => name !== "shared.tsx")) {
    assert.equal(sectionIndex.split(`from "./${file.replace(/\.tsx$/, "")}";`).length - 1, 1, file);
  }
});
