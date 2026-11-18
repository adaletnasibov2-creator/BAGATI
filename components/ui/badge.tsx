import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export type BadgeTone = "neutral" | "primary" | "gold" | "danger";

// Text contrast: neutral #405451 on #eef3f0 7.1:1; primary #174746 on #e1ece8 8.57:1; gold #7a5c2e on #f3e9d5
// 5.13:1; danger #b91c1c on #fef2f2 5.91:1.
const TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-sunken text-fg-body",
  primary: "bg-primary-tint text-primary",
  gold: "bg-gold-100 text-gold-700 ring-1 ring-inset ring-gold-200",
  danger: "bg-danger-subtle text-danger",
};

export function badgeClass(tone: BadgeTone = "neutral", size: "sm" | "md" = "sm"): string {
  return cx("inline-flex items-center gap-1 rounded-full font-medium", size === "sm" ? "px-2.5 py-0.5 text-xs" : "px-3 py-1 text-sm", TONES[tone]);
}

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; size?: "sm" | "md" };

/** Small status label (pill). Colour is never the only signal: the text says the status. */
export function Badge({ tone, size, className, ...props }: BadgeProps) {
  return <span className={cx(badgeClass(tone, size), className)} {...props} />;
}
