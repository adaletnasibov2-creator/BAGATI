/**
 * One column rule for every product grid and carousel (in components/ so Tailwind sees the class strings).
 *
 * Grids and carousels: 2 cards below 768 px, 3 from 768 (md), 4 from 1024 (lg), 5 from 1280 (xl).
 * Pages with the 260 px category sidebar (from lg): 3 (lg), 4 (xl), 5 from 1536 (2xl), so cards never get too narrow.
 * Carousels below 768 px show 2 cards plus a ~0.15 peek of the third as a swipe hint (arrows are hidden there).
 * Gaps: 12 px, 16 px from sm. Track widths subtract the visible gaps, so cards are exactly one column wide.
 */
export const PRODUCT_GRID_CLASS = "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";

export const PRODUCT_GRID_WITH_SIDEBAR_CLASS = "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5";

/**
 * Fixed track width per breakpoint (never shrinks to fit, so many cards scroll instead of being squeezed, and 1-2
 * cards keep their normal width at the start of the row).
 */
export const PRODUCT_SHELF_TRACK_CLASS =
  "grid grid-flow-col justify-start gap-3 sm:gap-4 " +
  "auto-cols-[calc((100%_-_1.5rem)/2.15)] sm:auto-cols-[calc((100%_-_2rem)/2.15)] " +
  "md:auto-cols-[calc((100%_-_2rem)/3)] lg:auto-cols-[calc((100%_-_3rem)/4)] xl:auto-cols-[calc((100%_-_4rem)/5)]";

/** next/image `sizes` matching the columns above (container ≤ 1440 px). */
export const PRODUCT_CARD_IMAGE_SIZES = "(min-width: 1280px) 270px, (min-width: 1024px) 24vw, (min-width: 768px) 32vw, 46vw";
