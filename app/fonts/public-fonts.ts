import localFont from "next/font/local";

/**
 * Public-site fonts (owner decision, design T1): Inter for text, Fraunces for headings.
 *
 * Self-hosted woff2 files committed next to this module, so no font request leaves the site at runtime or at build
 * time. Each file is one variable font cut by Google Fonts' `text=` subsetting to Basic Latin, Latin-1, Latin
 * Extended-A, Ə/ə (U+018F/U+0259), quotes and dashes, € and ₼. That covers every Azerbaijani letter
 * (ə Ə ı İ ş Ş ğ Ğ ç Ç ö Ö ü Ü) in one file per family. Fraunces is pinned to optical size 48 (display headings),
 * which halves the file. Licences: Inter-OFL.txt and Fraunces-OFL.txt (SIL OFL 1.1).
 *
 * `adjustFontFallback` makes next/font emit a size-adjusted local fallback face.
 *
 * Inter uses `display: "optional"` (design T4): with `swap`, body text re-wrapped when Inter arrived after the first
 * paint (CLS 0.059 on /seller-terms at 390 px, also with preload on a slow connection). With `optional` a page that
 * paints before the font is ready keeps the size-adjusted fallback for that view, and the font, now cached, is used
 * from the next page on. Fraunces keeps `swap`: headings did not move the layout when it arrived.
 */
export const inter = localFont({
  src: "./inter-variable-az.woff2",
  weight: "400 700",
  style: "normal",
  display: "optional",
  adjustFontFallback: "Arial",
  fallback: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Arial", "sans-serif"],
});

export const fraunces = localFont({
  src: "./fraunces-variable-az.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  adjustFontFallback: "Times New Roman",
  fallback: ["Georgia", "Times New Roman", "serif"],
});
