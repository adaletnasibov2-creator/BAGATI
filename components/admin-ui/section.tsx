import type { ReactNode } from "react";
import { cardClass } from "@/components/admin-ui/styles";

/** White card. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`${cardClass}${className ? ` ${className}` : ""}`}>{children}</div>;
}

/** Card with a heading (h2), optional description and actions. */
export function Section({ title, description, actions, children, className = "" }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }) {
  return <section className={`${cardClass}${className ? ` ${className}` : ""}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="font-semibold text-[#0d1b2a]">{title}</h2>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
    {children && <div className="mt-4">{children}</div>}
  </section>;
}
