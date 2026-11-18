import Link from "next/link";
import { ArrowRight, BadgeCheck, Store, Truck } from "lucide-react";

/**
 * Three short trust points under a gold hairline (design T5). Only claims that are true today (owner brief):
 * sellers register with a VÖEN, each store sets its own delivery terms, and anyone can apply to sell. Nothing about
 * online or card payment (not live yet), free delivery or ratings.
 */
export function TrustRow() {
  const item = "flex min-w-0 items-start gap-3";
  const icon = "grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-subtle text-primary ring-1 ring-inset ring-brand-100";
  return (
    <section aria-label="BAGATI haqqında qısa" className="container pb-2 pt-1 sm:pb-4">
      <div className="border-t border-gold-200 pt-5 sm:pt-6">
        <ul className="grid gap-4 sm:grid-cols-3 sm:gap-6">
          <li className={item}>
            <span aria-hidden="true" className={icon}><BadgeCheck size={19} strokeWidth={1.8} /></span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-fg">Doğrulanmış satıcılar</span>
              <span className="mt-0.5 block text-xs text-fg-muted">Mağazalar VÖEN ilə qeydiyyatdan keçir</span>
            </span>
          </li>
          <li className={item}>
            <span aria-hidden="true" className={icon}><Truck size={19} strokeWidth={1.8} /></span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-fg">Hər mağazanın öz çatdırılma şərtləri</span>
              <span className="mt-0.5 block text-xs text-fg-muted">Şərtləri mağaza səhifəsində və səbətdə görürsən</span>
            </span>
          </li>
          <li className={item}>
            <span aria-hidden="true" className={icon}><Store size={19} strokeWidth={1.8} /></span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-fg">Satıcı olmaq asandır</span>
              <Link href="/vendor/apply" className="mt-0.5 inline-flex min-h-11 items-center gap-1 rounded-sm text-xs font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:min-h-0">
                Müraciət et<ArrowRight aria-hidden="true" size={13} />
              </Link>
            </span>
          </li>
        </ul>
      </div>
    </section>
  );
}
