/** Joins class names and skips empty values (a tiny local stand-in for clsx; no npm package). */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * Visible keyboard focus ring for the primitives: 2 px primary green (#174746), 2 px away from the element.
 * 10.36:1 on white and 9.73:1 on the page colour (WCAG 2.2 needs 3:1). The global gold ring in globals.css
 * reaches only 2.57:1 on white, so the primitives override it.
 */
export const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** Ring for dark surfaces (footer): gold #c79a52 on #173a3a is 4.80:1. */
export const focusRingInverse = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bagati-gold";
