/**
 * Mobile menu overlay: the drawer must not be trapped inside the sticky header. The header has backdrop-filter
 * (backdrop-blur), which makes it the containing block of any position:fixed descendant, so an overlay rendered
 * inside it was only as tall as the header and the homepage hero covered the rest. Source-level checks.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8").replace(/\r\n/g, "\n");
const menu = read("components/mobile-menu.tsx");

test("the drawer is portalled to <body>, above the header, hero and bottom tab bar", () => {
  assert.match(menu, /import \{ createPortal \} from "react-dom";/);
  assert.match(menu, /\{open && typeof document !== "undefined" && createPortal\(/);
  assert.match(menu, /\n\s*document\.body,\n\s*\)\}/);
  const overlay = menu.match(/<div data-mobile-menu-overlay className="([^"]+)"/)?.[1] ?? "";
  assert.match(overlay, /\bfixed\b/);
  assert.match(overlay, /\bh-\[100dvh\]/);
  assert.match(overlay, /\bmd:hidden\b/);
  const z = Number(overlay.match(/\bz-\[(\d+)\]/)?.[1]);
  assert.ok(z > 50, "above the sticky header (z-index 50) and the bottom tab bar (z-40)");
});

test("the panel fills the viewport height and scrolls inside", () => {
  const panel = menu.match(/id="mobile-market-nav"[\s\S]*?className="([^"]+)"/)?.[1] ?? "";
  assert.match(panel, /\bh-\[100dvh\]/);
  assert.match(panel, /\boverflow-y-auto\b/);
  assert.match(panel, /\boverscroll-contain\b/);
});

test("scroll lock, overlay tap, close button, Esc and focus return", () => {
  assert.match(menu, /document\.body\.style\.overflow = "hidden";/);
  assert.match(menu, /document\.documentElement\.style\.overflow = "hidden";/);
  assert.match(menu, /document\.body\.style\.overflow = previousOverflow;/);
  assert.match(menu, /document\.documentElement\.style\.overflow = previousRootOverflow;/);
  assert.match(menu, /if \(event\.target === event\.currentTarget\) closeMenu\(\);/);
  assert.match(menu, /aria-label="Menyunu bağla" onClick=\{closeMenu\}/);
  assert.match(menu, /event\.key === "Escape"[\s\S]{0,80}closeMenu\(\);/);
  assert.match(menu, /triggerRef\.current\?\.focus\(\)/);
});

test("the cause stays documented: header keeps backdrop-filter, so fixed overlays must not render inside it", () => {
  assert.match(read("components/sticky-header.tsx"), /backdrop-blur/);
  // The city picker inside the header already portals for the same reason.
  assert.match(read("components/city-selector.tsx"), /createPortal\(/);
});
