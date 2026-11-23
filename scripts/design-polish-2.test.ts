/**
 * DESIGN-POLISH-2: two-colour header icons with visible labels (owner's variant 2), same icon family on the card heart,
 * the bottom-bar cart and the card button; small gold accents. Unit checks only (the live check is in the report).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BagIcon, HeartIcon, UserIcon } from "../components/header-icons";
import { headerActionCircle, headerActionItem, headerActionLabel } from "../components/header-actions";
import { headerBadgeText } from "../lib/cart-events";

// tsx compiles the components' JSX with the classic runtime, which needs a global React (as in admin-ui-kit.test.ts).
(globalThis as { React?: typeof React }).React = React;

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const BASE = "3a00ab8";
function baseFile(path: string) {
  try { return execFileSync("git", ["show", `${BASE}:${path}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).replace(/\r\n/g, "\n"); } catch { return ""; }
}

test("the three approved labels are the visible text of the header items", () => {
  const actions = read("components/header-actions.tsx"), account = read("components/customer-account-menu.tsx");
  assert.match(actions, /<ActionLink href="\/favorites" label="Sevimlilərim" /);
  assert.match(actions, /<ActionLink href="\/cart" label="Səbətim" /);
  assert.match(actions, /<span data-header-label="" className=\{headerActionLabel\}>\{label\}<\/span>/);
  assert.match(account, /<span data-header-label="" className=\{headerActionLabel\}>Hesabım<\/span><\/summary>/);
  assert.match(account, /<span data-header-label="" className=\{headerActionLabel\}>Giriş<\/span><\/Link>/, "guest keeps the existing word");
  assert.match(account, />Qeydiyyat<\/Link>/, "guest keeps Qeydiyyat");
});

test("no aria-label that contradicts the visible label (WCAG 2.5.3)", () => {
  const actions = read("components/header-actions.tsx"), account = read("components/customer-account-menu.tsx");
  assert.doesNotMatch(actions, /aria-label=/, "favourites and cart are named by their visible label");
  assert.doesNotMatch(actions, /"Sevimlilər"|"Səbət"/, "the old names are gone");
  assert.doesNotMatch(account, /<Link href="\/login" aria-label=/, "guest Giriş is named by its label");
  // The account summary keeps the name and role for screen readers, but the name STARTS with the visible label.
  assert.match(account, /<summary aria-label=\{`Hesabım, \$\{user\.displayName\}, \$\{roleLabel\}`\}/);
});

test("labels: visible from 768 px (13 px, weight 500, #173a3a, one line), sr-only below", () => {
  assert.match(headerActionLabel, /^sr-only md:not-sr-only md:whitespace-nowrap md:text-\[13px\] md:font-medium md:leading-4 md:text-fg /);
  assert.match(headerActionLabel, /md:group-hover\/action:text-primary/);
  assert.match(headerActionItem, /min-h-11 min-w-11 .*flex-col .*gap-1 /, "icon above label, 4 px gap, 44 px target");
  assert.match(headerActionItem, /focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus/);
  assert.match(headerActionCircle, /h-11 w-11 .*md:h-12 md:w-12/, "44 px circle on phones, 48 px from 768 px");
  assert.match(headerActionCircle, /bg-brand-100 group-hover\/action:bg-brand-200/);
  assert.match(headerActionCircle, /motion-safe:group-active\/action:scale-95/, "pressed state, no motion when reduced");
});

test("badge: real numbers only, hidden at 0, 99+ cap, aria-hidden, 20 px, 12 px weight 500, 2 px white border", () => {
  assert.equal(headerBadgeText(0), null); assert.equal(headerBadgeText(null), null); assert.equal(headerBadgeText(3), "3"); assert.equal(headerBadgeText(120), "99+");
  const actions = read("components/header-actions.tsx");
  assert.match(actions, /const text = headerBadgeText\(count\);\n  if \(!text\) return null;/);
  assert.match(actions, /<span aria-hidden="true" data-header-count="" className="pointer-events-none absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full border-2 border-white bg-primary px-1 text-\[12px\] font-medium /);
  assert.match(actions, /icon=\{<HeartIcon size=\{30\} filled=\{\(count \?\? 0\) > 0\} \/>\}/, "filled heart only with saved favourites");
});

test("icons: the owner's drawings, token colours that render exactly as the mock, aria-hidden, 30 px", () => {
  const heart = renderToStaticMarkup(h(HeartIcon, {})), bag = renderToStaticMarkup(h(BagIcon, {})), user = renderToStaticMarkup(h(UserIcon, {}));
  for (const svg of [heart, bag, user]) {
    assert.match(svg, /^<svg aria-hidden="true" focusable="false" width="30" height="30" viewBox="0 0 24 24" fill="none"/);
    assert.doesNotMatch(svg, /#[0-9a-f]{3,6}/i, "colours come from tokens");
  }
  assert.match(heart, /d="M12 20.8s-7.2-4.5-9.6-9.1C.8 8.5 2.3 4.8 6 4.8c2.2 0 3.7 1.2 6 3.6 2.3-2.4 3.8-3.6 6-3.6 3.7 0 5.2 3.7 3.6 6.9-2.4 4.6-9.6 9.1-9.6 9.1z" class="fill-gold-100 stroke-primary" stroke-width="1.8" stroke-linejoin="round"/);
  assert.match(heart, /d="M6.2 8.1c-.9.3-1.5 1.1-1.6 2.2" class="stroke-gold-400" stroke-width="1.8" stroke-linecap="round"/);
  assert.match(bag, /d="M5.2 8.2h13.6l-1.1 11.3a1.6 1.6 0 0 1-1.6 1.4H7.9a1.6 1.6 0 0 1-1.6-1.4L5.2 8.2z" class="fill-gold-100 stroke-primary" stroke-width="1.8" stroke-linejoin="round"/);
  assert.match(bag, /d="M8.8 10.6V7.4a3.2 3.2 0 0 1 6.4 0v3.2" class="stroke-primary" stroke-width="1.8" stroke-linecap="round"/);
  assert.match(bag, /<circle cx="12" cy="14.6" r="1.3" class="fill-gold-400"/);
  assert.match(renderToStaticMarkup(h(HeartIcon, { filled: true })), /class="fill-gold-400 \[fill-opacity:0.35\] stroke-primary"/);
  assert.match(renderToStaticMarkup(h(BagIcon, { onDark: true })), /class="fill-none stroke-white"/);
  // Tokens = the mock's hex values.
  const css = read("app/globals.css");
  assert.match(css, /--bagati-cream: #f3e9d5;/); assert.match(css, /--bagati-gold-100: var\(--bagati-cream\);/);
  assert.match(css, /--bagati-primary: #174746;/); assert.match(css, /--bagati-gold: #c79a52;/); assert.match(css, /--bagati-gold-400: var\(--bagati-gold\);/);
});

test("same icon family: card heart 22 px with the filled state, bottom-bar cart, card button bag 18 px", () => {
  const toggle = read("components/favorite-toggle.tsx");
  assert.match(toggle, /<HeartIcon size=\{22\} filled=\{saved\} \/>/);
  // On a white button 35 % gold alone looks like the cream fill, so the saved button is also cream with a gold border.
  assert.match(toggle, /aria-pressed:border-gold-600 aria-pressed:bg-gold-100/);
  assert.match(read("components/mobile-bottom-nav.tsx"), /\{href === "\/cart" \? <BagIcon size=\{24\} \/> : <Icon size=\{22\} /);
  assert.match(read("components/quick-add-to-cart.tsx"), /<BagIcon size=\{18\} className="shrink-0" \/>/);
});

test("gold accents: home heading underline 40x3; category tiles and store cards get a 2 px gold line on hover (CSS only)", () => {
  assert.match(read("components/home/section-heading.tsx"), /<span aria-hidden="true" data-heading-accent="" className="mt-2 block h-\[3px\] w-10 rounded-full bg-gold-400" \/>/);
  for (const path of ["app/(customer)/(home)/page.tsx", "components/home/store-strip.tsx", "components/store-card.tsx"]) {
    assert.match(read(path), /after:bottom-0 after:h-0\.5 after:rounded-full after:bg-gold-400 after:opacity-0 .*hover:after:opacity-100 motion-reduce:after:transition-none/, path);
  }
});

const AZ = /[əğıöşüçƏĞİÖŞÜÇ]/;
test("texts: only the three approved labels are new; legal pages, admin and seller files unchanged", () => {
  const changed = ["components/header-actions.tsx", "components/header-icons.tsx", "components/customer-account-menu.tsx", "components/header.tsx", "components/favorite-toggle.tsx", "components/mobile-bottom-nav.tsx", "components/quick-add-to-cart.tsx", "components/home/section-heading.tsx", "components/home/store-strip.tsx", "components/store-card.tsx", "app/(customer)/(home)/page.tsx"];
  const fragments = (source: string) => new Set(source.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*\*|\{\/\*)/.test(line)).join("\n").split(/["'`<>{}]|\$\{/).map((part) => part.trim()).filter((part) => AZ.test(part)));
  const before = new Set(changed.flatMap((path) => [...fragments(baseFile(path))]));
  const added = new Set(changed.flatMap((path) => [...fragments(read(path))].filter((fragment) => !before.has(fragment))));
  assert.deepEqual([...added].sort(), ["Hesabım", "Hesabım,", "Sevimlilərim", "Səbətim"].sort());
  for (const path of ["app/(customer)/terms/page.tsx", "app/(customer)/privacy/page.tsx", "app/(customer)/seller-terms/page.tsx"]) assert.equal(read(path), baseFile(path), path);
  const diff = execFileSync("git", ["diff", "--name-only", BASE, "--", "app/admin", "app/vendor", "components/admin-ui"], { cwd: root, encoding: "utf8" }).trim();
  assert.equal(diff, "", "admin and seller files untouched");
});
