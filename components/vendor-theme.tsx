import type { ReactNode } from "react";
import { fraunces, inter } from "@/app/fonts/public-fonts";

/**
 * Seller-panel design scope (SELLER-DESIGN-1), the same approach as components/public-theme.tsx.
 *
 * - The wrapper is `display: contents`, so it adds no box: the sticky header, the fixed sidebar and every width stay
 *   as before.
 * - globals.css applies the seller tokens (Inter + Fraunces, AA muted colour, green focus outline) on
 *   `body:has(> .bagati-vendor)`. The small text sizes stay 12/14 px, so the panel keeps its scale.
 * - Rendered by app/vendor/[storeId]/layout.tsx and the seller portal pages (/vendor, /vendor/stores/new,
 *   /vendor/subscription, /vendor/security). Admin and the public site never render it.
 */
export function VendorTheme({ children }: { children: ReactNode }) {
  const fontVariables = `:root{--bagati-font-inter:${inter.style.fontFamily};--bagati-font-fraunces:${fraunces.style.fontFamily}}`;
  return <>
    <style href="bagati-vendor-fonts" precedence="default">{fontVariables}</style>
    <div className="bagati-vendor contents">{children}</div>
  </>;
}
