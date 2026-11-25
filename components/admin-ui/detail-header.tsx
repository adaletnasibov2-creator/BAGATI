import Link from "next/link";
import type { ReactNode } from "react";
import { focusRing } from "@/components/admin-ui/styles";

/**
 * ADMIN-POWER-1: summary header of the admin detail pages (store, order, customer, seller, seller application):
 * a back link to the list, the title with its status badge, the existing one-line detail, a few key facts (labels
 * that already exist on the page) and optional actions. Display only: the facts come from data the page already read.
 */
export function AdminDetailHeader({ back, eyebrow = "BAGATI · ADMIN", title, detail, badge, facts = [], actions }: {
  /** ADMIN-DESIGN-2: optional; left out where no existing back-link text fits (no new text). */
  back?: { href: string; label: string };
  eyebrow?: string;
  title: ReactNode;
  detail?: ReactNode;
  badge?: ReactNode;
  facts?: readonly (readonly [label: ReactNode, value: ReactNode])[];
  actions?: ReactNode;
}) {
  return <div className="mb-6">
    {back && <Link href={back.href} className={`mb-3 inline-block rounded text-sm font-medium text-primary underline-offset-2 hover:underline ${focusRing}`}>{back.label}</Link>}
    <div className="rounded-card border border-line bg-white p-5 shadow-subtle sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-kicker uppercase text-gold-700">{eyebrow}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="min-w-0 break-words text-h1 text-fg">{title}</h1>
            {badge}
          </div>
          {detail && <p className="mt-1.5 max-w-3xl break-words text-sm text-fg-secondary">{detail}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {facts.length > 0 && <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4 lg:grid-cols-4">
        {facts.map(([label, value], index) => <div key={index} className="min-w-0">
          <dt className="text-xs font-medium text-fg-secondary">{label}</dt>
          <dd className="mt-0.5 break-words text-sm font-semibold text-fg">{value}</dd>
        </div>)}
      </dl>}
    </div>
  </div>;
}
