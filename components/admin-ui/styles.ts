/**
 * Admin UI kit: shared class names. ADMIN-DESIGN-1: the seller panel's design tokens (tailwind.config.ts + globals.css:
 * primary green, line borders, 12 px control and 20 px card radius, fg text colours), so admin and seller panel look
 * alike. Every interactive element gets a visible keyboard focus ring (the same green ring as components/ui/cx.ts).
 */
export const adminColors = {
  primary: "#174746",
  ink: "#173a3a",
  eyebrow: "#7a5c2e",
  border: "#e5eae6",
  rowBorder: "#e5eae6",
  inputBorder: "#7b968c",
  muted: "#f7f8f6",
} as const;

export const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export const cardClass = "rounded-card border border-line bg-white p-5";

export const inputClass = `w-full min-h-11 rounded-control border border-line-strong bg-white px-3 py-2.5 text-sm text-fg placeholder:text-fg-muted transition-colors hover:border-primary focus:border-primary motion-reduce:transition-none ${focusRing}`;

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const buttonBase = `inline-flex min-h-10 items-center justify-center gap-2 rounded-control px-4 py-2.5 text-sm font-semibold transition-colors motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;

export function buttonClass(variant: ButtonVariant = "primary", extra = "") {
  const tone = {
    primary: "bg-primary text-white shadow-subtle hover:bg-primary-hover active:bg-primary-active",
    secondary: "border border-primary bg-white text-primary hover:bg-primary-subtle",
    danger: "border border-red-200 bg-white text-red-700 hover:bg-red-50",
    ghost: "text-primary hover:bg-primary-subtle",
  }[variant];
  return `${buttonBase} ${tone}${extra ? ` ${extra}` : ""}`;
}
