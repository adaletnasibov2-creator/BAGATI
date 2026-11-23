"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Download, Info, Lock, ShoppingBag, TrendingDown, TrendingUp } from "lucide-react";
import VendorAdvancedAnalytics from "@/components/vendor-advanced-analytics";
import { BarList, ColumnChart } from "@/components/vendor-analytics-charts";
import { Badge } from "@/components/ui/badge";
import { cardClass } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { statusLabel } from "@/lib/order-status";
import { vendorFinanceCsv, type FinanceBucket, type VendorFinanceSummary } from "@/lib/vendor-finance";
import { fillBuckets, formatAzn, percentChange, type AnalyticsPeriod, type Change, type NamedTotal, type ReceivedOrdersSummary } from "@/lib/vendor-sales-analytics";

type OrderAnalytics = {
  received: ReceivedOrdersSummary;
  topProducts: NamedTotal[];
  previous: { received: number; orderValueCents: number } | null;
  categories: NamedTotal[] | null;
  cities: { city: string | null; orders: number }[] | null;
};

type SalesData = {
  finance?: VendorFinanceSummary;
  currentCommissionRate?: number | null;
  payoutsTracked?: boolean;
  products?: { name: string; quantity: number; revenue: number }[];
  advancedAnalytics?: Parameters<typeof VendorAdvancedAnalytics>[0]["data"] | null;
  analytics?: OrderAnalytics;
};

/**
 * SELLER-ANALYTICS-1 — NEW visible texts (proposed; final only after the owner approves them). Everything else on
 * the page is existing wording.
 */
export const ANALYTICS_TEXT = {
  ordersNote: "Bu bölmə seçilmiş dövrdə alınan bütün sifarişləri göstərir. Sifarişlərin məbləği ödənilmiş pul deyil: ödəniş təsdiqlənib sifariş çatdırılana qədər satışa daxil edilmir.",
  received: "Alınan sifarişlər",
  cancelledHint: (n: number) => `${n} ləğv edilib`,
  orderValue: "Sifarişlərin məbləği",
  withoutCancelled: "Ləğv edilənlər daxil deyil",
  cancellationRate: "Ləğv faizi",
  rateHint: (cancelled: number, received: number) => `${cancelled} / ${received} sifariş`,
  comparedToPrevious: "əvvəlki eyni müddətə görə",
  noPreviousOrders: "Əvvəlki eyni müddətdə sifariş yoxdur",
  chartTitle: "Sifarişlər dövrlər üzrə",
  noOrders: "Seçilmiş dövrdə sifariş yoxdur.",
  statuses: "Sifariş statusları",
  topProducts: "Ən çox sifariş edilən 5 məhsul",
  categories: "Kateqoriyalar üzrə sifarişlər",
  cities: "Şəhərlər üzrə sifarişlər",
  unknownCity: "Şəhər qeyd olunmayıb",
  deliveredSales: "Çatdırılmış satış",
} as const;

/** Existing texts reused here (not new). */
const PRO_ONLY = "Ətraflı analitika yalnız PRO paketində mövcuddur.";
const AVERAGE_ORDER = "Orta sifariş məbləği";
const ORDERS = "Sifarişlər";

const box = cardClass({ padding: "md" });
const input = "w-full rounded-xl border border-[#ded9cf] bg-white px-3 py-2.5 text-sm";
const periods = { daily: "Gün", weekly: "Həftə (bazar ertəsindən)", monthly: "Ay" } as const;
type Period = keyof typeof periods & AnalyticsPeriod;
const count = (value: number) => value.toLocaleString("az-AZ");

function isoDay(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function ChangeLine({ change }: { change: Change }) {
  if (change.kind === "none") return null;
  if (change.kind === "new") return <p className="mt-2 text-xs text-fg-muted">{ANALYTICS_TEXT.noPreviousOrders}</p>;
  const Icon = change.kind === "down" ? TrendingDown : TrendingUp;
  const sign = change.kind === "up" ? "+" : change.kind === "down" ? "−" : "";
  const tone = change.kind === "up" ? "text-[#1f5d55]" : change.kind === "down" ? "text-[#9a3b2e]" : "text-fg-muted";
  return <p className={`mt-2 flex items-center gap-1 text-xs ${tone}`}>
    {change.kind !== "same" && <Icon size={14} aria-hidden="true"/>}
    <b className="font-semibold">{sign}{change.percent}%</b><span className="text-fg-muted">· {ANALYTICS_TEXT.comparedToPrevious}</span>
  </p>;
}

function Kpi({ label, value, hint, change }: { label: string; value: string; hint?: string; change?: Change | null }) {
  return <div className={box}>
    <p className="text-sm text-fg-muted">{label}</p>
    <b className="mt-2 block text-2xl font-semibold text-[#142d38]">{value}</b>
    {hint && <p className="mt-1 text-xs text-fg-muted">{hint}</p>}
    {change && <ChangeLine change={change}/>}
  </div>;
}

function LockedCard({ title }: { title: string }) {
  return <div className={`${box} bg-[#fbfaf7]`}>
    <div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-[#142d38]">{title}</h3><Badge tone="gold"><Lock size={12} aria-hidden="true"/> PRO</Badge></div>
    <p className="mt-3 text-sm text-fg-muted">{PRO_ONLY}</p>
  </div>;
}

function CardTitle({ children }: { children: ReactNode }) {
  return <h3 className="font-semibold text-[#142d38]">{children}</h3>;
}

export default function VendorSalesReport({ storeId }: { storeId: string }) {
  const today = new Date();
  const [from, setFrom] = useState(isoDay(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(isoDay(today));
  const [shown, setShown] = useState({ from: isoDay(new Date(today.getFullYear(), today.getMonth(), 1)), to: isoDay(today) });
  const [period, setPeriod] = useState<Period>("daily");
  const [data, setData] = useState<SalesData>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (range: { from: string; to: string }) => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams(range);
      const response = await fetch(`/api/vendor/${encodeURIComponent(storeId)}/sales?${query}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Hesabatı yükləmək mümkün olmadı.");
      setData(result);
      setShown(range);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Hesabatı yükləmək mümkün olmadı.");
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  // Initial load only; later loads happen when the seller presses "Tətbiq et".
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load({ from, to }); }, [load]);

  function preset(days: number | "month") {
    const end = new Date();
    const start = days === "month" ? new Date(end.getFullYear(), end.getMonth(), 1) : new Date(end.getFullYear(), end.getMonth(), end.getDate() - (days - 1));
    const range = { from: isoDay(start), to: isoDay(end) };
    setFrom(range.from);
    setTo(range.to);
    void load(range);
  }

  const finance = data.finance;
  const analytics = data.analytics;
  const buckets: FinanceBucket[] = finance ? finance[period] : [];
  const periodSwitch = <div role="tablist" aria-label="Qruplaşdırma" className="inline-flex rounded-xl border border-[#ded9cf] p-1 text-sm">
    {(Object.keys(periods) as Period[]).map((key) => <button key={key} type="button" role="tab" aria-selected={period === key} onClick={() => setPeriod(key)} className={`min-h-9 rounded-lg px-3 ${period === key ? "bg-[#173c40] text-white" : "text-[#536273]"}`}>{key === "daily" ? "Günlük" : key === "weekly" ? "Həftəlik" : "Aylıq"}</button>)}
  </div>;

  function downloadCsv() {
    if (!finance) return;
    const blob = new Blob([vendorFinanceCsv(buckets, periods[period])], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `satis-hesabati-${from}-${to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const received = analytics?.received;
  const series = received ? fillBuckets(received[period], period, new Date(`${shown.from}T00:00:00`), new Date(`${shown.to}T00:00:00`)) : [];
  const previous = analytics?.previous ?? null;

  return <div className="mt-5 space-y-5">
    <form onSubmit={(event) => { event.preventDefault(); void load({ from, to }); }} className={`${box} flex flex-wrap items-end gap-3`}>
      <label className="grid gap-1 text-sm text-slate-600">Başlanğıc tarix<input className={input} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} required/></label>
      <label className="grid gap-1 text-sm text-slate-600">Bitmə tarixi<input className={input} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} required/></label>
      <button disabled={loading} className="min-h-11 rounded-xl bg-[#173c40] px-4 text-sm font-medium text-white disabled:opacity-50">Tətbiq et</button>
      <div className="flex flex-wrap gap-2 text-sm">
        <button type="button" onClick={() => preset(1)} className="min-h-11 rounded-xl border border-[#ded9cf] px-3">Bu gün</button>
        <button type="button" onClick={() => preset(7)} className="min-h-11 rounded-xl border border-[#ded9cf] px-3">Son 7 gün</button>
        <button type="button" onClick={() => preset("month")} className="min-h-11 rounded-xl border border-[#ded9cf] px-3">Bu ay</button>
      </div>
    </form>

    {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    {loading && !finance && <div className={`${box} text-sm text-slate-500`} role="status">Hesabat hazırlanır…</div>}

    {analytics && received && <section aria-labelledby="orders-analytics-title" className="space-y-4" data-sales-orders="">
      <div>
        <h2 id="orders-analytics-title" className="text-xl font-semibold text-[#142d38]">{ORDERS}</h2>
        <p className="mt-1 max-w-3xl text-sm text-fg-muted">{ANALYTICS_TEXT.ordersNote}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label={ANALYTICS_TEXT.received} value={count(received.received)} hint={ANALYTICS_TEXT.cancelledHint(received.cancelled)} change={previous ? percentChange(received.received, previous.received) : null}/>
        <Kpi label={ANALYTICS_TEXT.orderValue} value={formatAzn(received.orderValueCents)} hint={ANALYTICS_TEXT.withoutCancelled} change={previous ? percentChange(received.orderValueCents, previous.orderValueCents) : null}/>
        {previous ? <Kpi label={AVERAGE_ORDER} value={received.averageOrderValueCents === null ? "—" : formatAzn(received.averageOrderValueCents)} hint={ANALYTICS_TEXT.withoutCancelled}/>
          : <div className={`${box} bg-[#fbfaf7]`}><div className="flex items-center justify-between gap-2"><p className="text-sm text-fg-muted">{AVERAGE_ORDER}</p><Badge tone="gold"><Lock size={12} aria-hidden="true"/> PRO</Badge></div><p className="mt-3 text-xs text-fg-muted">{PRO_ONLY}</p></div>}
        <Kpi label={ANALYTICS_TEXT.cancellationRate} value={received.cancellationRate === null ? "—" : `${Math.round(received.cancellationRate * 100)}%`} hint={ANALYTICS_TEXT.rateHint(received.cancelled, received.received)}/>
      </div>

      <div className={box} data-sales-chart="">
        <div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>{ANALYTICS_TEXT.chartTitle}</CardTitle>{periodSwitch}</div>
        {received.received - received.cancelled > 0
          ? <div className="mt-4"><ColumnChart title={ANALYTICS_TEXT.chartTitle} axisLabel={(cents) => formatAzn(cents)} data={series.map((bucket) => ({ key: bucket.key, value: bucket.valueCents, label: `${bucket.key}: ${bucket.orders} sifariş · ${formatAzn(bucket.valueCents)}` }))}/></div>
          : <div className="mt-4"><EmptyState titleAs="h3" icon={<ShoppingBag size={24}/>} title={ANALYTICS_TEXT.noOrders} className="py-8"/></div>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={box}>
          <CardTitle>{ANALYTICS_TEXT.statuses}</CardTitle>
          {received.byStatus.length
            ? <BarList data={received.byStatus.map((row) => ({ key: row.status, label: statusLabel(row.status), value: row.orders, valueText: `${count(row.orders)} sifariş` }))}/>
            : <p className="mt-3 text-sm text-fg-muted">{ANALYTICS_TEXT.noOrders}</p>}
        </div>
        <div className={box}>
          <CardTitle>{ANALYTICS_TEXT.topProducts}</CardTitle>
          {analytics.topProducts.length
            ? <BarList data={analytics.topProducts.map((row, index) => ({ key: `${index}-${row.name}`, label: row.name, detail: `${count(row.quantity)} ədəd`, value: row.valueCents, valueText: formatAzn(row.valueCents) }))}/>
            : <p className="mt-3 text-sm text-fg-muted">{ANALYTICS_TEXT.noOrders}</p>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {analytics.categories ? <div className={box}>
          <CardTitle>{ANALYTICS_TEXT.categories}</CardTitle>
          {analytics.categories.length
            ? <BarList data={analytics.categories.map((row) => ({ key: row.name, label: row.name, detail: `${count(row.quantity)} ədəd`, value: row.valueCents, valueText: formatAzn(row.valueCents) }))}/>
            : <p className="mt-3 text-sm text-fg-muted">{ANALYTICS_TEXT.noOrders}</p>}
        </div> : <LockedCard title={ANALYTICS_TEXT.categories}/>}
        {analytics.cities ? <div className={box}>
          <CardTitle>{ANALYTICS_TEXT.cities}</CardTitle>
          {analytics.cities.length
            ? <BarList data={analytics.cities.map((row) => ({ key: row.city ?? "-", label: row.city ?? ANALYTICS_TEXT.unknownCity, value: row.orders, valueText: `${count(row.orders)} sifariş` }))}/>
            : <p className="mt-3 text-sm text-fg-muted">{ANALYTICS_TEXT.noOrders}</p>}
        </div> : <LockedCard title={ANALYTICS_TEXT.cities}/>}
      </div>
    </section>}

    {finance && <section aria-labelledby="delivered-sales-title" className="space-y-4" data-sales-delivered="">
      <h2 id="delivered-sales-title" className="pt-2 text-xl font-semibold text-[#142d38]">{ANALYTICS_TEXT.deliveredSales}</h2>
      <div aria-label="Satış göstəriciləri" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Çatdırılmış sifariş", String(finance.deliveredOrders), "Seçilmiş dövrdə çatdırılıb"],
          ["Satılan məhsul", `${finance.soldQuantity} ədəd`, "Çatdırılmış sifarişlərdə"],
          ["Xalis satış", formatAzn(finance.netSalesCents), finance.refundedCents ? `${formatAzn(finance.refundedCents)} geri ödəniş çıxılıb` : "Geri ödəniş yoxdur"],
          ["Platforma komissiyası", formatAzn(finance.commissionCents), data.currentCommissionRate != null ? `Hazırkı faiz: ${(data.currentCommissionRate * 100).toFixed(2)}%` : "Hazırda komissiya faizi təyin edilməyib"],
        ].map(([label, value, hint]) => <Kpi key={label} label={label} value={value} hint={hint}/>)}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className={`${box} border-[#cfe0da] bg-[#f3f8f6]`}><p className="text-sm text-slate-600">Təxmini qazancınız</p><b className="mt-2 block text-2xl text-[#1f5d55]">{formatAzn(finance.estimatedEarningsCents)}</b><p className="mt-1 text-xs text-slate-500">Xalis satış − komissiya. Bu, köçürülmüş məbləğ deyil.</p></div>
        <div className={box}><p className="text-sm text-slate-600">Ödənişi gözlənilən açıq sifarişlər</p><b className="mt-2 block text-2xl text-[#8c6b2b]">{formatAzn(finance.awaitingPayment.amountCents)}</b><p className="mt-1 text-xs text-slate-500">{finance.awaitingPayment.orders} sifariş · alıcı ödənişi hələ təsdiqlənməyib</p></div>
        <div className={box}><p className="text-sm text-slate-600">Ödənilib, çatdırılma gözləyir</p><b className="mt-2 block text-2xl text-[#142d38]">{formatAzn(finance.paidInProgress.amountCents)}</b><p className="mt-1 text-xs text-slate-500">{finance.paidInProgress.orders} sifariş · çatdırıldıqdan sonra satışa daxil olur</p></div>
      </div>

      {(finance.ordersWithoutCommissionRule > 0 || data.payoutsTracked === false) && <div className="flex gap-3 rounded-2xl border border-[#eadbb8] bg-[#fbf6ea] p-4 text-sm text-[#5d4a22]">
        <Info size={18} className="mt-0.5 shrink-0" aria-hidden="true"/>
        <div className="space-y-1">
          {finance.ordersWithoutCommissionRule > 0 && <p>{finance.ordersWithoutCommissionRule} sifariş üçün komissiya faizi qeydə alınmayıb ({formatAzn(finance.salesWithoutCommissionRuleCents)}). Bu sifarişlərin komissiyası hesablanmayıb; dəqiq məbləği administratordan öyrənin.</p>}
          {data.payoutsTracked === false && <p>Satıcıya edilən köçürmələr hələ sistemdə qeydə alınmır. Ona görə “tamamlanmış ödənişlər” bölməsi göstərilmir; köçürmə məlumatı üçün administratorla əlaqə saxlayın.</p>}
        </div>
      </div>}

      <div className={box}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold text-[#142d38]">Dövrlər üzrə satış</h3>
          <div className="flex flex-wrap gap-2">
            {periodSwitch}
            <button type="button" onClick={downloadCsv} disabled={!buckets.length} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#ded9cf] px-3 text-sm disabled:opacity-50"><Download size={15} aria-hidden="true"/> CSV yüklə</button>
          </div>
        </div>
        {buckets.length ? <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-xs text-slate-500"><tr><th className="py-2 pr-3 font-medium">{periods[period]}</th><th className="py-2 pr-3 font-medium">Sifariş</th><th className="py-2 pr-3 font-medium">Ədəd</th><th className="py-2 pr-3 font-medium">Xalis satış</th><th className="py-2 pr-3 font-medium">Komissiya</th><th className="py-2 font-medium">Təxmini qazanc</th></tr></thead>
            <tbody className="divide-y divide-[#eeeae2]">{buckets.map((row) => <tr key={row.key}><td className="py-2.5 pr-3">{row.key}</td><td className="py-2.5 pr-3">{row.orders}</td><td className="py-2.5 pr-3">{row.quantity}</td><td className="py-2.5 pr-3">{formatAzn(row.netSalesCents)}</td><td className="py-2.5 pr-3">{formatAzn(row.commissionCents)}</td><td className="py-2.5 font-semibold">{formatAzn(row.estimatedEarningsCents)}</td></tr>)}</tbody>
          </table>
        </div> : <div className="mt-4"><EmptyState titleAs="h3" icon={<Info size={24}/>} title="Seçilmiş dövrdə çatdırılmış sifariş yoxdur." className="py-8"/></div>}
      </div>

      {data.products && data.products.length > 0 && <section className={box}>
        <h3 className="font-semibold text-[#142d38]">Məhsullar üzrə satış</h3>
        <ul className="mt-3 divide-y divide-[#eeeae2] text-sm">{[...data.products].sort((a, b) => b.revenue - a.revenue).map((product) => <li key={product.name} className="flex justify-between gap-3 py-2.5"><span className="min-w-0 break-words">{product.name} · {product.quantity} ədəd</span><b className="shrink-0">{formatAzn(Math.round(product.revenue * 100))}</b></li>)}</ul>
        <p className="mt-2 text-xs text-slate-500">Məhsul məbləğləri geri ödənişlər çıxılmadan göstərilir.</p>
      </section>}

      {data.advancedAnalytics && <VendorAdvancedAnalytics data={data.advancedAnalytics}/>}
    </section>}
  </div>;
}
