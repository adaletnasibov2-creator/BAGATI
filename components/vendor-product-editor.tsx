"use client";

import { CategoryPicker } from "@/components/category-picker";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import VendorImageUploader from "@/components/vendor-image-uploader";
import VendorVariantEditor from "@/components/vendor-variant-editor";
import VendorBrandSelector from "@/components/vendor-brand-selector";
import { presentStockQuantity } from "@/lib/stock-quantity";
import { SellerTermsCard } from "@/components/seller-terms-card";
import { VendorPageHeader } from "@/components/vendor-page-header";
import { Badge } from "@/components/ui/badge";
import { productStatusTone } from "@/lib/vendor-status-tone";
import { VendorFormSection, VendorStickyActions, vendorFieldError, vendorHint, vendorInput, vendorLabel, vendorTextarea } from "@/components/vendor-form";
import { buttonClass } from "@/components/ui/button";

const productStatusLabels: Record<string, string> = { DRAFT: "Qaralama", ACTIVE: "Aktiv", ARCHIVED: "Arxivdə" };
const box = "rounded-card border border-line bg-white p-5 text-sm text-fg-secondary";
// Which block an error belongs to, so the message shows next to it (the texts and checks are unchanged).
type ErrorField = "stock" | "variants" | null;

export default function VendorProductEditor({ storeId, productId }: { storeId: string; productId: string }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<ErrorField>(null);
  const [message, setMessage] = useState("");
  const [termsRequired, setTermsRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const url = `/api/vendor/${storeId}/products/${productId}`;
  useEffect(() => { void fetch(url).then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || "Məhsul tapılmadı"); setData(result); }).catch(reason => setError(reason instanceof Error ? reason.message : "Məhsul yüklənmədi")); }, [url]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setErrorField(null); setMessage("");
    const form = Object.fromEntries(new FormData(event.currentTarget).entries());
    let variants:any[]=[];try{variants=JSON.parse(String(form.variants||"[]"))}catch{setError("Variant məlumatlarının formatı yanlışdır.");setErrorField("variants");setBusy(false);return}const variantsEnabled=String(form.variantsEnabled)==="true";if(variantsEnabled&&!variants.length){setError("Əvvəlcə xüsusiyyətləri və variant kombinasiyalarını yaradın.");setErrorField("variants");setBusy(false);return}
    const quantity = presentStockQuantity(form.quantity);
    const lowStockThreshold = presentStockQuantity(form.lowStockThreshold);
    if (!variantsEnabled && quantity === null) { setError("Stok miqdarı boş qala bilməz. Sıfır yazmaq olar, boş sahə isə mövcud stoku silmir."); setErrorField("stock"); setBusy(false); return; }
    if (!variantsEnabled && lowStockThreshold === null) { setError("Az stok həddi tam ədəd olmalıdır."); setErrorField("stock"); setBusy(false); return; }
    if (variants.some((variant) => presentStockQuantity(variant.quantity) === null || presentStockQuantity(variant.lowStockThreshold) === null)) { setError("Hər variantın stoku və az stok həddi tam ədəd olmalıdır. Boş sahə 0 kimi saxlanmır."); setErrorField("variants"); setBusy(false); return; }
    const payload = { ...form, sku: String(form.sku || "").trim() || null, price: Number(form.price), discountPrice: form.discountPrice ? Number(form.discountPrice) : null, categoryId: form.categoryId || null, brandId: form.brandId || null, images: String(form.images || "").split(/\n|,/).map(value => value.trim()).filter(Boolean), variantsEnabled, variants, ...(quantity !== null ? { quantity } : {}), ...(lowStockThreshold !== null ? { lowStockThreshold } : {}) };
    try { const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); const result = await response.json(); if (!response.ok && result.code === "SELLER_TERMS_REQUIRED") setTermsRequired(true); if (!response.ok) throw new Error(result.error === "Məhsul yenilənə bilmədi" ? "Bu məhsulu yeniləmək mümkün olmadı. Məlumatları yoxlayın." : result.error || "Məhsul yenilənmədi"); setData((current:any)=>({...current,product:result.product})); setMessage("Məhsul məlumatları yadda saxlanıldı."); }
    catch(reason) { setError(reason instanceof Error ? reason.message : "Məhsul yenilənmədi"); }
    finally { setBusy(false); }
  }

  async function archive() {
    if (!window.confirm("Məhsul arxivlənsin? Müştərilər onu artıq mağazada görməyəcək.")) return;
    setBusy(true); setError(""); setErrorField(null);
    try { const response = await fetch(url, { method: "DELETE" }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "Məhsul arxivlənmədi"); setMessage("Məhsul arxivləndi."); setData((current:any)=>({...current,product:{...current.product,status:"ARCHIVED"}})); }
    catch(reason) { setError(reason instanceof Error ? reason.message : "Məhsul arxivlənmədi"); }
    finally { setBusy(false); }
  }

  if (error&&!data) return <div role="alert" className={box}>{error}</div>;
  if (!data) return <div className={box}>Məhsul məlumatları yüklənir…</div>;
  const product=data.product;
  const inlineError = (field: Exclude<ErrorField, null>) => error && errorField === field ? <p role="alert" className={vendorFieldError}>{error}</p> : null;
  return <div><VendorPageHeader back={<Link href={`/vendor/${storeId}/products`} className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:text-primary-hover">← Məhsullara qayıt</Link>} eyebrow="MƏHSUL İDARƏETMƏSİ" title="Məhsulu redaktə et" description={<>Məhsul kodu: {product.sku||"Sistem özü yaradacaq"}</>} action={<Badge tone={productStatusTone(product.status)} size="md">Status: {productStatusLabels[product.status] ?? product.status}</Badge>}/>
    <form key={String(product.updatedAt ?? product.id)} onSubmit={save} className="mt-6 grid gap-5">
      <VendorFormSection eyebrow="Məhsul kartı" title="Ümumi məlumat" bodyClassName="sm:grid-cols-2">
        <label className={`${vendorLabel} sm:col-span-2`}>Məhsul adı<input name="name" required minLength={2} maxLength={160} defaultValue={product.name} className={vendorInput}/></label>
        <label className={vendorLabel}>Məhsul kodu (istəyə bağlı)<input name="sku" maxLength={80} defaultValue={product.sku||""} className={vendorInput}/><span className={vendorHint}>Stok və satış izləməsi üçün unikal məhsul kodudur. Variantlı məhsullarda hər variantın ayrıca kodu ola bilər.</span></label>
        <label className={vendorLabel}>Status<select name="status" defaultValue={product.status} className={vendorInput}><option value="DRAFT">Qaralama</option><option value="ACTIVE">Aktiv</option><option value="ARCHIVED">Arxiv</option></select></label>
        <VendorBrandSelector brands={data.brands} value={product.brandId||""} onChange={brandId=>setData((current:any)=>({...current,product:{...current.product,brandId}}))}/>
        <CategoryPicker categories={data.categories} initialId={data.product.categoryId||null} name appearance="vendor" onChange={(choice)=>setData((current:any)=>({...current,product:{...current.product,categoryId:choice.categoryId}}))}/>
        <label className={`${vendorLabel} sm:col-span-2`}>Təsvir<textarea name="description" rows={4} defaultValue={product.description||""} className={vendorTextarea}/></label>
      </VendorFormSection>
      <VendorFormSection title="Qiymətləndirmə" bodyClassName="sm:grid-cols-2">
        <label className={vendorLabel}>Qiymət (₼)<input name="price" required type="number" min="0.01" step="0.01" inputMode="decimal" defaultValue={Number(product.price)} className={vendorInput}/></label>
        <label className={vendorLabel}>Endirimli qiymət (₼)<input name="discountPrice" type="number" min="0.01" step="0.01" inputMode="decimal" defaultValue={product.discountPrice?Number(product.discountPrice):""} className={vendorInput}/></label>
      </VendorFormSection>
      <VendorFormSection title="Anbar" eyebrow="Standart məhsul stoku" bodyClassName="sm:grid-cols-2">
        <label className={vendorLabel}>Miqdar<input name="quantity" type="number" min="0" inputMode="numeric" aria-invalid={errorField==="stock"||undefined} defaultValue={product.inventory?.find((item:any)=>item.variantId===null)?.quantity??0} className={vendorInput}/></label>
        <label className={vendorLabel}>Az stok həddi<input name="lowStockThreshold" type="number" min="0" inputMode="numeric" aria-invalid={errorField==="stock"||undefined} defaultValue={product.inventory?.find((item:any)=>item.variantId===null)?.lowStockThreshold??5} className={vendorInput}/></label>
        <p className={`${vendorHint} sm:col-span-2`}>Bu stok yalnız variantlar söndürüldükdə istifadə olunur.</p>
        {inlineError("stock") && <div className="sm:col-span-2">{inlineError("stock")}</div>}
      </VendorFormSection>
      <VendorFormSection title="Şəkillər"><VendorImageUploader key={product.id} storeId={storeId} initialUrls={product.images||[]}/></VendorFormSection>
      <VendorVariantEditor key={`${product.id}:${product.updatedAt}`} storeId={storeId} initial={product.variants||[]} categoryName={data.categories.find((category:any)=>category.id===product.categoryId)?.name||""} error={inlineError("variants")}/>
      {termsRequired&&<SellerTermsCard compact onAccepted={()=>{setTermsRequired(false);setError("")}}/>}
      <VendorStickyActions status={<>{error&&!errorField&&<p role="alert" className={vendorFieldError}>{error}</p>}{error&&errorField&&<p aria-hidden="true" className="text-sm font-medium text-danger">{error}</p>}{message&&<p role="status" className="rounded-control bg-primary-subtle px-3 py-2 text-sm font-medium text-primary">{message}</p>}</>}>
        {product.status!=="ARCHIVED"&&<button type="button" disabled={busy} onClick={()=>void archive()} className={`${buttonClass({ variant: "ghost", size: "sm" })} text-danger hover:bg-danger-subtle`}>Məhsulu arxivlə</button>}
        <button disabled={busy} className={buttonClass({ size: "sm" })}>{busy?"Yadda saxlanılır…":"Dəyişiklikləri yadda saxla"}</button>
      </VendorStickyActions>
    </form>
  </div>;
}
