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
 * `adjustFontFallback` makes next/font emit a size-adjusted local fallback face, so swapping in the web font
 * barely moves the layout.
 */
export const inter = localFont({
  src: "./inter-variable-az.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
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
