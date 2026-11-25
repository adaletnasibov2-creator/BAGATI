import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ADMIN_POWER_1_TEXT as T, type AttentionItem } from "@/lib/admin-power-1";
import { focusRing } from "@/components/admin-ui/styles";

/**
 * ADMIN-POWER-1: "Diqqət tələb edir" — real counts, each a link to the list that shows the same rows. Items at 0 are
 * not passed in (attentionItems), and the card is not rendered at all when nothing waits.
 */
export function AdminAttentionQueue({ items }: { items: AttentionItem[] }) {
  if (!items.length) return null;
  return <section aria-labelledby="admin-attention-title" className="rounded-card border border-gold-200 bg-white p-5 shadow-subtle">
    <h2 id="admin-attention-title" className="text-h3 text-fg">{T.attentionTitle}</h2>
    <ul className="mt-3 divide-y divide-line">{items.map((item) => <li key={item.key}>
      <Link href={item.href} className={`-mx-2 flex min-h-11 items-center justify-between gap-3 rounded-control px-2 py-2 text-sm transition-colors hover:bg-surface-page ${focusRing}`}>
        <span className="min-w-0 text-fg-body">{item.label}</span>
        <span className="flex items-center gap-1.5">
          <span className="min-w-7 rounded-full bg-gold-100 px-2 py-0.5 text-center text-xs font-semibold tabular-nums text-gold-700 ring-1 ring-inset ring-gold-200">{item.count}</span>
          <ChevronRight size={16} aria-hidden="true" className="text-fg-muted" />
        </span>
      </Link>
    </li>)}</ul>
  </section>;
}
