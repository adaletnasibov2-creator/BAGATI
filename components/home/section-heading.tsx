import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The one section heading of the home page (design T5): a short kicker with a gold hairline, a Fraunces title (the
 * global h2 rule), and an optional "Hamısına bax" link with a 44 px target. `children` sits next to the link (for
 * example the shelf arrows or "Xəritəyə bax").
 */
export function HomeSectionHeading({ id, eyebrow, title, href, actionLabel = "Hamısına bax", children }: {
  id: string;
  eyebrow: string;
  title: string;
  href?: string;
  actionLabel?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3 sm:mb-6">
      <div className="min-w-0">
        <p className="flex items-center gap-2.5 text-kicker uppercase text-gold-700">
          <span aria-hidden="true" className="h-px w-6 shrink-0 bg-gold-400" />
          <span className="truncate">{eyebrow}</span>
        </p>
        <h2 id={id} className="mt-2 text-h2 text-fg">{title}</h2>
      </div>
      {(href || children) && (
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {href && (
            <Link href={href} className="inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-sm font-semibold text-primary transition-colors hover:bg-primary-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none">
              {actionLabel}<ChevronRight aria-hidden="true" size={16} />
            </Link>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
