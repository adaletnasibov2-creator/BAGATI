import type { ReactNode } from "react";

/** Page title block: eyebrow, h1, optional description and actions (buttons/links on the right, wrapping on mobile). */
export function PageHeader({ title, description, actions, eyebrow = "BAGATI · ADMIN" }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-[.18em] text-[#9b7840]">{eyebrow}</p>
      <h1 className="mt-2 text-3xl font-semibold text-[#0d1b2a]">{title}</h1>
      {description && <p className="mt-2 max-w-3xl text-sm text-slate-500">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>;
}
