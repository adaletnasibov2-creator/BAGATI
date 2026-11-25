"use client";

import { CategoryPicker } from "@/components/category-picker";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import VendorImageUploader from "@/components/vendor-image-uploader";
import VendorVariantEditor from "@/components/vendor-variant-editor";
import VendorBrandSelector from "@/components/vendor-brand-selector";
import { presentStockQuantity } from "@/lib/stock-quantity";
import { SellerTermsCard } from "@/components/seller-terms-card";
import { VendorPageHeader } from "@/components/vendor-page-header";
import { Badge } from "@/components/ui/badge";
import { productStatusTone } from "@/lib/vendor-status-tone";
import { VendorFormSection, VendorStickyActions, vendorFieldError, vendorHint, vendorInput, vendorLabel, vendorTextarea } from "@/components/vendor-form";
import { buttonClass, ButtonLink } from "@/components/ui/button";
import { VendorPublishChecklist } from "@/components/vendor-publish-checklist";
import { VendorPlanMeter } from "@/components/vendor-plan-meter";
import { useUnsavedGuard } from "@/components/use-unsaved-guard";
import { fieldForServerError, publishChecklist, readProductForm, SELLER_PANEL_3_TEXT, type ErrorFieldKey } from "@/lib/seller-panel-3";

const productStatusLabels: Record<string, string> = { DRAFT: "Qaralama", ACTIVE: "Aktiv", ARCHIVED: "Arxivdə" };
const box = "rounded-card border border-line bg-white p-5 text-sm text-fg-secondary";
// Which block an error belongs to, so the message shows next to it (the texts and checks are unchanged).
type ErrorField = ErrorFieldKey | null;

/**
 * SELLER-PANEL-3: same fields, payload, route and messages as before; photos first, the live "what is missing to
 * publish" list (server rules and messages), errors under their field, the plan meter, a leave-page guard and
 * "Surətini yarat" (opens the add form pre-filled; nothing is saved until the seller saves it).
 */
export default function VendorProductEditor({ storeId, productId }: { storeId: string; productId: string }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<ErrorField>(null);
  const [message, setMessage] = useState("");
  const [termsRequired, setTermsRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blockers, setBlockers] = useState<string[]>([]);
  const [serverBlockers, setServerBlockers] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useUnsavedGuard(dirty);
  const url = `/api/vendor/${storeId}/products/${productId}`;
  useEffect(() => { void fetch(url).then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || "Məhsul tapılmadı"); setData(result); }).catch(reason => setError(reason instanceof Error ? reason.message : "Məhsul yüklənmədi")); }, [url]);

  const reserved = (data?.product?.inventory ?? []).find((item: any) => item.variantId === null)?.reserved ?? 0;
  const recompute = useCallback(() => {
    window.setTimeout(() => {
      if (!formRef.current || !data) return;
      setBlockers(publishChecklist(readProductForm(new FormData(formRef.current), { categoryActive: (id) => data.categories.find((category: any) => category.id === id)?.isActive !== false, reserved })));
    }, 0);
  }, [data, reserved]);
  useEffect(() => { recompute(); }, [recompute]);
  const onEdit = () => { setDirty(true); setServerBlockers([]); recompute(); };

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setErrorField(null); setMessage(""); setServerBlockers([]);
    const form = Object.fromEntries(new FormData(event.currentTarget).entries());
    let variants:any[]=[];try{variants=JSON.parse(String(form.variants||"[]"))}catch{setError("Variant məlumatlarının formatı yanlışdır.");setErrorField("variants");setBusy(false);return}const variantsEnabled=String(form.variantsEnabled)==="true";if(variantsEnabled&&!variants.length){setError("Əvvəlcə xüsusiyyətləri və variant kombinasiyalarını yaradın.");setErrorField("variants");setBusy(false);return}
    const quantity = presentStockQuantity(form.quantity);
    const lowStockThreshold = presentStockQuantity(form.lowStockThreshold);
    if (!variantsEnabled && quantity === null) { setError("Stok miqdarı boş qala bilməz. Sıfır yazmaq olar, boş sahə isə mövcud stoku silmir."); setErrorField("stock"); setBusy(false); return; }
    if (!variantsEnabled && lowStockThreshold === null) { setError("Az stok həddi tam ədəd olmalıdır."); setErrorField("stock"); setBusy(false); return; }
    if (variants.some((variant) => presentStockQuantity(variant.quantity) === null || presentStockQuantity(variant.lowStockThreshold) === null)) { setError("Hər variantın stoku və az stok həddi tam ədəd olmalıdır. Boş sahə 0 kimi saxlanmır."); setErrorField("variants"); setBusy(false); return; }
    const payload = { ...form, sku: String(form.sku || "").trim() || null, price: Number(form.price), discountPrice: form.discountPrice ? Number(form.discountPrice) : null, categoryId: form.categoryId || null, brandId: form.brandId || null, images: String(form.images || "").split(/\n|,/).map(value => value.trim()).filter(Boolean), variantsEnabled, variants, ...(quantity !== null ? { quantity } : {}), ...(lowStockThreshold !== null ? { lowStockThreshold } : {}) };
    try { const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); const result = await response.json(); if (!response.ok && result.code === "SELLER_TERMS_REQUIRED") setTermsRequired(true); if (!response.ok && Array.isArray(result.blockers)) setServerBlockers(result.blockers.filter((item: unknown): item is string => typeof item === "string")); if (!response.ok) { const text = result.error === "Məhsul yenilənə bilmədi" ? "Bu məhsulu yeniləmək mümkün olmadı. Məlumatları yoxlayın." : result.error || "Məhsul yenilənmədi"; setErrorField(fieldForServerError(text)); throw new Error(text); } setData((current:any)=>({...current,product:result.product})); setDirty(false); setMessage("Məhsul məlumatları yadda saxlanıldı."); }
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
  const inlineError = (field: ErrorFieldKey) => error && errorField === field ? <p role="alert" className={vendorFieldError}>{error}</p> : null;
  return <div><VendorPageHeader back={<Link href={`/vendor/${storeId}/products`} className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:text-primary-hover">← Məhsullara qayıt</Link>} eyebrow="MƏHSUL İDARƏETMƏSİ" title="Məhsulu redaktə et" description={<>Məhsul kodu: {product.sku||"Sistem özü yaradacaq"}</>} action={<><Badge tone={productStatusTone(product.status)} size="md">Status: {productStatusLabels[product.status] ?? product.status}</Badge><ButtonLink href={`/vendor/${storeId}/products/new?copy=${encodeURIComponent(product.id)}`} variant="secondary" size="sm">{SELLER_PANEL_3_TEXT.duplicate}</ButtonLink></>}/>
    <form ref={formRef} key={String(product.updatedAt ?? product.id)} onSubmit={save} onInput={onEdit} onChange={onEdit} onClick={recompute} className="mt-6 grid gap-5">
      <VendorPlanMeter storeId={storeId}/>
      <VendorFormSection title="Şəkillər"><VendorImageUploader key={product.id} storeId={storeId} initialUrls={product.images||[]} coverAction onChange={() => onEdit()}/></VendorFormSection>
      <VendorFormSection eyebrow="Məhsul kartı" title="Ümumi məlumat" bodyClassName="sm:grid-cols-2">
        <label className={`${vendorLabel} sm:col-span-2`}>Məhsul adı<input name="name" required minLength={2} maxLength={160} defaultValue={product.name} aria-invalid={errorField==="name"||undefined} className={vendorInput}/>{inlineError("name")}</label>
        <label className={vendorLabel}>Məhsul kodu (istəyə bağlı)<input name="sku" maxLength={80} defaultValue={product.sku||""} aria-invalid={errorField==="sku"||undefined} className={vendorInput}/><span className={vendorHint}>Stok və satış izləməsi üçün unikal məhsul kodudur. Variantlı məhsullarda hər variantın ayrıca kodu ola bilər.</span>{inlineError("sku")}</label>
        <label className={vendorLabel}>Status<select name="status" defaultValue={product.status} className={vendorInput}><option value="DRAFT">Qaralama</option><option value="ACTIVE">Aktiv</option><option value="ARCHIVED">Arxiv</option></select></label>
        <div className="grid min-w-0 content-start gap-1.5"><VendorBrandSelector brands={data.brands} value={product.brandId||""} onChange={brandId=>{setData((current:any)=>({...current,product:{...current.product,brandId}}));onEdit()}}/>{inlineError("brand")}</div>
        <div className="grid min-w-0 content-start gap-1.5 sm:col-span-2"><CategoryPicker categories={data.categories} initialId={data.product.categoryId||null} name appearance="vendor" onChange={(choice)=>{setData((current:any)=>({...current,product:{...current.product,categoryId:choice.categoryId}}));onEdit()}}/>{inlineError("category")}</div>
        <label className={`${vendorLabel} sm:col-span-2`}>Təsvir<textarea name="description" rows={4} defaultValue={product.description||""} className={vendorTextarea}/></label>
      </VendorFormSection>
      <VendorFormSection title="Qiymətləndirmə" bodyClassName="sm:grid-cols-2">
        <label className={vendorLabel}>Qiymət (₼)<input name="price" required type="number" min="0.01" step="0.01" inputMode="decimal" defaultValue={Number(product.price)} aria-invalid={errorField==="price"||undefined} className={vendorInput}/></label>
        <label className={vendorLabel}>Endirimli qiymət (₼)<input name="discountPrice" type="number" min="0.01" step="0.01" inputMode="decimal" defaultValue={product.discountPrice?Number(product.discountPrice):""} aria-invalid={errorField==="price"||undefined} className={vendorInput}/></label>
        {inlineError("price") && <div className="sm:col-span-2">{inlineError("price")}</div>}
      </VendorFormSection>
      <VendorFormSection title="Anbar" eyebrow="Standart məhsul stoku" bodyClassName="sm:grid-cols-2">
        <label className={vendorLabel}>Miqdar<input name="quantity" type="number" min="0" inputMode="numeric" aria-invalid={errorField==="stock"||undefined} defaultValue={product.inventory?.find((item:any)=>item.variantId===null)?.quantity??0} className={vendorInput}/></label>
        <label className={vendorLabel}>Az stok həddi<input name="lowStockThreshold" type="number" min="0" inputMode="numeric" aria-invalid={errorField==="stock"||undefined} defaultValue={product.inventory?.find((item:any)=>item.variantId===null)?.lowStockThreshold??5} className={vendorInput}/></label>
        <p className={`${vendorHint} sm:col-span-2`}>Bu stok yalnız variantlar söndürüldükdə istifadə olunur.</p>
        {inlineError("stock") && <div className="sm:col-span-2">{inlineError("stock")}</div>}
      </VendorFormSection>
      <VendorVariantEditor key={`${product.id}:${product.updatedAt}`} storeId={storeId} initial={product.variants||[]} categoryName={data.categories.find((category:any)=>category.id===product.categoryId)?.name||""} error={inlineError("variants")}/>
      {termsRequired&&<SellerTermsCard compact onAccepted={()=>{setTermsRequired(false);setError("")}}/>}
      <VendorPublishChecklist blockers={blockers} serverBlockers={serverBlockers}/>
      <VendorStickyActions status={<>{error&&!errorField&&<p role="alert" className={vendorFieldError}>{error}</p>}{error&&errorField&&<p aria-hidden="true" className="text-sm font-medium text-danger">{error}</p>}{message&&<p role="status" className="rounded-control bg-primary-subtle px-3 py-2 text-sm font-medium text-primary">{message}</p>}{dirty&&!error&&!message&&<p data-vendor-unsaved="" className="text-sm font-medium text-gold-700">{SELLER_PANEL_3_TEXT.unsaved}</p>}</>}>
        {product.status!=="ARCHIVED"&&<button type="button" disabled={busy} onClick={()=>void archive()} className={`${buttonClass({ variant: "ghost", size: "sm" })} text-danger hover:bg-danger-subtle`}>Məhsulu arxivlə</button>}
        <button disabled={busy} className={buttonClass({ size: "sm" })}>{busy?"Yadda saxlanılır…":"Dəyişiklikləri yadda saxla"}</button>
      </VendorStickyActions>
    </form>
  </div>;
}
