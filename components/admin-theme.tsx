import { fraunces, inter } from "@/app/fonts/public-fonts";

/**
 * ADMIN-POWER-1: the seller panel's fonts (self-hosted Inter + Fraunces, app/fonts/public-fonts.ts) for the admin
 * shell ONLY. Rendered once by components/admin-shell.tsx; the shell's root element carries `.bagati-admin`, and
 * globals.css applies the fonts inside that scope only. The public site's theme wrapper and CSS scope are never used
 * here, and /admin/login (no shell) keeps its look.
 */
export function AdminFontVariables() {
  const fontVariables = `:root{--bagati-font-inter:${inter.style.fontFamily};--bagati-font-fraunces:${fraunces.style.fontFamily}}`;
  return <style href="bagati-admin-fonts" precedence="default">{fontVariables}</style>;
}
