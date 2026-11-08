type Props = { data: { averageOrderValue: number; previousPeriod: { orders: number; revenue: number }; topCategories: { name: string; quantity: number; revenue: number }[]; lowStockProducts: number } };

const card = "rounded-2xl border border-[#e9e4da] bg-white p-5";
export default function VendorAdvancedAnalytics({ data }: Props) {
  return <section className="mt-5" aria-labelledby="advanced-analytics-title">
    <div className="mb-3"><p className="text-xs font-semibold uppercase tracking-[.16em] text-[#967844]">PRO</p><h2 id="advanced-analytics-title" className="mt-1 text-xl font-semibold">Ətraflı analitika</h2></div>
    <div className="grid gap-3 sm:grid-cols-3">
      <article className={card}><p className="text-sm text-slate-500">Orta sifariş məbləği</p><b className="mt-2 block text-xl">{data.averageOrderValue.toFixed(2)} ₼</b></article>
      <article className={card}><p className="text-sm text-slate-500">Əvvəlki eyni müddət</p><b className="mt-2 block text-xl">{data.previousPeriod.revenue.toFixed(2)} ₼</b><p className="mt-1 text-xs text-slate-500">{data.previousPeriod.orders} çatdırılmış sifariş</p></article>
      <article className={card}><p className="text-sm text-slate-500">Az stoklu aktiv məhsullar</p><b className="mt-2 block text-xl">{data.lowStockProducts}</b></article>
    </div>
    <div className={`${card} mt-3`}><h3 className="font-semibold">Kateqoriyalar üzrə satış</h3>{data.topCategories.length ? <ul className="mt-3 divide-y">{data.topCategories.map(category => <li key={category.name} className="flex justify-between gap-3 py-2 text-sm"><span>{category.name} · {category.quantity} ədəd</span><b>{category.revenue.toFixed(2)} ₼</b></li>)}</ul> : <p className="mt-2 text-sm text-slate-500">Seçilmiş tarix aralığında çatdırılmış satış yoxdur.</p>}<p className="mt-3 text-xs text-slate-500">Endirim və kampaniya performansı göstərilmir: sifariş tarixçəsində bu göstəricilər üçün ayrıca qiymət snapshot-u saxlanmır.</p></div>
  </section>;
}
