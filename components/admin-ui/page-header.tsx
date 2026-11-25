import type { ReactNode } from "react";

/** Page title block: eyebrow, h1, optional description and actions (buttons/links on the right, wrapping on mobile). */
export function PageHeader({ title, description, actions, eyebrow = "BAGATI · ADMIN" }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  // ADMIN-DESIGN-1: the seller panel's header pattern (components/vendor-page-header.tsx): gold kicker, title,
  // one line of description on the left, the primary action on the right (below the text on phones).
  return <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div className="min-w-0">
      <p className="text-kicker uppercase text-gold-700">{eyebrow}</p>
      <h1 className="mt-1.5 break-words text-h1 text-fg">{title}</h1>
      {description && <p className="mt-1.5 max-w-3xl text-sm text-fg-secondary">{description}</p>}
    </div>
    {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
  </div>;
}
