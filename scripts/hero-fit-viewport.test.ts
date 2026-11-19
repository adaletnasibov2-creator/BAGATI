/**
 * Home hero fits the first screen from 1024 px (owner decision 2026-11-19): height = viewport height - the measured
 * space above the hero - 16 px, kept between 400 and min(600 px, 47vw); title size and spacing follow that height;
 * phones and tablets below 1024 px are unchanged. Source-level checks plus the measuring function on a fake document;
 * the browser measurements are in release-output/hero-fit-viewport-report.md.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { HERO_PRE_PAINT_SCRIPT, setAboveHero } from "../lib/hero-viewport";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const carousel = read("components/home/hero-carousel.tsx");
const css = read("app/globals.css");
const page = read("app/(customer)/(home)/page.tsx");

test("CSS: hero height from the viewport minus the space above it, 400 px to min(600 px, 47vw), svh with a vh fallback", () => {
  assert.match(css, /:root \{\s*--bagati-above-hero: 206px;\s*\}/, "fallback = desktop header 44 + 88 + 53 + 1 + section padding 20");
  assert.match(css, /\.bagati-hero \{\s*--bagati-hero-h: clamp\(400px, calc\(100vh - var\(--bagati-above-hero\) - 16px\), min\(600px, 47vw\)\);\s*\}/);
  assert.match(css, /@supports \(height: 100svh\) \{\s*\.bagati-hero \{\s*--bagati-hero-h: clamp\(400px, calc\(100svh - var\(--bagati-above-hero\) - 16px\), min\(600px, 47vw\)\);/);
});

test("the space above the hero is measured before first paint and again after client navigation or resize", () => {
  assert.match(page, /<HeroCarousel banners=\{banners\} \/>\s*\{\/\*[^*]*\*\/\}\s*<script dangerouslySetInnerHTML=\{\{ __html: HERO_PRE_PAINT_SCRIPT \}\} \/>/);
  assert.match(carousel, /data-bagati-hero=""/);
  assert.match(carousel, /useLayoutEffect\(\(\) => \{\s*const update = \(\) => setAboveHero\(document\);\s*update\(\);\s*window\.addEventListener\("resize", update\);/);
});

test("from 1024 px the title size, padding and spacing follow the hero height; phone and tablet sizes are unchanged", () => {
  assert.match(carousel, /text-\[2rem\][^"]*sm:text-\[3rem\] lg:text-\[length:clamp\(1\.875rem,calc\(var\(--bagati-hero-h\)\*0\.082\),3\.5rem\)\]/);
  assert.match(carousel, /lg:py-\[clamp\(1\.25rem,calc\(var\(--bagati-hero-h\)\*0\.065\),2\.75rem\)\]/);
  // Text: 2 lines on phones, 3 lines at 640-1023 px (as before), 2 lines in the shorter side panel from 1024 px.
  assert.match(carousel, /line-clamp-2 max-w-\[32rem\][^"]*sm:line-clamp-3 [^"]*lg:line-clamp-2/);
  assert.doesNotMatch(carousel, /xl:min-h-\[clamp\(560px/);
});

test("art-directed strip images only below 1024 px, where the image sits above the text", () => {
  assert.equal(carousel.match(/\{ media: "\(max-width: 1023px\)", srcSet: "\/images\/home\/hero-(electronics-devices|home)-tablet\.webp" \}/g)?.length, 2);
  assert.doesNotMatch(carousel, /max-width: 1279px/);
});

function fakeDocument({ heroTop = 206, scrollY = 0, scrolledHeader = false, hero = true } = {}) {
  const props = new Map<string, string>();
  const doc = {
    defaultView: { scrollY },
    documentElement: { style: { setProperty: (name: string, value: string) => props.set(name, value) } },
    querySelector: (selector: string) => {
      if (selector === "[data-bagati-hero]") return hero ? { getBoundingClientRect: () => ({ top: heroTop - scrollY }) } : null;
      if (selector === ".bagati-sticky-header") return { hasAttribute: (name: string) => name === "data-scrolled" && scrolledHeader };
      return null;
    },
  };
  return { doc: doc as unknown as Document, props };
}

test("setAboveHero stores the hero's document offset, whatever the scroll position", () => {
  const { doc, props } = fakeDocument({ heroTop: 246.4, scrollY: 300 });
  setAboveHero(doc);
  assert.equal(props.get("--bagati-above-hero"), "246px");
});

test("setAboveHero keeps the last value while the header is compact (scrolled) or when there is no hero", () => {
  const scrolled = fakeDocument({ scrolledHeader: true });
  setAboveHero(scrolled.doc);
  assert.equal(scrolled.props.size, 0);
  const none = fakeDocument({ hero: false });
  setAboveHero(none.doc);
  assert.equal(none.props.size, 0);
});

test("the inline script is the same function, runnable on its own", () => {
  const { doc, props } = fakeDocument({ heroTop: 206 });
  new Function("document", HERO_PRE_PAINT_SCRIPT)(doc);
  assert.equal(props.get("--bagati-above-hero"), "206px");
  assert.doesNotMatch(HERO_PRE_PAINT_SCRIPT, /<\/script/i);
});
