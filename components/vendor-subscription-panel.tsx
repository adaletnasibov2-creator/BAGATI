"use client";

import { useState } from "react";

type Props = {
  storeId: string;
  data: {
    subscription?: { id: string; planId: string; status: string; startedAt?: string | null; currentPeriodEnd?: string | null; plan: { name: string; monthlyPrice: number | string } } | null;
    plans?: { id: string; name: string; monthlyPrice: number | string; description?: string | null }[];
    usage?: { products: number; variants: number };
    entitlement?: { limits?: { activeProducts: number; activeVariants: number } | null };
  };
};

const box = "rounded-2xl border border-[#e9e4da] bg-white p-5";
const statusLabels: Record<string, string> = { ACTIVE: "Aktiv", PENDING: "Ödəniş gözləyir", PAST_DUE: "Ödəniş gecikib", SUSPENDED: "Dayandırılıb", CANCELLED: "Ləğv edilib", EXPIRED: "Bitib" };

export default function VendorSubscriptionPanel({ storeId, data }: Props) {
  const [planId, setPlanId] = useState(data.subscription?.planId ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function savePlan() {
    if (!planId || busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/vendor/${storeId}/subscription`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId }) });
      const result = await response.json();
      setMessage(response.ok ? result.message : result.error || "Plan seçimi yadda saxlanmadı.");
    } catch { setMessage("Sorğu göndərilmədi. Yenidən cəhd edin."); }
    finally { setBusy(false); }
  }

  return <>
    <section className={`${box} mt-5`}>
      <h2 className="font-semibold">Cari abunəlik</h2>
      {data.subscription ? <>
        <p className="mt-3 text-lg font-semibold">{data.subscription.plan.name} · {Number(data.subscription.plan.monthlyPrice).toFixed(2)} ₼ / ay</p>
        <p className="mt-1 text-sm text-slate-600">Status: {statusLabels[data.subscription.status] || data.subscription.status}</p>
        {data.subscription.currentPeriodEnd && <p className="mt-1 text-sm text-slate-500">Cari dövrün sonu: {new Date(data.subscription.currentPeriodEnd).toLocaleDateString("az-AZ")}</p>}
      </> : <p className="mt-3 text-sm text-slate-500">Mağaza üçün plan qeydi yoxdur.</p>}
      <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Ödəniş provayderi qoşulmayıb. Plan seçimi abunəliyi aktivləşdirmir və ödəniş etmir.</p>
      {data.usage && <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-[#f8f7f4] p-4"><p className="text-sm text-slate-500">Aktiv məhsullar</p><b className="mt-1 block">{data.usage.products} / {data.entitlement?.limits?.activeProducts ?? "—"}</b></div>
        <div className="rounded-xl bg-[#f8f7f4] p-4"><p className="text-sm text-slate-500">Aktiv variantlar</p><b className="mt-1 block">{data.usage.variants} / {data.entitlement?.limits?.activeVariants ?? "—"}</b></div>
      </div>}
      {data.subscription?.status === "PENDING" && <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <select value={planId} onChange={event => setPlanId(event.target.value)} className="min-h-11 flex-1 rounded-xl border border-[#ded9cf] bg-white px-3 text-sm">
          {(data.plans || []).map(plan => <option key={plan.id} value={plan.id}>{plan.name} · {Number(plan.monthlyPrice).toFixed(2)} ₼/ay</option>)}
        </select>
        <button type="button" disabled={busy || !planId} onClick={() => void savePlan()} className="min-h-11 rounded-xl bg-[#173c40] px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Yadda saxlanılır…" : "Plan seçimini yadda saxla"}</button>
      </div>}
      {message && <p role="status" className="mt-3 text-sm text-slate-600">{message}</p>}
    </section>
    <div className="mt-5 grid gap-3 sm:grid-cols-2">
      <article className={box}><h2 className="font-semibold">BASIC · 20 ₼ / ay</h2><p className="mt-2 text-sm text-slate-600">Mağaza profili, məhsul və variant idarəetməsi, anbar, sifarişlər, rəylər, əsas analitika, əsas kampaniyalar və toplu məhsul idxalı.</p><p className="mt-3 text-sm">300 aktiv məhsul · 1 000 aktiv variant · yalnız sahib hesabı</p></article>
      <article className={box}><h2 className="font-semibold">PRO · 50 ₼ / ay</h2><p className="mt-2 text-sm text-slate-600">BASIC imkanları, 2 000 aktiv məhsul, 10 000 aktiv variant və ətraflı analitika. Toplu məhsul idxalı BASIC və PRO planlarında mövcuddur.</p><p className="mt-3 text-xs leading-5 text-slate-500">Maksimum 5 əməkdaş hesabı hazırda autentifikasiya dəstəklənmədiyi üçün bağlıdır. Hesabat ixracı, vitrin fərdiləşdirməsi, API, POS/ERP inteqrasiyası və prioritet dəstək gələcək imkanlardır; aktiv xidmət kimi təqdim edilmir.</p></article>
    </div>
  </>;
}
