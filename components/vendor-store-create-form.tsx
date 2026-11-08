"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { InteractiveMap, type MapPoint } from "@/components/interactive-map";

type City = { id: string; name: string };
type Plan = { id: string; name: string; description: string | null; monthlyPrice: string | number };
const input = "mt-1 w-full rounded-xl border border-[#ded9cf] bg-white px-3.5 py-3 text-sm outline-none focus:border-[#b89758]";

export default function VendorStoreCreateForm({ cities, plans }: { cities: City[]; plans: Plan[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [location, setLocation] = useState<MapPoint | null>(null);
  const [mapUrl, setMapUrl] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const response = await fetch("/api/vendor/stores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...values, latitude: location?.latitude ?? null, longitude: location?.longitude ?? null, mapUrl: mapUrl.trim() || null }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Mağaza yaratmaq mümkün olmadı.");
      router.replace(`/vendor/${result.store.id}/profile`); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Mağaza yaratmaq mümkün olmadı."); }
    finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="mt-6 grid gap-5">
    <section className="rounded-2xl border border-[#e8e4db] bg-white p-5 sm:p-7"><h2 className="font-semibold text-[#0b1726]">Mağaza məlumatları</h2><div className="mt-4 grid gap-4 sm:grid-cols-2">
      <label className="text-sm">Mağaza adı<input name="name" required minLength={2} maxLength={120} className={input}/></label>
      <label className="text-sm">Slug (istəyə görə)<input name="slug" maxLength={120} placeholder="magaza-adi" className={input}/><span className="text-xs text-slate-500">Boş saxlanarsa mağaza adından yaradılacaq.</span></label>
      <label className="text-sm">Şəhər<select name="cityId" required defaultValue="" className={input}><option value="" disabled>Şəhər seçin</option>{cities.map(city=><option key={city.id} value={city.id}>{city.name}</option>)}</select></label>
      <label className="text-sm sm:col-span-2">Təsvir<textarea name="description" maxLength={3000} rows={3} className={input}/></label>
      <label className="text-sm">Əlaqə telefonu<input name="contactPhone" required type="tel" minLength={5} maxLength={40} className={input}/></label>
      <label className="text-sm">Əlaqə e-poçtu<input name="contactEmail" required type="email" maxLength={254} className={input}/></label>
      <label className="text-sm sm:col-span-2">Ünvan<input name="address" required minLength={3} maxLength={300} className={input}/></label>
    </div></section>
    <section className="rounded-2xl border border-[#e8e4db] bg-white p-5 sm:p-7"><h2 className="font-semibold text-[#0b1726]">Xəritə mövqeyi</h2><p className="mt-1 text-sm text-slate-500">Xəritəyə toxunaraq mağazanızın dəqiq yerini seçin. Seçim edilməsə koordinat saxlanılmayacaq.</p><div className="mt-4"><InteractiveMap selected={location} onSelect={setLocation} className="h-72 sm:h-80"/><p className="mt-2 text-xs text-slate-500">{location ? `Seçilmiş nöqtə: ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}` : "Azərbaycan xəritənin ilkin görünüşüdür; xəritəni sürüşdürərək istənilən ölkəni seçə bilərsiniz."}</p>{location&&<button type="button" onClick={()=>setLocation(null)} className="mt-2 text-sm text-[#85621d]">Mövqeyi sil</button>}</div><label className="mt-4 block text-sm">Xarici xəritə linki (istəyə görə)<input type="url" value={mapUrl} onChange={e=>setMapUrl(e.target.value)} placeholder="https://…" className={input}/></label></section>
    <section className="rounded-2xl border border-[#e8e4db] bg-white p-5 sm:p-7"><h2 className="font-semibold text-[#0b1726]">Abunəlik planı</h2><p className="mt-1 text-sm text-slate-500">Plan seçimi ödəniş deyil. Ödəniş provayderi qoşulmadığı üçün abunəlik Gözləyir statusunda qalacaq.</p>{plans.length?<div className="mt-4 grid gap-3 md:grid-cols-2">{plans.map((plan,index)=><label key={plan.id} className="flex cursor-pointer gap-3 rounded-xl border border-[#e8e4db] p-4 has-[:checked]:border-[#b89758] has-[:checked]:bg-[#fbf8f0]"><input type="radio" name="planId" value={plan.id} required defaultChecked={index===0} className="mt-1 accent-[#173c40]"/><span><b>{plan.name}</b><span className="ml-2 text-sm text-slate-600">{Number(plan.monthlyPrice).toFixed(2)} ₼ / ay</span>{plan.description&&<span className="mt-1 block text-sm text-slate-500">{plan.description}</span>}</span></label>)}</div>:<p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Hazırda aktiv plan yoxdur.</p>}</section>
    {error&&<p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    <button type="submit" disabled={busy||plans.length===0||cities.length===0} className="rounded-xl bg-[#173c40] px-5 py-3.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy?"Yaradılır…":"Qaralama mağazanı yarat"}</button>
  </form>;
}
