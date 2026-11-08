"use client";

import { FormEvent, useEffect, useState } from "react";

type Product = { id: string; name: string; sku: string | null; price: string | number };
type Campaign = { id: string; name: string; description: string | null; startsAt: string; endsAt: string; isActive: boolean; effectiveStatus: "DISABLED" | "SCHEDULED" | "ACTIVE" | "EXPIRED"; discountType: "PERCENT" | "FIXED"; discountValue: string | number; products: { product: Product }[] };
type FormState = { id?: string; name: string; description: string; startsAt: string; endsAt: string; discountType: "PERCENT" | "FIXED"; discountValue: string; isActive: boolean; productIds: string[] };
const toLocalDateTimeInput = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const blankForm = (): FormState => ({ name: "", description: "", startsAt: toLocalDateTimeInput(new Date(Date.now() + 60_000)), endsAt: toLocalDateTimeInput(new Date(Date.now() + 30 * 86400_000)), discountType: "PERCENT", discountValue: "10", isActive: false, productIds: [] });
const input = "w-full rounded-xl border border-[#ded9cf] bg-white px-3 py-2.5 text-sm";
const panel = "rounded-2xl border border-[#e9e4da] bg-white p-5";

function status(campaign: Campaign) { return ({ DISABLED: "Deaktiv", SCHEDULED: "Planlaşdırılıb", ACTIVE: "Aktiv", EXPIRED: "Başa çatıb" })[campaign.effectiveStatus]; }

export default function VendorCampaignManager({ storeId }: { storeId: string }) {
  const url = `/api/vendor/${encodeURIComponent(storeId)}/campaigns`;
  const [campaigns, setCampaigns] = useState<Campaign[]>([]), [products, setProducts] = useState<Product[]>([]), [search, setSearch] = useState("");
  const [form, setForm] = useState<FormState>(blankForm), [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  async function load() {
    const response = await fetch(`${url}?q=${encodeURIComponent(search)}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Kampaniyalar yüklənmədi.");
    setCampaigns(data.items || []); setProducts(data.products || []);
  }
  useEffect(() => { let active = true; fetch(`${url}?q=${encodeURIComponent(search)}`, { cache: "no-store" }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Kampaniyalar yüklənmədi."); if (active) { setCampaigns(data.items || []); setProducts(data.products || []); } }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Kampaniyalar yüklənmədi."); }); return () => { active = false; }; }, [url, search]);

  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const payload = { ...form, startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString(), discountValue: Number(form.discountValue) };
      const response = await fetch(url, { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Kampaniya saxlanılmadı.");
      setMessage(editing ? "Kampaniya yeniləndi." : "Kampaniya yaradıldı."); setForm(blankForm()); setEditing(false); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Kampaniya saxlanılmadı."); }
    finally { setBusy(false); }
  }

  function edit(item: Campaign) {
    setEditing(true); setMessage(""); setError("");
    setForm({ id: item.id, name: item.name, description: item.description || "", startsAt: toLocalDateTimeInput(new Date(item.startsAt)), endsAt: toLocalDateTimeInput(new Date(item.endsAt)), discountType: item.discountType, discountValue: String(item.discountValue), isActive: item.isActive, productIds: item.products.map(link => link.product.id) });
  }

  async function archive(id: string) {
    if (!window.confirm("Kampaniyanı deaktiv edib arxivləmək istəyirsiniz?")) return;
    setError(""); setMessage("");
    try { const response = await fetch(`${url}?id=${encodeURIComponent(id)}`, { method: "DELETE" }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Kampaniya arxivlənmədi."); setMessage("Kampaniya deaktiv edildi."); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Kampaniya arxivlənmədi."); }
  }

  const selectedProducts = campaigns.flatMap(campaign => campaign.products.map(link => link.product)).concat(products).filter((product, index, all) => form.productIds.includes(product.id) && all.findIndex(item => item.id === product.id) === index);
  const field = (key: "name" | "description" | "startsAt" | "endsAt" | "discountValue", label: string, type = "text") => <label className="grid gap-1 text-sm text-slate-600">{label}<input className={input} required={key !== "description"} type={type} min={type === "number" ? "0.01" : undefined} step={type === "number" ? "0.01" : undefined} value={form[key]} onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))}/></label>;

  return <div className="space-y-5">
    <form onSubmit={save} className={`${panel} grid gap-4 sm:grid-cols-2`}>
      <div className="sm:col-span-2"><h2 className="font-semibold">{editing ? "Kampaniyanı redaktə et" : "Yeni kampaniya"}</h2><p className="mt-1 text-xs text-slate-500">Məhsul eyni vaxt aralığında yalnız bir aktiv kampaniyada ola bilər. Kampaniya qiyməti aktiv olduğu müddətdə məhsulun əvvəlki endirimini əvəz edir; endirimlər toplanmır.</p></div>
      {field("name", "Kampaniya adı")}{field("description", "Təsvir")}
      <label className="grid gap-1 text-sm text-slate-600">Endirim növü<select className={input} value={form.discountType} onChange={event => setForm(current => ({ ...current, discountType: event.target.value as FormState["discountType"] }))}><option value="PERCENT">Faiz</option><option value="FIXED">Sabit məbləğ (AZN)</option></select></label>
      {field("discountValue", form.discountType === "PERCENT" ? "Endirim faizi" : "Endirim məbləği (AZN)", "number")}
      {field("startsAt", "Başlanğıc", "datetime-local")}{field("endsAt", "Bitmə", "datetime-local")}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={event => setForm(current => ({ ...current, isActive: event.target.checked }))}/> Aktivləşdir</label>
      <div className="grid gap-2 sm:col-span-2"><label className="grid gap-1 text-sm text-slate-600">Öz məhsullarınızdan seçin<input className={input} value={search} onChange={event => setSearch(event.target.value)} placeholder="Məhsul adı və ya SKU ilə axtar"/></label><div className="max-h-52 overflow-y-auto rounded-xl border border-[#e9e4da] p-2">{products.map(product => <label key={product.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-[#f8f7f4]"><input type="checkbox" checked={form.productIds.includes(product.id)} onChange={event => setForm(current => ({ ...current, productIds: event.target.checked ? [...current.productIds, product.id] : current.productIds.filter(id => id !== product.id) }))}/><span className="min-w-0 flex-1 truncate">{product.name}{product.sku ? ` · ${product.sku}` : ""}</span><span>{Number(product.price).toFixed(2)} ₼</span></label>)}{!products.length && <p className="p-3 text-sm text-slate-500">Aktiv məhsul tapılmadı.</p>}</div><div className="flex flex-wrap gap-2">{selectedProducts.map(product => <button key={product.id} type="button" onClick={() => setForm(current => ({ ...current, productIds: current.productIds.filter(id => id !== product.id) }))} className="rounded-full bg-[#f3f1eb] px-3 py-1 text-xs">{product.name} ×</button>)}</div></div>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 sm:col-span-2">{error}</p>}{message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 sm:col-span-2">{message}</p>}
      <div className="flex gap-2 sm:col-span-2"><button disabled={busy} className="rounded-xl bg-[#173c40] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saxlanılır…" : editing ? "Dəyişiklikləri saxla" : "Kampaniya yarat"}</button>{editing && <button type="button" onClick={() => { setEditing(false); setForm(blankForm()); setError(""); }} className="rounded-xl border px-4 py-3 text-sm">Ləğv et</button>}</div>
    </form>
    {campaigns.map(campaign => <article key={campaign.id} className={panel}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-[#967844]">{status(campaign)}</p><h3 className="mt-1 font-semibold">{campaign.name}</h3>{campaign.description && <p className="mt-1 text-sm text-slate-600">{campaign.description}</p>}<p className="mt-2 text-sm text-slate-600">{campaign.discountType === "PERCENT" ? `${campaign.discountValue}%` : `${Number(campaign.discountValue).toFixed(2)} ₼`} endirim · {new Date(campaign.startsAt).toLocaleString("az-AZ")} – {new Date(campaign.endsAt).toLocaleString("az-AZ")}</p><p className="mt-2 text-xs text-slate-500">Məhsullar: {campaign.products.map(link => link.product.name).join(", ") || "—"}</p></div><div className="flex gap-2"><button type="button" onClick={() => edit(campaign)} className="rounded-lg border px-3 py-2 text-sm">Redaktə et</button><button type="button" onClick={() => void archive(campaign.id)} className="rounded-lg border px-3 py-2 text-sm">Deaktiv et</button></div></div></article>)}
    {!campaigns.length && <p className={panel}>Hazırda kampaniya yoxdur.</p>}
  </div>;
}
