"use client";

import { FormEvent, useState } from "react";
import VendorImport from "@/components/vendor-import";
import { adminStatusLabel } from "@/lib/admin-labels";

type StoreOption = { id: string; name: string; vendorName: string; status: string };

const input = "w-full rounded-xl border border-[#ded9cf] bg-white px-3 py-2.5 text-sm";

export default function AdminProductImport() {
  const [query, setQuery] = useState("");
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selected, setSelected] = useState<StoreOption | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSelected(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch(`/api/admin/imports/stores?${params}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Mağazalar yüklənmədi.");
      setStores(result.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Mağazalar yüklənmədi.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="mb-5 rounded-2xl border border-[#e7e3d9] bg-white p-5">
    <h2 className="font-semibold">Məhsulları toplu idxal et</h2>
    <p className="mt-1 text-sm text-slate-500">Hədəf mağazanı axtarıb seçin. Yeni məhsullar qaralama kimi yaradılır; SKU uyğunluğu yalnız seçilmiş mağaza daxilində yoxlanır.</p>
    <form onSubmit={search} className="mt-4 flex flex-col gap-3 sm:flex-row">
      <label className="grid flex-1 gap-1 text-sm">Mağaza adı və ya satıcı
        <input className={input} maxLength={120} value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <button disabled={busy} className="self-end rounded-xl bg-[#173c40] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? "Axtarılır…" : "Mağaza axtar"}
      </button>
    </form>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {stores.length > 0 && <label className="mt-4 grid max-w-xl gap-1 text-sm">Məhsulların aid olacağı mağaza
      <select className={input} value={selected?.id ?? ""} onChange={(event) => setSelected(stores.find((store) => store.id === event.target.value) ?? null)}>
        <option value="">Mağaza seçin</option>
        {stores.map((store) => <option key={store.id} value={store.id}>{store.name} · {store.vendorName} · {adminStatusLabel("store", store.status)}</option>)}
      </select>
    </label>}
    {stores.length === 0 && !busy && !error && <p className="mt-3 text-xs text-slate-500">Mağaza tapmaq üçün axtarış edin. Maksimum 25 nəticə göstərilir.</p>}
    {selected && <VendorImport key={selected.id} storeId={selected.id} endpointUrl={`/api/admin/stores/${encodeURIComponent(selected.id)}/imports`} assetEndpointUrl={`/api/admin/stores/${encodeURIComponent(selected.id)}/assets`} />}
  </section>;
}
