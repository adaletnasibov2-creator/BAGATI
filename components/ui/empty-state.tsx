import type { ReactNode } from "react";
import { cx } from "./cx";

export type EmptyStateProps = {
  title: ReactNode;
  description?: ReactNode;
  /** A decorative icon (for example a lucide icon); rendered in a soft green circle and hidden from screen readers. */
  icon?: ReactNode;
  /** Usually a ButtonLink, for example "Məhsullara bax". */
  action?: ReactNode;
  titleAs?: "h2" | "h3";
  className?: string;
};

/** Empty result or empty list: icon, title, one line of help and one action. */
export function EmptyState({ title, description, icon, action, titleAs: Title = "h2", className }: EmptyStateProps) {
  return <div className={cx("rounded-card border border-line bg-white px-6 py-12 text-center sm:px-10", className)}>
    {icon && <div aria-hidden="true" className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-primary-subtle text-primary ring-1 ring-inset ring-brand-100">{icon}</div>}
    <Title className={cx("text-h3 text-fg", Boolean(icon) && "mt-4")}>{title}</Title>
    {description && <p className="mx-auto mt-2 max-w-md text-body text-fg-secondary">{description}</p>}
    {action && <div className="mt-6 flex justify-center">{action}</div>}
  </div>;
}
