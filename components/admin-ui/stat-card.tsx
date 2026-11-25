import Link from "next/link";
import type { ReactNode } from "react";
import { focusRing } from "@/components/admin-ui/styles";

/**
 * Counter tile; a link when `href` is given. Compact on phones (two per row in a grid-cols-2 parent).
 * ADMIN-DESIGN-1: seller-panel card look; optional decorative `icon`; `attention` marks a count that needs action
 * (gold edge; the label already says what it is, so colour is not the only signal).
 */
export function StatCard({ label, value, href, hint, icon, attention = false }: { label: ReactNode; value: ReactNode; href?: string; hint?: ReactNode; icon?: ReactNode; attention?: boolean }) {
  const body = <>
    <div className="flex items-start justify-between gap-2">
      <p className="text-xs font-medium text-fg-secondary sm:text-sm">{label}</p>
      {icon && <span aria-hidden="true" className={`hidden h-8 w-8 shrink-0 place-items-center rounded-full sm:grid ${attention ? "bg-gold-100 text-gold-700" : "bg-primary-subtle text-primary"}`}>{icon}</span>}
    </div>
    <p className="mt-2 text-2xl font-semibold tabular-nums text-fg sm:mt-3 sm:text-3xl">{value}</p>
    {hint && <p className="mt-1 text-xs text-fg-secondary">{hint}</p>}
  </>;
  const className = `block rounded-card border bg-white p-3.5 sm:p-5 ${attention ? "border-gold-200 shadow-[inset_3px_0_0_var(--bagati-gold)]" : "border-line"}`;
  return href
    ? <Link href={href} className={`${className} transition-[border-color,box-shadow] duration-150 hover:border-brand-200 hover:shadow-card motion-reduce:transition-none ${focusRing}`}>{body}</Link>
    : <div className={className}>{body}</div>;
}
