"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Plan = { id: string; name: string; monthlyPrice: number | string; description?: string | null };
type Props = {
  storeId: string;
  data: {
    subscription?: { id: string; planId: string; status: string; startedAt?: string | null; currentPeriodEnd?: string | null; plan: { name: string; monthlyPrice: number | string } } | null;
    plans?: Plan[];
    usage?: { products: number; variants: number };
    entitlement?: { limits?: { activeProducts: number; activeVariants: number } | null };
  };
};

const box = "rounded-2xl border border-[#e9e4da] bg-white p-5";
const statusLabels: Record<string, string> = { ACTIVE: "Aktiv", PENDING: "Ödəniş gözləyir", PAST_DUE: "Ödəniş gecikib", SUSPENDED: "Dayandırılıb", CANCELLED: "Ləğv edilib", EXPIRED: "Bitib" };

export default function VendorSubscriptionPanel({ storeId, data }: Props) {
  const router = useRouter();
  const plans = data.plans || [];
  const [planId, setPlanId] = useState(data.subscription?.planId ?? plans[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function savePlan() {
    if (!planId || busy) return;
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch(`/api/vendor/${encodeURIComponent(storeId)}/subscription`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Plan seçimini saxlamaq mümkün olmadı.");
      setMessage(result.message || "Plan seçimi saxlanıldı. Ödəniş edilməyib və abunəlik aktivləşməyib.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sorğu göndərilmədi. Yenidən cəhd edin.");
    } finally { setBusy(false); }
  }

  const canChoosePlan = !data.subscription || data.subscription.status === "PENDING";

  return <>
    <section className={`${box} mt-5`}>
      <h2 className="font-semibold">Abunəlik vəziyyəti</h2>
      {data.subscription ? <>
        <p className="mt-3 text-lg font-semibold">{data.subscription.plan.name} · {Number(data.subscription.plan.monthlyPrice).toFixed(2)} ₼ / ay</p>
        <p className="mt-1 text-sm text-slate-600">Vəziyyət: {statusLabels[data.subscription.status] || "Əlavə məlumat tələb olunur"}</p>
        {data.subscription.currentPeriodEnd && <p className="mt-1 text-sm text-slate-500">Cari dövrün sonu: {new Date(data.subscription.currentPeriodEnd).toLocaleDateString("az-AZ")}</p>}
      </> : <p className="mt-3 text-sm text-slate-600">Bu mağaza üçün hələ plan seçilməyib.</p>}
      <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Plan seçimi mağaza üçün gözləyən abunəlik qeydini yaradır və ya dəyişir. Ödəniş provayderi qoşulmadığı üçün bu addım ödəniş etmir, abunəliyi və mağazanı aktivləşdirmir.</p>
      {data.usage && <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-[#f8f7f4] p-4"><p className="text-sm text-slate-500">Aktiv məhsullar</p><b className="mt-1 block">{data.usage.products} / {data.entitlement?.limits?.activeProducts ?? "—"}</b></div>
        <div className="rounded-xl bg-[#f8f7f4] p-4"><p className="text-sm text-slate-500">Aktiv seçimlər</p><b className="mt-1 block">{data.usage.variants} / {data.entitlement?.limits?.activeVariants ?? "—"}</b></div>
      </div>}
      {canChoosePlan && plans.length > 0 && <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="vendor-subscription-plan">Abunəlik planı</label>
        <select id="vendor-subscription-plan" value={planId} onChange={event => setPlanId(event.target.value)} className="min-h-11 flex-1 rounded-xl border border-[#ded9cf] bg-white px-3 text-sm">
          {plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name} · {Number(plan.monthlyPrice).toFixed(2)} ₼/ay</option>)}
        </select>
        <button type="button" disabled={busy || !planId} onClick={() => void savePlan()} className="min-h-11 rounded-xl bg-[#173c40] px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saxlanılır…" : data.subscription ? "Plan seçimini yadda saxla" : "Planı seç və davam et"}</button>
      </div>}
      {canChoosePlan && plans.length === 0 && <p className="mt-4 text-sm text-slate-600">Hazırda seçilə bilən plan yoxdur.</p>}
      {!canChoosePlan && <p className="mt-4 text-sm text-slate-600">Bu abunəlik vəziyyətində planı satıcı panelindən dəyişmək mümkün deyil.</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="mt-3 text-sm text-emerald-800">{message}</p>}
    </section>
    {plans.map(plan => <article key={plan.id} className={`${box} mt-3`}><h2 className="font-semibold">{plan.name} · {Number(plan.monthlyPrice).toFixed(2)} ₼ / ay</h2>{plan.description && <p className="mt-2 text-sm text-slate-600">{plan.description}</p>}</article>)}
  </>;
}
