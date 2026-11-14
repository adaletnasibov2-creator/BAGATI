/**
 * Admin UI kit: shared class names (existing BAGATI admin palette). Every interactive element gets a visible
 * keyboard focus ring.
 */
export const adminColors = {
  primary: "#173c40",
  ink: "#0d1b2a",
  eyebrow: "#9b7840",
  border: "#e7e3d9",
  rowBorder: "#eeeae2",
  inputBorder: "#ded9cf",
  muted: "#f8f7f4",
} as const;

export const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#173c40]";

export const cardClass = "rounded-2xl border border-[#e7e3d9] bg-white p-5";

export const inputClass = `w-full rounded-xl border border-[#ded9cf] bg-white px-3 py-2.5 text-sm text-slate-800 ${focusRing}`;

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const buttonBase = `inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;

export function buttonClass(variant: ButtonVariant = "primary", extra = "") {
  const tone = {
    primary: "bg-[#173c40] text-white hover:bg-[#0f2b2e]",
    secondary: "border border-[#173c40] bg-white text-[#173c40] hover:bg-[#f8f7f4]",
    danger: "border border-red-200 bg-white text-red-700 hover:bg-red-50",
    ghost: "text-[#173c40] hover:bg-[#f8f7f4]",
  }[variant];
  return `${buttonBase} ${tone}${extra ? ` ${extra}` : ""}`;
}
