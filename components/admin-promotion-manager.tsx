"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useConfirmDialog } from "@/components/admin-ui/confirm-dialog";
import { formatMoney } from "@/lib/format-money";

type StoreOption = { id: string; name: string };
type ProductOption = { id: string; storeId: string; name: string; price: string };
type Promotion = {
  id: string;
  storeId: string | null;
  name: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  discountType: string | null;
  discountValue: string | number | null;
  products: { productId: string }[];
  store: { id: string; name: string } | null;
};
type FormValues = {
  id?: string;
  storeId: string;
  name: string;
  description: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  discountType: "PERCENT" | "FIXED";
  discountValue: string;
  productIds: string[];
};
const emptyForm = (): FormValues => ({ storeId: "", name: "", description: "", startsAt: "", endsAt: "", isActive: false, discountType: "PERCENT", discountValue: "", productIds: [] });
const input = "w-full rounded-xl border border-[#ded9cf] bg-white px-3 py-2.5 text-sm";
const localDateTime = (value: string) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export default function AdminPromotionManager() {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [items, setItems] = useState<Promotion[]>([]);
  const [form, setForm] = useState<FormValues>(emptyForm);
  const { confirm, dialog } = useConfirmDialog();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    const response = await fetch("/api/admin/promotions", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Kampaniyalar yüklənmədi.");
    setStores(data.stores);
    setProducts(data.products);
    setItems(data.items);
  }

  useEffect(() => {
    let active = true;
    load().catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Kampaniyalar yüklənmədi.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const storeProducts = products.filter((product) => product.storeId === form.storeId);
  function edit(item: Promotion) {
    setForm({
      id: item.id,
      storeId: item.storeId ?? "",
      name: item.name,
      description: item.description ?? "",
      startsAt: localDateTime(item.startsAt),
      endsAt: localDateTime(item.endsAt),
      isActive: item.isActive,
      discountType: item.discountType === "FIXED" ? "FIXED" : "PERCENT",
      discountValue: item.discountValue?.toString() ?? "",
      productIds: item.products.map((product) => product.productId),
    });
    setError("");
    setMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/promotions", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          description: form.description || null,
          startsAt: new Date(form.startsAt).toISOString(),
          endsAt: new Date(form.endsAt).toISOString(),
          discountValue: Number(form.discountValue),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kampaniya saxlanılmadı.");
      setMessage(data.message || "Kampaniya yadda saxlanıldı.");
      setForm(emptyForm());
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Kampaniya saxlanılmadı.");
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(id: string) {
    if (!await confirm("Kampaniyanı deaktiv etmək istəyirsiniz?")) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/admin/promotions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kampaniya deaktiv edilmədi.");
      setMessage(data.message || "Kampaniya deaktiv edildi.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Kampaniya deaktiv edilmədi.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="space-y-5">{dialog}
    <section className="rounded-2xl border border-[#e7e3d9] bg-white p-5">
      <h2 className="font-semibold">{form.id ? "Kampaniyanı redaktə et" : "Yeni mağaza kampaniyası"}</h2>
      <p className="mt-1 text-sm text-slate-500">Endirimlər birləşdirilmir. Eyni məhsul üçün üst-üstə düşən aktiv kampaniya rədd edilir.</p>
      <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">Mağaza<select className={input} required value={form.storeId} onChange={(event) => setForm((current) => ({ ...current, storeId: event.target.value, productIds: [] }))}><option value="">Seçin</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
        <label className="grid gap-1 text-sm">Kampaniya adı<input className={input} required minLength={2} maxLength={120} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
        <label className="grid gap-1 text-sm">Endirim növü<select className={input} value={form.discountType} onChange={(event) => setForm((current) => ({ ...current, discountType: event.target.value as FormValues["discountType"] }))}><option value="PERCENT">Faiz</option><option value="FIXED">Sabit məbləğ (AZN)</option></select></label>
        <label className="grid gap-1 text-sm">Endirim dəyəri<input className={input} type="number" min="0.01" step="0.01" max={form.discountType === "PERCENT" ? "99.99" : undefined} required value={form.discountValue} onChange={(event) => setForm((current) => ({ ...current, discountValue: event.target.value }))} /></label>
        <label className="grid gap-1 text-sm">Başlama vaxtı<input className={input} type="datetime-local" required value={form.startsAt} onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))} /></label>
        <label className="grid gap-1 text-sm">Bitmə vaxtı<input className={input} type="datetime-local" required value={form.endsAt} onChange={(event) => setForm((current) => ({ ...current, endsAt: event.target.value }))} /></label>
        <label className="grid gap-1 text-sm sm:col-span-2">Təsvir<textarea className={input} rows={2} maxLength={1000} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
        <label className="grid gap-1 text-sm sm:col-span-2">Məhsullar (Ctrl/Cmd ilə bir neçə məhsul seçin)<select className={input} multiple size={Math.min(8, Math.max(4, storeProducts.length))} required value={form.productIds} onChange={(event) => setForm((current) => ({ ...current, productIds: Array.from(event.target.selectedOptions, (option) => option.value) }))}>{storeProducts.map((product) => <option key={product.id} value={product.id}>{product.name} · {formatMoney(product.price)}</option>)}</select></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} />Aktiv et</label>
        {error && <p role="alert" className="sm:col-span-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {message && <p role="status" className="sm:col-span-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
        <div className="flex gap-2"><button disabled={busy} className="w-fit rounded-xl bg-[#173c40] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Gözləyin…" : "Saxla"}</button>{form.id && <button type="button" disabled={busy} onClick={() => setForm(emptyForm())} className="rounded-xl border px-4 py-2.5 text-sm">Ləğv et</button>}</div>
      </form>
    </section>
    <section className="overflow-x-auto rounded-2xl border border-[#e7e3d9] bg-white">
      <h2 className="p-5 font-semibold">Kampaniyalar</h2>
      {loading ? <p className="px-5 pb-5 text-sm text-slate-500">Yüklənir…</p> : items.length ? <table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-[#f8f7f4] text-xs uppercase text-slate-500"><tr>{["Kampaniya", "Mağaza", "Tarix", "Endirim", "Məhsullar", "Status", "Əməl"].map((label) => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody className="divide-y">{items.map((item) => <tr key={item.id}><td className="px-4 py-3">{item.name}</td><td className="px-4 py-3">{item.store?.name ?? "—"}</td><td className="px-4 py-3">{new Date(item.startsAt).toLocaleDateString()} – {new Date(item.endsAt).toLocaleDateString()}</td><td className="px-4 py-3">{item.discountType === "PERCENT" ? `${item.discountValue}%` : formatMoney(item.discountValue)}</td><td className="px-4 py-3">{item.products.length}</td><td className="px-4 py-3">{item.isActive ? "Aktiv" : "Deaktiv"}</td><td className="flex gap-2 px-4 py-3"><button type="button" onClick={() => edit(item)} className="text-[#173c40] underline">Redaktə</button>{item.isActive && <button type="button" disabled={busy} onClick={() => void deactivate(item.id)} className="text-red-700 underline">Deaktiv et</button>}</td></tr>)}</tbody></table> : <p className="px-5 pb-5 text-sm text-slate-500">Kampaniya yoxdur.</p>}
    </section>
  </div>;
}
