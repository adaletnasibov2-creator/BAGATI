"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type City = { id: string; name: string };
const input = "mt-1 w-full rounded-xl border border-[#ded9cf] bg-white px-3.5 py-3 text-sm outline-none focus:border-[#b89758]";

function suggestedAddress(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

export default function VendorStoreCreateForm({ cities }: { cities: City[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [storeAddress, setStoreAddress] = useState("");
  const [addressEdited, setAddressEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const response = await fetch("/api/vendor/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, slug: storeAddress }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Mağazanı yaratmaq mümkün olmadı.");
      router.replace(`/vendor/${result.store.id}/profile`);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Mağazanı yaratmaq mümkün olmadı.");
    } finally {
      setBusy(false);
    }
  }

  return <form onSubmit={submit} className="mt-6 grid gap-5">
    <div className="rounded-2xl border border-[#e8e4db] bg-white p-5 sm:p-7">
      <p className="text-xs font-semibold uppercase tracking-[.16em] text-[#967844]">1-ci addım · Mağazanın tanıdılması</p>
      <h2 className="mt-1 text-xl font-semibold text-[#0b1726]">Əvvəlcə mağazanızı yaradaq</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">Bu məlumatlarla qeyri-aktiv qaralama yaradılacaq. Əlaqə, şəkil, ünvan və hüquqi məlumatları sonrakı addımda əlavə edib istənilən vaxt davam edə bilərsiniz.</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">Mağazanın adı
          <input name="name" required minLength={2} maxLength={120} value={name} onChange={event => {
            const nextName = event.target.value;
            setName(nextName);
            if (!addressEdited) setStoreAddress(suggestedAddress(nextName));
          }} className={input} autoComplete="organization" placeholder="Məsələn, Bakı Moda" />
        </label>
        <label className="text-sm sm:col-span-2">Mağazanın BAGATI-dakı internet ünvanı
          <div className="mt-1 flex items-center rounded-xl border border-[#ded9cf] bg-white focus-within:border-[#b89758]">
            <span className="pl-3 text-sm text-slate-500">/stores/</span>
            <input name="storeAddress" required minLength={2} maxLength={120} value={storeAddress} onChange={event => { setAddressEdited(true); setStoreAddress(suggestedAddress(event.target.value)); }} className="min-w-0 flex-1 rounded-r-xl px-2 py-3 text-sm outline-none" placeholder="baki-moda" />
          </div>
          <span className="mt-1 block text-xs leading-5 text-slate-500">Adınızdan təklif hazırlanır. Ünvanı dəyişə bilərsiniz; boşluq və xüsusi işarələr avtomatik uyğunlaşdırılır.</span>
        </label>
        <label className="text-sm sm:col-span-2">Şəhər
          <select name="cityId" required defaultValue="" className={input}>
            <option value="" disabled>Şəhər seçin</option>
            {cities.map(city => <option key={city.id} value={city.id}>{city.name}</option>)}
          </select>
        </label>
        <label className="text-sm sm:col-span-2">Qısa təsvir <span className="text-slate-500">(istəyə bağlı)</span>
          <textarea name="description" maxLength={3000} rows={3} className={input} placeholder="Mağazanızda nə satıldığını qısaca yazın." />
        </label>
      </div>
    </div>
    {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    <button type="submit" disabled={busy || cities.length === 0 || storeAddress.length < 2} className="min-h-11 rounded-xl bg-[#173c40] px-5 py-3.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
      {busy ? "Yaradılır…" : "Qaralama yarat və qurulumu davam et"}
    </button>
    {cities.length === 0 && <p className="text-sm text-amber-800">Şəhər siyahısı hazırda boşdur. Bir qədər sonra yenidən yoxlayın.</p>}
  </form>;
}
