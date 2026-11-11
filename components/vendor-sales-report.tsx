"use client";
import { useCallback, useEffect, useState } from "react";
import { Download, Info } from "lucide-react";
import VendorAdvancedAnalytics from "@/components/vendor-advanced-analytics";
import { vendorFinanceCsv, type FinanceBucket, type VendorFinanceSummary } from "@/lib/vendor-finance";

type SalesData = {
  finance?: VendorFinanceSummary;
  currentCommissionRate?: number | null;
  payoutsTracked?: boolean;
  products?: { name: string; quantity: number; revenue: number }[];
  advancedAnalytics?: Parameters<typeof VendorAdvancedAnalytics>[0]["data"] | null;
};

const azn = (cents: number) => `${(cents / 100).toLocaleString("az-AZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₼`;
const box = "rounded-2xl border border-[#e9e4da] bg-white p-5";
const input = "w-full rounded-xl border border-[#ded9cf] bg-white px-3 py-2.5 text-sm";
const periods = { daily: "Gün", weekly: "Həftə (bazar ertəsindən)", monthly: "Ay" } as const;
type Period = keyof typeof periods;

function isoDay(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export default function VendorSalesReport({ storeId }: { storeId: string }) {
  const today = new Date();
  const [from, setFrom] = useState(isoDay(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(isoDay(today));
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
  const buckets: FinanceBucket[] = finance ? finance[period] : [];

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

    {finance && <>
      <section aria-label="Satış göstəriciləri" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Çatdırılmış sifariş", String(finance.deliveredOrders), "Seçilmiş dövrdə çatdırılıb"],
          ["Satılan məhsul", `${finance.soldQuantity} ədəd`, "Çatdırılmış sifarişlərdə"],
          ["Xalis satış", azn(finance.netSalesCents), finance.refundedCents ? `${azn(finance.refundedCents)} geri ödəniş çıxılıb` : "Geri ödəniş yoxdur"],
          ["Platforma komissiyası", azn(finance.commissionCents), data.currentCommissionRate != null ? `Hazırkı faiz: ${(data.currentCommissionRate * 100).toFixed(2)}%` : "Hazırda komissiya faizi təyin edilməyib"],
        ].map(([label, value, hint]) => <div key={label} className={box}><p className="text-sm text-slate-500">{label}</p><b className="mt-2 block text-2xl text-[#142d38]">{value}</b><p className="mt-1 text-xs text-slate-500">{hint}</p></div>)}
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <div className={`${box} border-[#cfe0da] bg-[#f3f8f6]`}><p className="text-sm text-slate-600">Təxmini qazancınız</p><b className="mt-2 block text-2xl text-[#1f5d55]">{azn(finance.estimatedEarningsCents)}</b><p className="mt-1 text-xs text-slate-500">Xalis satış − komissiya. Bu, köçürülmüş məbləğ deyil.</p></div>
        <div className={box}><p className="text-sm text-slate-600">Ödənişi gözlənilən açıq sifarişlər</p><b className="mt-2 block text-2xl text-[#8c6b2b]">{azn(finance.awaitingPayment.amountCents)}</b><p className="mt-1 text-xs text-slate-500">{finance.awaitingPayment.orders} sifariş · alıcı ödənişi hələ təsdiqlənməyib</p></div>
        <div className={box}><p className="text-sm text-slate-600">Ödənilib, çatdırılma gözləyir</p><b className="mt-2 block text-2xl text-[#142d38]">{azn(finance.paidInProgress.amountCents)}</b><p className="mt-1 text-xs text-slate-500">{finance.paidInProgress.orders} sifariş · çatdırıldıqdan sonra satışa daxil olur</p></div>
      </section>

      {(finance.ordersWithoutCommissionRule > 0 || data.payoutsTracked === false) && <div className="flex gap-3 rounded-2xl border border-[#eadbb8] bg-[#fbf6ea] p-4 text-sm text-[#5d4a22]">
        <Info size={18} className="mt-0.5 shrink-0" aria-hidden="true"/>
        <div className="space-y-1">
          {finance.ordersWithoutCommissionRule > 0 && <p>{finance.ordersWithoutCommissionRule} sifariş üçün komissiya faizi qeydə alınmayıb ({azn(finance.salesWithoutCommissionRuleCents)}). Bu sifarişlərin komissiyası hesablanmayıb; dəqiq məbləği administratordan öyrənin.</p>}
          {data.payoutsTracked === false && <p>Satıcıya edilən köçürmələr hələ sistemdə qeydə alınmır. Ona görə “tamamlanmış ödənişlər” bölməsi göstərilmir; köçürmə məlumatı üçün administratorla əlaqə saxlayın.</p>}
        </div>
      </div>}

      <section className={box}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-[#142d38]">Dövrlər üzrə satış</h2>
          <div className="flex flex-wrap gap-2">
            <div role="tablist" aria-label="Qruplaşdırma" className="inline-flex rounded-xl border border-[#ded9cf] p-1 text-sm">
              {(Object.keys(periods) as Period[]).map((key) => <button key={key} type="button" role="tab" aria-selected={period === key} onClick={() => setPeriod(key)} className={`min-h-9 rounded-lg px-3 ${period === key ? "bg-[#173c40] text-white" : "text-[#536273]"}`}>{key === "daily" ? "Günlük" : key === "weekly" ? "Həftəlik" : "Aylıq"}</button>)}
            </div>
            <button type="button" onClick={downloadCsv} disabled={!buckets.length} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#ded9cf] px-3 text-sm disabled:opacity-50"><Download size={15} aria-hidden="true"/> CSV yüklə</button>
          </div>
        </div>
        {buckets.length ? <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-xs text-slate-500"><tr><th className="py-2 pr-3 font-medium">{periods[period]}</th><th className="py-2 pr-3 font-medium">Sifariş</th><th className="py-2 pr-3 font-medium">Ədəd</th><th className="py-2 pr-3 font-medium">Xalis satış</th><th className="py-2 pr-3 font-medium">Komissiya</th><th className="py-2 font-medium">Təxmini qazanc</th></tr></thead>
            <tbody className="divide-y divide-[#eeeae2]">{buckets.map((row) => <tr key={row.key}><td className="py-2.5 pr-3">{row.key}</td><td className="py-2.5 pr-3">{row.orders}</td><td className="py-2.5 pr-3">{row.quantity}</td><td className="py-2.5 pr-3">{azn(row.netSalesCents)}</td><td className="py-2.5 pr-3">{azn(row.commissionCents)}</td><td className="py-2.5 font-semibold">{azn(row.estimatedEarningsCents)}</td></tr>)}</tbody>
          </table>
        </div> : <p className="mt-4 text-sm text-slate-500">Seçilmiş dövrdə çatdırılmış sifariş yoxdur.</p>}
      </section>

      {data.products && data.products.length > 0 && <section className={box}>
        <h2 className="font-semibold text-[#142d38]">Məhsullar üzrə satış</h2>
        <ul className="mt-3 divide-y divide-[#eeeae2] text-sm">{[...data.products].sort((a, b) => b.revenue - a.revenue).map((product) => <li key={product.name} className="flex justify-between gap-3 py-2.5"><span className="min-w-0 break-words">{product.name} · {product.quantity} ədəd</span><b className="shrink-0">{Number(product.revenue).toFixed(2)} ₼</b></li>)}</ul>
        <p className="mt-2 text-xs text-slate-500">Məhsul məbləğləri geri ödənişlər çıxılmadan göstərilir.</p>
      </section>}

      {data.advancedAnalytics && <VendorAdvancedAnalytics data={data.advancedAnalytics}/>}
    </>}
  </div>;
}
