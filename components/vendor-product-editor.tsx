"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import VendorImageUploader from "@/components/vendor-image-uploader";
import VendorVariantEditor from "@/components/vendor-variant-editor";
import VendorBrandSelector from "@/components/vendor-brand-selector";
import { presentStockQuantity } from "@/lib/stock-quantity";

const input = "w-full rounded-xl border border-[#ded9cf] bg-white px-3 py-2.5 text-sm";
const box = "rounded-2xl border border-[#e9e4da] bg-white p-5";

export default function VendorProductEditor({ storeId, productId }: { storeId: string; productId: string }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const url = `/api/vendor/${storeId}/products/${productId}`;
  useEffect(() => { void fetch(url).then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || "Məhsul tapılmadı"); setData(result); }).catch(reason => setError(reason instanceof Error ? reason.message : "Məhsul yüklənmədi")); }, [url]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    const form = Object.fromEntries(new FormData(event.currentTarget).entries());
    let variants:any[]=[];try{variants=JSON.parse(String(form.variants||"[]"))}catch{setError("Variant məlumatlarının formatı yanlışdır.");setBusy(false);return}const variantsEnabled=String(form.variantsEnabled)==="true";if(variantsEnabled&&!variants.length){setError("Əvvəlcə xüsusiyyətləri və variant kombinasiyalarını yaradın.");setBusy(false);return}
    const quantity = presentStockQuantity(form.quantity);
    const lowStockThreshold = presentStockQuantity(form.lowStockThreshold);
    if (!variantsEnabled && quantity === null) { setError("Stok miqdarı boş qala bilməz. Sıfır yazmaq olar, boş sahə isə mövcud stoku silmir."); setBusy(false); return; }
    if (!variantsEnabled && lowStockThreshold === null) { setError("Az stok həddi tam ədəd olmalıdır."); setBusy(false); return; }
    if (variants.some((variant) => presentStockQuantity(variant.quantity) === null || presentStockQuantity(variant.lowStockThreshold) === null)) { setError("Hər variantın stoku və az stok həddi tam ədəd olmalıdır. Boş sahə 0 kimi saxlanmır."); setBusy(false); return; }
    const payload = { ...form, sku: String(form.sku || "").trim() || null, price: Number(form.price), discountPrice: form.discountPrice ? Number(form.discountPrice) : null, categoryId: form.categoryId || null, brandId: form.brandId || null, images: String(form.images || "").split(/\n|,/).map(value => value.trim()).filter(Boolean), variantsEnabled, variants, ...(quantity !== null ? { quantity } : {}), ...(lowStockThreshold !== null ? { lowStockThreshold } : {}) };
    try { const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); const result = await response.json(); if (!response.ok) throw new Error(result.error === "Məhsul yenilənə bilmədi" ? "Bu məhsulu yeniləmək mümkün olmadı. Məlumatları yoxlayın." : result.error || "Məhsul yenilənmədi"); setData((current:any)=>({...current,product:result.product})); setMessage("Məhsul məlumatları yadda saxlanıldı."); }
    catch(reason) { setError(reason instanceof Error ? reason.message : "Məhsul yenilənmədi"); }
    finally { setBusy(false); }
  }

  async function archive() {
    if (!window.confirm("Məhsul arxivlənsin? Müştərilər onu artıq mağazada görməyəcək.")) return;
    setBusy(true); setError("");
    try { const response = await fetch(url, { method: "DELETE" }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "Məhsul arxivlənmədi"); setMessage("Məhsul arxivləndi."); setData((current:any)=>({...current,product:{...current.product,status:"ARCHIVED"}})); }
    catch(reason) { setError(reason instanceof Error ? reason.message : "Məhsul arxivlənmədi"); }
    finally { setBusy(false); }
  }

  if (error&&!data) return <div role="alert" className={box}>{error}</div>;
  if (!data) return <div className={box}>Məhsul məlumatları yüklənir…</div>;
  const product=data.product;
  return <div><Link href={`/vendor/${storeId}/products`} className="text-sm text-[#85621d]">← Məhsullara qayıt</Link><p className="mt-5 text-sm font-medium text-[#967844]">MƏHSUL İDARƏETMƏSİ</p><h1 className="mt-1 text-3xl font-semibold">Məhsulu redaktə et</h1><p className="mt-2 text-sm text-slate-500">SKU: {product.sku||"Təyin edilməyib"} · Status: {product.status}</p>
    <form key={String(product.updatedAt ?? product.id)} onSubmit={save} className="mt-5 grid gap-4 sm:grid-cols-2">
      <section className={`${box} grid gap-3 sm:col-span-2 sm:grid-cols-2`}><label className="grid gap-1 text-sm">Məhsul adı<input name="name" required minLength={2} maxLength={160} defaultValue={product.name} className={input}/></label><label className="grid gap-1 text-sm">SKU / Məhsul kodu<input name="sku" maxLength={80} defaultValue={product.sku||""} className={input}/><span className="text-xs leading-5 text-slate-500">Stok və satış izləməsi üçün unikal məhsul kodudur. Variantlı məhsullarda hər variantın ayrıca kodu ola bilər.</span></label><label className="grid gap-1 text-sm">Qiymət (₼)<input name="price" required type="number" min="0.01" step="0.01" defaultValue={Number(product.price)} className={input}/></label><label className="grid gap-1 text-sm">Endirimli qiymət (₼)<input name="discountPrice" type="number" min="0.01" step="0.01" defaultValue={product.discountPrice?Number(product.discountPrice):""} className={input}/></label><label className="grid gap-1 text-sm">Kateqoriya<select name="categoryId" value={product.categoryId||""} onChange={event=>setData((current:any)=>({...current,product:{...current.product,categoryId:event.target.value}}))} className={input}><option value="">Seçilməyib</option>{data.categories.map((category:any)=><option key={category.id} value={category.id}>{category.name}</option>)}</select></label><VendorBrandSelector brands={data.brands} value={product.brandId||""} onChange={brandId=>setData((current:any)=>({...current,product:{...current.product,brandId}}))}/><label className="grid gap-1 text-sm">Status<select name="status" defaultValue={product.status} className={input}><option value="DRAFT">Qaralama</option><option value="ACTIVE">Aktiv</option><option value="ARCHIVED">Arxiv</option></select></label><label className="grid gap-1 text-sm sm:col-span-2">Təsvir<textarea name="description" rows={4} defaultValue={product.description||""} className={input}/></label></section>
      <section className={`${box} sm:col-span-2`}><VendorImageUploader key={product.id} storeId={storeId} initialUrls={product.images||[]}/></section>
      <section className={`${box} grid gap-3 sm:col-span-2 sm:grid-cols-2`}><h2 className="font-semibold sm:col-span-2">Standart məhsul stoku</h2><label className="grid gap-1 text-sm">Miqdar<input name="quantity" type="number" min="0" defaultValue={product.inventory?.find((item:any)=>item.variantId===null)?.quantity??0} className={input}/></label><label className="grid gap-1 text-sm">Az stok həddi<input name="lowStockThreshold" type="number" min="0" defaultValue={product.inventory?.find((item:any)=>item.variantId===null)?.lowStockThreshold??5} className={input}/></label><p className="text-xs text-slate-500 sm:col-span-2">Bu stok yalnız variantlar söndürüldükdə istifadə olunur.</p></section>
      <div className="sm:col-span-2"><VendorVariantEditor key={`${product.id}:${product.updatedAt}`} storeId={storeId} initial={product.variants||[]} categoryName={data.categories.find((category:any)=>category.id===product.categoryId)?.name||""}/></div>
      {error&&<p role="alert" className="sm:col-span-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}{message&&<p role="status" className="sm:col-span-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
      <div className="flex flex-wrap gap-3 sm:col-span-2"><button disabled={busy} className="rounded-xl bg-[#173c40] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy?"Yadda saxlanılır…":"Dəyişiklikləri yadda saxla"}</button>{product.status!=="ARCHIVED"&&<button type="button" disabled={busy} onClick={()=>void archive()} className="rounded-xl border border-red-200 px-5 py-3 text-sm font-medium text-red-700">Məhsulu arxivlə</button>}</div>
    </form>
  </div>;
}
