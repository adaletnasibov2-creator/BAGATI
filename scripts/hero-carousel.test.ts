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
import { buildHeroSlides, HERO_MAX_SLIDES } from "../components/home/hero-carousel";

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

test("hero sizes: 4:3 on phones, 2:1 from 640 px, from 1024 px a side panel whose height follows the viewport; space reserved", () => {
  assert.match(carousel, /className="relative aspect-\[4\/3\] w-full overflow-hidden bg-brand-800 sm:aspect-\[2\/1\] lg:absolute lg:inset-y-0 lg:right-0 lg:aspect-auto lg:w-\[56%\]"/);
  // The text panel keeps a fixed minimum height below 1024 px (unchanged) and fills the fixed-height hero from 1024 px;
  // the copy is clamped, so every slide fits the same space.
  assert.match(carousel, /min-h-\[404px\][^"]*sm:min-h-\[404px\][^"]*lg:h-full lg:min-h-0 lg:w-\[46%\]/);
  assert.match(carousel, /className="bagati-hero relative isolate [^"]*lg:h-\[var\(--bagati-hero-h\)\]"/);
  // Phones: the pause button sits in the controls row, so the slide's buttons stay above the bottom tab bar.
  assert.match(carousel, /<span className="hidden sm:inline-flex">\{pauseButton\}<\/span>/);
  assert.match(carousel, /<span className="sm:hidden">\{pauseButton\}<\/span>/);
  assert.match(carousel, /<h1 className="line-clamp-3 font-serif /);
  assert.match(carousel, /line-clamp-2 max-w-\[32rem\][^"]*sm:line-clamp-3/);
  // Phone image for slide 1: the square file; shown at 4:3 its cover crop removes exactly the added background.
  assert.match(carousel, /\{ media: "\(max-width: 639px\)", srcSet: "\/images\/home\/hero-electronics-devices-square\.webp" \}/);
  assert.ok(statSync(resolve(root, "public/images/home/hero-electronics-devices-square.webp")).size <= 80 * 1024);
});

test("the lg edge gradient stays above the stacked images (z-[3] over z-[2] / z-[1])", () => {
  assert.match(carousel, /className="pointer-events-none absolute inset-y-0 left-0 z-\[3\] hidden w-\[26%\][^"]* lg:block"/); // DESIGN-POLISH-1: wider, softer edge (was 13%)
});

// ---------------------------------------------------------------------------------------------------------------
// Slide list (owner decision 2026-11-19): admin banners first, then the 4 built-in slides, at most 8 slides.

const DEFAULT_IDS = ["technology", "fashion", "home", "beauty"];
const banner = (n: number) => ({ id: `b${n}`, title: `Banner ${n}`, description: `Mətn ${n}`, imageUrl: `https://cdn.example.com/b${n}.webp`, buttonLabel: "Bax", href: "/products" });
const banners = (count: number) => Array.from({ length: count }, (_, index) => banner(index + 1));
const ids = (count: number) => buildHeroSlides(banners(count)).map((slide) => slide.id);

test("0 banners: the 4 built-in slides, exactly as before", () => {
  assert.deepEqual(ids(0), DEFAULT_IDS);
  assert.equal(HERO_MAX_SLIDES, 8);
});

test("2 banners: the 2 banners first, then all 4 built-in slides (6)", () => {
  assert.deepEqual(ids(2), ["b1", "b2", ...DEFAULT_IDS]);
});

test("6 banners: 6 banners, then the first 2 built-in slides (cap 8)", () => {
  assert.deepEqual(ids(6), ["b1", "b2", "b3", "b4", "b5", "b6", "technology", "fashion"]);
});

test("9 banners: capped at 8, banners only", () => {
  assert.deepEqual(ids(9), ["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8"]);
});

test("banner order is kept as passed (Sıra order from the page query)", () => {
  const slides = buildHeroSlides([banner(3), banner(1), banner(2)]);
  assert.deepEqual(slides.slice(0, 3).map((slide) => slide.id), ["b3", "b1", "b2"]);
});

test("uploaded banners keep the T5 rules; built-in slides keep their labels and art-directed images", () => {
  const slides = buildHeroSlides(banners(2));
  for (const uploaded of slides.slice(0, 2)) {
    assert.equal(uploaded.eyebrow, "BAGATI seçimi");
    assert.equal(uploaded.secondary, "Kateqoriyalar");
    assert.equal(uploaded.visualLabel, "", "no default label pill on an uploaded banner");
    assert.equal(uploaded.imageAlt, "", "uploaded art is decorative next to the live title");
    assert.equal(uploaded.sources, undefined, "an uploaded image is one file, no art-directed sources");
  }
  const builtIn = slides.slice(2);
  assert.deepEqual(builtIn.map((slide) => slide.visualLabel), ["Texnologiya", "Aksesuarlar", "Ev üçün", "Gözəllik"]);
  assert.equal(builtIn[0].sources?.[0]?.srcSet, "/images/home/hero-electronics-devices-square.webp");
  assert.equal(builtIn[2].sources?.length, 2, "slide 3 keeps its phone and tablet crops");
  assert.ok(builtIn.every((slide) => slide.imageAlt.length > 0), "built-in photos keep their alt text");
});

test("the first slide's image is eager and high priority whichever slide comes first; dots count the real slides", () => {
  assert.match(carousel, /loading=\{index === 0 \? "eager" : "lazy"\}/);
  assert.match(carousel, /fetchPriority=\{index === 0 \? "high" : "low"\}/);
  assert.match(carousel, /\{slides\.map\(\(item, index\) => \{\s*const isActive = index === active;/, "one dot per slide in the list");
  assert.match(carousel, /aria-label=\{`\$\{index \+ 1\}\. slayd`\}/);
});
