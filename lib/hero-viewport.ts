/**
 * Home hero from 1024 px (owner decision 2026-11-19): the whole hero fits the first screen of a laptop. Its height is
 * computed in CSS (.bagati-hero in app/globals.css) from the viewport height minus --bagati-above-hero, the space above
 * the hero (announcement bar when shown, header, and the hero section's top padding).
 *
 * This function measures that space as the hero's offset from the top of the document and stores it on <html>. It runs
 * twice: as an inline script right after the hero in the server HTML (before first paint, so the hero never changes
 * height on load), and from the carousel after a client-side navigation or a window resize. Plain browser code without
 * imports, because the inline script is this function's own source text.
 */
export function setAboveHero(doc: Document) {
  const hero = doc.querySelector("[data-bagati-hero]");
  const header = doc.querySelector(".bagati-sticky-header");
  // While the page is scrolled the sticky header is compact (64 px row instead of 88 px); keep the last full-height value.
  if (!hero || (header && header.hasAttribute("data-scrolled"))) return;
  const top = Math.round(hero.getBoundingClientRect().top + (doc.defaultView ? doc.defaultView.scrollY : 0));
  if (top > 0) doc.documentElement.style.setProperty("--bagati-above-hero", `${top}px`);
}

/** Inline script placed right after the hero on the home page. */
export const HERO_PRE_PAINT_SCRIPT = `(${setAboveHero.toString()})(document);`;
