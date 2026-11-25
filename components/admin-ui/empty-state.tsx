import type { ReactNode } from "react";
import { cardClass } from "@/components/admin-ui/styles";

/** Shown instead of an empty list: what is missing and, optionally, what to do. */
export function EmptyState({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return <div className={`${cardClass} py-8 text-center`}>
    <p className="text-sm font-semibold text-fg">{title}</p>
    {description && <p className="mx-auto mt-1 max-w-md text-sm text-fg-secondary">{description}</p>}
    {action && <div className="mt-4 flex justify-center">{action}</div>}
  </div>;
}
