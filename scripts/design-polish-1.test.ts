/**
 * DESIGN-POLISH-1: stronger public tokens (measured contrast), header icons and real-data badges, no new text.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { headerBadgeText } from "../lib/cart-events";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const BASE = "1ed04ed";
function baseFile(path: string) {
  try { return execFileSync("git", ["show", `${BASE}:${path}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).replace(/\r\n/g, "\n"); } catch { return ""; }
}

// ---------------------------------------------------------------- contrast (WCAG 2.x relative luminance)
function luminance(hex: string) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.replace("#", "").slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }
const WHITE = "#ffffff", PAGE = "#f7f8f6", SECTION = "#eef3f0";

function block(css: string, selector: string) { const start = css.indexOf(selector); return css.slice(start, css.indexOf("}", start)); }
function token(scope: string, name: string) { return scope.match(new RegExp(`${name}: (#[0-9a-f]{6});`, "i"))?.[1] ?? ""; }

test("public tokens: muted text >= 4.5:1 and control borders >= 3:1 on white, page and section", () => {
  const scope = block(read("app/globals.css"), "body:has(> .bagati-public),");
  const muted = token(scope, "--bagati-muted-green"), border = token(scope, "--bagati-border-strong");
  assert.equal(muted, "#4f6963"); assert.equal(border, "#6b867c");
  for (const bg of [WHITE, PAGE, SECTION]) {
    assert.ok(contrast(muted, bg) >= 4.5, `muted on ${bg}: ${contrast(muted, bg).toFixed(2)}`);
    assert.ok(contrast(border, bg) >= 3, `border on ${bg}: ${contrast(border, bg).toFixed(2)}`);
  }
  assert.ok(contrast("#173a3a", WHITE) >= 12, "icon colour");
  assert.ok(contrast(WHITE, "#174746") >= 10, "badge number on primary");
  assert.ok(contrast(WHITE, "#7a5c2e") >= 4.5, "unread number on gold-700 (was 2.63:1 on #C9973A)");
});

test("admin and the seller panel keep their token values", () => {
  const css = read("app/globals.css"), before = baseFile("app/globals.css");
  assert.equal(block(css, ":root {").replace("\n  --bagati-icon: var(--bagati-deep-teal);", ""), block(before, ":root {"), ":root only gains --bagati-icon (= deep teal)");
  assert.equal(block(css, "body:has(> .bagati-vendor),"), block(before, "body:has(> .bagati-vendor),"), "seller scope unchanged");
});

test("header badge text: real counts only, hidden for 0, capped at 99+", () => {
  assert.equal(headerBadgeText(0), null);
  assert.equal(headerBadgeText(null), null);
  assert.equal(headerBadgeText(undefined), null);
  assert.equal(headerBadgeText(-1), null);
  assert.equal(headerBadgeText(Number.NaN), null);
  assert.equal(headerBadgeText(1), "1");
  assert.equal(headerBadgeText(99), "99");
  assert.equal(headerBadgeText(100), "99+");
});

test("header icons: 24 px, stroke 2, 44 px targets, existing labels; badge hidden from screen readers", () => {
  const actions = read("components/header-actions.tsx");
  assert.match(actions, /label="Sevimlilər"/); assert.match(actions, /label="Səbət"/);
  assert.match(actions, /<span aria-hidden="true" data-header-count=""/);
  assert.match(actions, /hover:bg-primary-subtle hover:text-primary active:bg-primary-tint motion-safe:active:scale-95/);
  assert.match(actions, /focus-visible:outline-focus/);
  // Cart: the server count for signed-in customers only; guests (null) never fetch.
  assert.match(actions, /if \(initialCount === null\) return;/);
  const layout = read("app/(customer)/layout.tsx");
  assert.match(layout, /prisma\.cartItem\.count\(\{ where: \{ cart: \{ userId: user\.id \} \} \}\)/);
  assert.match(layout, /user\?\.role === "CUSTOMER"/);
});

test("cart changes notify the badge after success only", () => {
  for (const [path, pattern] of [
    ["components/add-to-cart-button.tsx", /notifyCartChanged\(\); setMessage\("Məhsul səbətə əlavə edildi\."\);/],
    ["components/quick-add-to-cart.tsx", /notifyCartChanged\(\); setMessage\("Səbətə əlavə edildi\."\);/],
    ["components/product-variant-purchase.tsx", /notifyCartChanged\(\); setMessage\(ADDED_TO_CART_MESSAGE\); router\.refresh\(\);/],
    ["components/cart-page-client.tsx", /setCart\(data\.cart\); notifyCartChanged\(/],
  ] as const) assert.match(read(path), pattern, path);
});

test("no gold focus ring on a white surface in the category menu (2.57:1)", () => {
  assert.doesNotMatch(read("components/category-mega-menu.tsx"), /outline-bagati-gold/);
});

const AZ = /[əğıöşüçƏĞİÖŞÜÇ]/;
test("texts: no new visible Azerbaijani text in the changed files; legal pages unchanged", () => {
  const changed = ["components/header.tsx", "components/header-actions.tsx", "components/customer-account-menu.tsx", "components/category-mega-menu.tsx", "components/home/hero-carousel.tsx", "components/home/product-shelf.tsx", "components/favorite-toggle.tsx", "components/mobile-bottom-nav.tsx", "components/customer-footer.tsx", "components/search-form.tsx", "app/(customer)/layout.tsx", "app/(customer)/products/(list)/page.tsx", "lib/cart-events.ts"];
  const fragments = (source: string) => new Set(source.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*\*|\{\/\*)/.test(line)).join("\n").split(/["'`<>{}]|\$\{/).map((part) => part.trim()).filter((part) => AZ.test(part)));
  const allBefore = new Set(changed.flatMap((path) => [...fragments(baseFile(path))]));
  for (const path of changed) {
    const added = [...fragments(read(path))].filter((fragment) => !allBefore.has(fragment));
    assert.deepEqual(added, [], `${path}: new Azerbaijani text`);
  }
  for (const path of ["app/(customer)/terms/page.tsx", "app/(customer)/privacy/page.tsx", "app/(customer)/seller-terms/page.tsx"]) assert.equal(read(path), baseFile(path), `${path} unchanged`);
});
