/**
 * Homepage hero carousel (owner decisions 2026-11-16): stacked slide images with a crossfade and the next image
 * fetched ahead of its turn, slide 3 as art-directed crops of at most 80 KB, high priority for slide 1, lazy category
 * tiles off screen, autoplay of 6 s driven by a progress fill in the active dot, and no autoplay under reduced motion.
 * Source-level checks; the timing itself is measured in release-output/carousel-and-order-cancel-report.md.
 */
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const carousel = read("components/home/hero-carousel.tsx");

test("autoplay: 6 s, driven by the active dot's progress fill, no interval timer", () => {
  assert.match(carousel, /export const HERO_AUTOPLAY_MS = 6000;/);
  assert.doesNotMatch(carousel, /setInterval\(/);
  assert.match(carousel, /animation: `bagati-hero-progress \$\{HERO_AUTOPLAY_MS\}ms linear forwards`/);
  assert.match(carousel, /onAnimationEnd=\{\(event\) => \{\s*if \(event\.target !== event\.currentTarget\) return;\s*setActive\(\(value\) => \(value \+ 1\) % slides\.length\);/);
  assert.match(read("app/globals.css"), /@keyframes bagati-hero-progress \{\s*from \{ transform: scaleX\(0\); \}\s*to \{ transform: scaleX\(1\); \}/);
});

test("autoplay never runs under reduced motion, before hydration, or while paused, hovered, focused or hidden", () => {
  // The global reduced-motion rule shortens every animation to 0.01 ms, so the fill must not be rendered at all.
  assert.match(carousel, /const autoplay = hydrated && !reducedMotion && slides\.length > 1;/);
  assert.match(carousel, /\{isActive && autoplay && \(/);
  assert.match(carousel, /const autoplayRunning = autoplay && !paused && !interacting && !tabHidden;/);
  assert.match(carousel, /animationPlayState: autoplayRunning \? "running" : "paused"/);
  assert.match(carousel, /document\.addEventListener\("visibilitychange", updateVisibility\)/);
  assert.match(carousel, /aria-label=\{paused \? "Karuseli davam et" : "Karuseli dayandır"\}/);
});

test("images: stacked with a crossfade, the next slide rendered ahead, slide 1 at high priority", () => {
  assert.match(carousel, /const next = \(active \+ 1\) % slides\.length;/);
  assert.match(carousel, /return new Set\(\[\.\.\.current, active, next\]\);/);
  assert.match(carousel, /const visible = index === shown \|\| \(isActive && \(loaded\.has\(index\) \|\| !item\.image\)\);/);
  assert.match(carousel, /transition-opacity duration-500 ease-out motion-reduce:transition-none/);
  assert.match(carousel, /fetchPriority=\{index === 0 \? "high" : "low"\}/);
  assert.match(carousel, /if \(element\?\.complete && element\.naturalWidth > 0\) markLoaded\(index\);/);
  assert.doesNotMatch(carousel, /<picture key=\{slide\.id\}>/, "the old single remounted <picture> is gone");
});

test("slide 3 uses art-directed crops of at most 80 KB each", () => {
  for (const variant of ["desktop", "tablet", "mobile"]) {
    const file = `public/images/home/hero-home-${variant}.webp`;
    assert.match(carousel, new RegExp(`/images/home/hero-home-${variant}\\.webp`));
    assert.ok(statSync(resolve(root, file)).size <= 80 * 1024, `${file} is at most 80 KB`);
  }
  assert.doesNotMatch(carousel, /"\/images\/home\/hero-home\.webp"/);
});

test("category tiles off screen load lazily; the default stays eager", () => {
  const icon = read("components/category-icon.tsx");
  assert.match(icon, /loading = "eager",/);
  assert.match(icon, /loading=\{loading\}/);
  assert.match(read("components/category-mega-menu.tsx"), /<CategoryIcon category=\{category\} size="small" loading="lazy" \/>/);
  assert.match(read("components/mobile-menu.tsx"), /<CategoryIcon category=\{category\} size="small" loading="lazy" \/>/);
  assert.match(read("app/(customer)/(home)/page.tsx"), /<CategoryIcon category=\{category\} size="large" loading="lazy" \/>/);
});

test("hero sizes (design T5): 4:3 on phones, 2:1 from 640 px, 5:2 from 1024 px, 560-640 px tall from 1280 px; space reserved", () => {
  assert.match(carousel, /className="relative aspect-\[4\/3\] w-full overflow-hidden bg-brand-800 sm:aspect-\[2\/1\] lg:aspect-\[5\/2\] xl:absolute xl:inset-y-0 xl:right-0 xl:aspect-auto xl:w-\[56%\]"/);
  // The text panel keeps a fixed minimum height and the copy is clamped, so every slide fits the same space.
  assert.match(carousel, /min-h-\[404px\][^"]*sm:min-h-\[404px\][^"]*xl:min-h-\[clamp\(560px,44vw,640px\)\]/);
  // Phones: the pause button sits in the controls row, so the slide's buttons stay above the bottom tab bar.
  assert.match(carousel, /<span className="hidden sm:inline-flex">\{pauseButton\}<\/span>/);
  assert.match(carousel, /<span className="sm:hidden">\{pauseButton\}<\/span>/);
  assert.match(carousel, /<h1 className="line-clamp-3 font-serif /);
  assert.match(carousel, /line-clamp-2 max-w-\[32rem\][^"]*sm:line-clamp-3/);
  // Phone image for slide 1: the square file; shown at 4:3 its cover crop removes exactly the added background.
  assert.match(carousel, /\{ media: "\(max-width: 639px\)", srcSet: "\/images\/home\/hero-electronics-devices-square\.webp" \}/);
  assert.ok(statSync(resolve(root, "public/images/home/hero-electronics-devices-square.webp")).size <= 80 * 1024);
});

test("the xl edge gradient stays above the stacked images (z-[3] over z-[2] / z-[1])", () => {
  assert.match(carousel, /className="pointer-events-none absolute inset-y-0 left-0 z-\[3\] hidden w-\[13%\]/);
});
