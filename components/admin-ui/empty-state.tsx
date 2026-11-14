import type { ReactNode } from "react";
import { cardClass } from "@/components/admin-ui/styles";

/** Shown instead of an empty list: what is missing and, optionally, what to do. */
export function EmptyState({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return <div className={`${cardClass} text-center`}>
    <p className="text-sm font-medium text-slate-700">{title}</p>
    {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
    {action && <div className="mt-4 flex justify-center">{action}</div>}
  </div>;
}
