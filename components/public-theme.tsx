import type { ReactNode } from "react";
import { fraunces, inter } from "@/app/fonts/public-fonts";

/**
 * Public-site design scope (design T1). Wraps the customer layout and the stand-alone public auth pages.
 *
 * - The wrapper is `display: contents`, so it adds no box: the sticky header, fixed overlays and grids behave as
 *   before.
 * - The font family names come from next/font. React hoists the style tag to <head> and dedupes it by `href`.
 * - globals.css applies the public tokens (fonts, type scale, muted colour) on `body:has(> .bagati-public)`, so
 *   the menus that are portalled straight into <body> get them too.
 * - Admin and the seller panel never render this component, so they keep the system font and the old sizes.
 * - Fonts are imported only here, so only public routes load them.
 */
export function PublicTheme({ children }: { children: ReactNode }) {
  const fontVariables = `:root{--bagati-font-inter:${inter.style.fontFamily};--bagati-font-fraunces:${fraunces.style.fontFamily}}`;
  return <>
    <style href="bagati-public-fonts" precedence="default">{fontVariables}</style>
    <div className="bagati-public contents">{children}</div>
  </>;
}
