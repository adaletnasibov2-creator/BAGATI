import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PRODUCT_CARD_IMAGE_SIZES, PRODUCT_GRID_CLASS, PRODUCT_GRID_WITH_SIDEBAR_CLASS, PRODUCT_SHELF_TRACK_CLASS } from "../components/product-layout";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("one column rule: 2 / 3 (md) / 4 (lg) / 5 (xl); sidebar pages 3 (lg) / 4 (xl) / 5 (2xl)", () => {
  assert.equal(PRODUCT_GRID_CLASS, "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5");
  assert.equal(PRODUCT_GRID_WITH_SIDEBAR_CLASS, "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5");
  // Tailwind only scans app/ and components/: the shared class strings must live there.
  assert.match(read("tailwind.config.ts"), /"\.\/components\/\*\*\/\*\.\{ts,tsx\}"/);
});

test("carousel tracks have a fixed width per breakpoint (2.15 / 3 / 4 / 5), never minmax(0, …) that squeezes cards", () => {
  for (const part of [
    "grid-flow-col", "justify-start",
    "auto-cols-[calc((100%_-_1.5rem)/2.15)]", "sm:auto-cols-[calc((100%_-_2rem)/2.15)]",
    "md:auto-cols-[calc((100%_-_2rem)/3)]", "lg:auto-cols-[calc((100%_-_3rem)/4)]", "xl:auto-cols-[calc((100%_-_4rem)/5)]",
  ]) assert.ok(PRODUCT_SHELF_TRACK_CLASS.split(" ").includes(part), part);
  assert.doesNotMatch(PRODUCT_SHELF_TRACK_CLASS, /minmax\(0/);
  const shelf = read("components/home/product-shelf.tsx");
  assert.match(shelf, /className=\{`\$\{PRODUCT_SHELF_TRACK_CLASS\} overflow-x-auto overscroll-x-contain scroll-smooth snap-x snap-mandatory/);
  assert.match(shelf, /aria-label=\{`\$\{title\}: əvvəlki məhsullar`\}/, "arrows kept");
  assert.match(shelf, /aria-label=\{`\$\{title\}: növbəti məhsullar`\}/);
});

test("every product grid uses the shared classes", () => {
  assert.match(read("components/product-grid.tsx"), /<div className=\{PRODUCT_GRID_CLASS\}>/);
  assert.match(read("components/favorites-client.tsx"), /<div className=\{PRODUCT_GRID_CLASS\}>/);
  assert.match(read("app/(customer)/products/page.tsx"), /className=\{`mt-8 lg:mt-0 \$\{PRODUCT_GRID_WITH_SIDEBAR_CLASS\}`\}/);
  for (const path of ["components/product-grid.tsx", "components/favorites-client.tsx", "app/(customer)/products/page.tsx"]) {
    assert.doesNotMatch(read(path), /grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3/, `${path} has no hand-written product grid`);
  }
});

test("card: equal heights, square white image with contain, title clamp, fixed meta slot, button last", () => {
  const card = read("components/product-card.tsx");
  assert.match(card, /<article className="group relative flex h-full min-w-0 flex-col/, "h-full for equal heights; relative contains sr-only text");
  assert.match(card, /className="relative block aspect-square overflow-hidden bg-white/);
  assert.doesNotMatch(card, /aspect-\[4\/5\]/);
  assert.match(card, /line-clamp-2 min-h-10/);
  assert.match(card, /<p className="mt-0\.5 h-4 truncate text-\[\.7rem\] leading-4 text-bagati-muted">/, "one fixed line for variants/campaign");
  assert.match(card, /<div className="mt-auto pt-2\.5">\s*<QuickAddToCart productId=\{id\} stock=\{stock\} \/>\s*<\/div>/);
  assert.doesNotMatch(card, /min-h-5 pt-1/, "no reserved empty stock row");
  assert.match(card, /sizes=\{PRODUCT_CARD_IMAGE_SIZES\}/);
  assert.match(PRODUCT_CARD_IMAGE_SIZES, /\(min-width: 1280px\)/);
  const image = read("components/product-card-image.tsx");
  assert.equal((image.match(/object-contain p-2 /g) ?? []).length, 2, "both images contained with the same padding");
  assert.doesNotMatch(image, /sm:p-5/);
});

test("quick add: no empty line under the button; the live region stays and cannot escape a carousel", () => {
  const quickAdd = read("components/quick-add-to-cart.tsx");
  assert.match(quickAdd, /return <div className="relative"><button type="button"/);
  assert.match(quickAdd, /<p className=\{message \? "mt-1 text-center text-\[\.68rem\] text-\[#697875\]" : "sr-only"\} role="status" aria-live="polite">\{message\}<\/p>/);
  assert.doesNotMatch(quickAdd, /mt-1 min-h-4/);
  assert.match(quickAdd, /whitespace-nowrap/);
  // Behaviour untouched: same endpoints and texts.
  assert.match(quickAdd, /fetch\("\/api\/cart\/items", \{ method: "POST"/);
  assert.match(quickAdd, /"Səbətə əlavə et"/);
  assert.match(quickAdd, /"Stokda yoxdur"/);
});
