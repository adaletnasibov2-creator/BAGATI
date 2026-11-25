import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

const toneClass: Record<BadgeTone, string> = {
  // ADMIN-DESIGN-1: neutral and accent use the seller-panel badge tokens (components/ui/badge.tsx).
  neutral: "bg-surface-sunken text-fg-body ring-line",
  info: "bg-sky-50 text-sky-800 ring-sky-200",
  success: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  warning: "bg-amber-50 text-amber-900 ring-amber-200",
  danger: "bg-red-50 text-red-800 ring-red-200",
  accent: "bg-gold-100 text-gold-700 ring-gold-200",
};

/** Small pill with a text label (colour is never the only signal: the text says the status). */
export function StatusBadge({ tone = "neutral", children, title }: { tone?: BadgeTone; children: ReactNode; title?: string }) {
  return <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${toneClass[tone]}`}>{children}</span>;
}
