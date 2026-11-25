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
  assert.match(read("app/(customer)/products/(list)/page.tsx"), /className=\{`mt-8 lg:mt-0 \$\{PRODUCT_GRID_WITH_SIDEBAR_CLASS\}`\}/);
  for (const path of ["components/product-grid.tsx", "components/favorites-client.tsx", "app/(customer)/products/(list)/page.tsx"]) {
    assert.doesNotMatch(read(path), /grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3/, `${path} has no hand-written product grid`);
  }
});

test("card: equal heights, square white image with contain, title clamp, fixed meta slot, button last", () => {
  const card = read("components/product-card.tsx");
  assert.match(card, /<article className="group relative flex h-full min-w-0 flex-col/, "h-full for equal heights; relative contains sr-only text");
  assert.match(card, /className="relative block aspect-square overflow-hidden bg-white/);
  assert.doesNotMatch(card, /aspect-\[4\/5\]/);
  assert.match(card, /line-clamp-2 min-h-10/);
  assert.match(card, /<p className="mt-1 h-\[1\.125rem\] truncate text-xs leading-\[1\.125rem\] text-fg-muted">/, "one fixed line (height = line height) for variants/campaign");
  assert.match(card, /<div className="mt-auto pt-3">\s*<QuickAddToCart productId=\{id\} stock=\{stock\} \/>\s*<\/div>/);
  // The title keeps a 20 px line height, so two lines are exactly min-h-10 and prices line up across a row.
  assert.match(card, /line-clamp-2 min-h-10 rounded-sm text-sm font-medium leading-5/);
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
  assert.match(quickAdd, /<p className=\{message \? "mt-1 text-center text-xs text-fg-muted" : "sr-only"\} role="status" aria-live="polite">\{message\}<\/p>/);
  assert.match(quickAdd, /min-h-11 w-full[^"]*rounded-full[^"]*focus-visible:outline-focus/, "44 px pill with the green focus ring");
  assert.doesNotMatch(quickAdd, /mt-1 min-h-4/);
  assert.match(quickAdd, /whitespace-nowrap/);
  // Behaviour untouched: same endpoints and texts.
  assert.match(quickAdd, /fetch\("\/api\/cart\/items", \{ method: "POST"/);
  assert.match(quickAdd, /"Səbətə əlavə et"/);
  assert.match(quickAdd, /"Stokda yoxdur"/);
});

test("design T3: price hierarchy, tokens, CSS-only hover lift, one shared skeleton", () => {
  const card = read("components/product-card.tsx");
  assert.match(card, /<p className="text-base font-bold tabular-nums tracking-tight text-fg sm:text-\[1\.0625rem\]">\s*\{formatPrice\(price\)\}/, "current price is the strongest text"); // PRICE-SYMBOL-1: always 2 decimals + ₼ via lib/price.ts
  assert.match(card, /<del className="text-xs tabular-nums text-fg-muted">\s*<span className="sr-only">Əvvəlki qiymət: <\/span>/, "old price struck through, muted, announced");
  assert.match(card, /badgeClass\(discounted \|\| campaignName \? "gold" : "primary"\)/);
  assert.match(card, /<div className="mt-2 flex flex-col gap-y-0 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-2">/, "phones: old price on its own line (no uneven wrap in 2-column grids)");
  assert.match(card, /motion-safe:hover:-translate-y-0\.5 motion-reduce:transition-none/);
  assert.doesNotMatch(card, /font-serif|font-display|bagati-gold-dark|#[0-9A-Fa-f]{6}/, "no serif and no hard-coded colours in the card");
  for (const path of ["app/(customer)/(home)/loading.tsx", "app/(customer)/products/(list)/loading.tsx"]) {
    assert.match(read(path), /<ProductCardSkeleton key=\{index\} \/>/, `${path} uses the shared skeleton`);
  }
  assert.doesNotMatch(read("app/(customer)/(home)/page.tsx"), /function ProductSpotlight/, "the unused second product card is gone");
});
