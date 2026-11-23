/**
 * PRO block of the seller sales page. SELLER-ANALYTICS-1 (finding 1): the average order value, the previous period and
 * the sales-by-category card were removed here; the "Sifarişlər" section above shows them for received orders. Only
 * the low-stock count remains, under the existing heading.
 */
type Props = { data: { lowStockProducts: number } };

const card = "rounded-2xl border border-[#e9e4da] bg-white p-5";
export default function VendorAdvancedAnalytics({ data }: Props) {
  return <section className="mt-5" aria-labelledby="advanced-analytics-title">
    <div className="mb-3"><p className="text-xs font-semibold uppercase tracking-[.16em] text-[#967844]">PRO</p><h2 id="advanced-analytics-title" className="mt-1 text-xl font-semibold">Ətraflı analitika</h2></div>
    <div className="grid gap-3 sm:grid-cols-3">
      <article className={card}><p className="text-sm text-slate-500">Az stoklu aktiv məhsullar</p><b className="mt-2 block text-xl">{data.lowStockProducts}</b></article>
    </div>
  </section>;
}
