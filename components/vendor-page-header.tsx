import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

export type VendorPageHeaderProps = {
  /** Small kicker above the title (gold-700 text, uppercase by CSS). */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** One line under the title. */
  description?: ReactNode;
  /** Primary action(s) on the right (below the text on phones), usually a ButtonLink. */
  action?: ReactNode;
  /** A back link above the eyebrow, for detail pages. */
  back?: ReactNode;
  className?: string;
};

/**
 * The one page header of the seller panel (SELLER-DESIGN-1): eyebrow, Fraunces title and one line of description
 * stacked on the left, the primary action on the right. Every /vendor page uses it, so the three never scatter
 * across a flex row again. No hooks: works in server and client components.
 */
export function VendorPageHeader({ eyebrow, title, description, action, back, className }: VendorPageHeaderProps) {
  return <header className={cx("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)} data-vendor-page-header="">
    <div className="min-w-0">
      {back && <div className="mb-3">{back}</div>}
      {eyebrow && <p className="text-kicker uppercase text-gold-700">{eyebrow}</p>}
      <h1 className={cx("break-words font-display text-h1 text-fg", Boolean(eyebrow) && "mt-1.5")}>{title}</h1>
      {description && <p className="mt-1.5 max-w-3xl text-sm text-fg-secondary">{description}</p>}
    </div>
    {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
  </header>;
}
