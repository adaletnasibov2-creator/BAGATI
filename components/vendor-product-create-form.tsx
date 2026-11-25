"use client";

import { CategoryPicker, type PickerCategory } from "@/components/category-picker";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import VendorImageUploader from "@/components/vendor-image-uploader";
import VendorVariantEditor from "@/components/vendor-variant-editor";
import VendorBrandSelector from "@/components/vendor-brand-selector";
import { presentStockQuantity } from "@/lib/stock-quantity";
import { SellerTermsCard } from "@/components/seller-terms-card";
import { VendorFormSection, VendorStickyActions, vendorFieldError, vendorHint, vendorInput, vendorLabel, vendorNotice, vendorOptional, vendorTextarea } from "@/components/vendor-form";
import { buttonClass } from "@/components/ui/button";
import { VendorPublishChecklist } from "@/components/vendor-publish-checklist";
import { VendorPlanMeter } from "@/components/vendor-plan-meter";
import { useUnsavedGuard } from "@/components/use-unsaved-guard";
import { duplicatePrefill, fieldForServerError, publishChecklist, readProductForm, SELLER_PANEL_3_TEXT, type DuplicateDraft, type ErrorFieldKey } from "@/lib/seller-panel-3";

type Option = { id: string; name: string };
// Which block an error belongs to, so the message shows next to it (the texts and checks are unchanged).
type ErrorField = ErrorFieldKey | null;

/**
 * SELLER-PANEL-3: photos first; a live "what is missing to publish" list (the server's own rules and messages); errors
 * under the field they belong to; the plan meter; a leave-page guard; and "Surətini yarat" prefill (`copyFrom`).
 * Payload, route, checks and messages are the same as before.
 */
export default function VendorProductCreateForm({ storeId, categories, brands, canSell, copyFrom }: { storeId: string; categories: PickerCategory[]; brands: Option[]; canSell: boolean; copyFrom?: string | null }) {
  const [prefill, setPrefill] = useState<DuplicateDraft | null>(null);
  const [prefillReady, setPrefillReady] = useState(!copyFrom);
  useEffect(() => {
    if (!copyFrom) return;
    let alive = true;
    void fetch(`/api/vendor/${encodeURIComponent(storeId)}/products/${encodeURIComponent(copyFrom)}`).then(async (response) => {
      if (!response.ok) return;
      const result = await response.json();
      if (alive && result?.product) setPrefill(duplicatePrefill(result.product));
    }).catch(() => undefined).finally(() => { if (alive) setPrefillReady(true); });
    return () => { alive = false; };
  }, [copyFrom, storeId]);
  if (!prefillReady) return <div className="mt-6 rounded-card border border-line bg-white p-5 text-sm text-fg-secondary">Məhsul məlumatları yüklənir…</div>;
  return <CreateForm key={prefill ? "copy" : "new"} storeId={storeId} categories={categories} brands={brands} canSell={canSell} prefill={prefill}/>;
}

function CreateForm({ storeId, categories, brands, canSell, prefill }: { storeId: string; categories: PickerCategory[]; brands: Option[]; canSell: boolean; prefill: DuplicateDraft | null }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [publish, setPublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<ErrorField>(null);
  const [message, setMessage] = useState("");
  const [termsRequired, setTermsRequired] = useState(false);
  const [categoryId, setCategoryId] = useState(prefill?.categoryId ?? "");
  const [brandId, setBrandId] = useState(prefill?.brandId ?? "");
  const [blockers, setBlockers] = useState<string[]>([]);
  const [serverBlockers, setServerBlockers] = useState<string[]>([]);
  const [dirty, setDirty] = useState(Boolean(prefill));
  useUnsavedGuard(dirty);

  // Re-read the form after React has applied the change (the variant editor writes a hidden JSON input).
  const recompute = useCallback(() => {
    window.setTimeout(() => {
      if (!formRef.current) return;
      setBlockers(publishChecklist(readProductForm(new FormData(formRef.current), { categoryActive: (id) => categories.find((item) => item.id === id)?.isActive !== false })));
    }, 0);
  }, [categories]);
  useEffect(() => { recompute(); }, [recompute, categoryId]);
  const onEdit = () => { setDirty(true); setServerBlockers([]); recompute(); };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setErrorField(null); setMessage(""); setServerBlockers([]);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const form = new FormData(event.currentTarget);
    const shouldPublish = submitter?.value === "publish";
    let variants: unknown[];
    try { variants = JSON.parse(String(form.get("variants") || "[]")); }
    catch { setError("Variant məlumatlarının formatı yanlışdır."); setErrorField("variants"); setBusy(false); return; }
    const variantsEnabled = form.get("variantsEnabled") === "true";
    if (variantsEnabled && !variants.length) { setError("Əvvəlcə xüsusiyyətləri və variant kombinasiyalarını yaradın."); setErrorField("variants"); setBusy(false); return; }
    if (variantsEnabled && variants.some((variant) => presentStockQuantity((variant as { quantity?: unknown }).quantity) === null)) { setError("Hər variantın stoku tam ədəd olmalıdır. Boş sahə 0 kimi saxlanmır."); setErrorField("variants"); setBusy(false); return; }
    const quantity = presentStockQuantity(form.get("quantity"));
    const lowStockThreshold = presentStockQuantity(form.get("lowStockThreshold"));
    if (quantity === null || lowStockThreshold === null) { setError("İlkin stok və az stok həddi tam ədəd olmalıdır. Boş sahə 0 kimi saxlanmır; sıfır yazıla bilər."); setErrorField("stock"); setBusy(false); return; }
    const payload = {
      name: form.get("name"), sku: form.get("sku") || null, description: form.get("description") || null,
      categoryId: form.get("categoryId") || null, categoryParentId: form.get("categoryParentId") || null, brandId: form.get("brandId") || null,
      price: Number(form.get("price")), discountPrice: form.get("discountPrice") ? Number(form.get("discountPrice")) : null,
      quantity, lowStockThreshold,
      images: String(form.get("images") || "").split(/\n|,/).map(value => value.trim()).filter(Boolean),
      status: shouldPublish ? "ACTIVE" : "DRAFT",
      variantsEnabled,
      variants,
    };
    try {
      const response = await fetch(`/api/vendor/${storeId}/products`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) {
        if (result.code === "SELLER_TERMS_REQUIRED") setTermsRequired(true);
        if (Array.isArray(result.blockers)) setServerBlockers(result.blockers.filter((item: unknown): item is string => typeof item === "string"));
        const text = result.error || "Məhsul yadda saxlanmadı.";
        setErrorField(fieldForServerError(text));
        throw new Error(text);
      }
      setDirty(false);
      setMessage(shouldPublish ? "Məhsul yayımlandı." : "Məhsul qaralama kimi saxlanıldı.");
      router.replace(`/vendor/${storeId}/products/${result.product.id}`); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Məhsul yadda saxlanmadı."); }
    finally { setBusy(false); }
  }

  const inlineError = (field: ErrorFieldKey) => error && errorField === field ? <p role="alert" className={vendorFieldError}>{error}</p> : null;
  return <form ref={formRef} onSubmit={submit} onInput={onEdit} onChange={onEdit} onClick={recompute} className="mt-6 grid gap-5">
    <VendorPlanMeter storeId={storeId}/>
    {prefill && <p role="status" className={vendorNotice}>{SELLER_PANEL_3_TEXT.duplicateNotice(prefill.sourceName)}</p>}
    <VendorFormSection title="Şəkillər" description="Birinci şəkil əsas şəkil kimi göstərilir. Sıralama yükləmə ardıcıllığı ilə müəyyən olunur."><VendorImageUploader storeId={storeId} initialUrls={prefill?.images ?? []} coverAction onChange={() => onEdit()}/></VendorFormSection>
    <VendorFormSection eyebrow="Məhsul kartı" title="Ümumi məlumat" bodyClassName="sm:grid-cols-2">
      <label className={`${vendorLabel} sm:col-span-2`}>Məhsul adı<input name="name" required minLength={2} maxLength={160} defaultValue={prefill?.name ?? ""} aria-invalid={errorField === "name" || undefined} className={vendorInput}/>{inlineError("name")}</label>
      <label className={vendorLabel}><span>Məhsul kodu <span className={vendorOptional}>(istəyə bağlı)</span></span><input name="sku" maxLength={80} aria-invalid={errorField === "sku" || undefined} className={vendorInput} placeholder="Boş saxlaya bilərsiniz"/><span className={vendorHint}>Bu kod mağazanızdakı məhsulları ayırmağa kömək edir; barkod deyil. Boş qoysanız sistem avtomatik yaradacaq.</span>{inlineError("sku")}</label>
      <div className="grid min-w-0 content-start gap-1.5"><VendorBrandSelector brands={brands} value={brandId} onChange={(value) => { setBrandId(value); onEdit(); }}/>{inlineError("brand")}</div>
      <div className="grid min-w-0 content-start gap-1.5 sm:col-span-2"><CategoryPicker categories={categories} initialId={prefill?.categoryId ?? null} name appearance="vendor" onChange={(choice) => { setCategoryId(choice.categoryId ?? ""); onEdit(); }} />{inlineError("category")}</div>
      <label className={`${vendorLabel} sm:col-span-2`}>Təsvir<textarea name="description" maxLength={5000} rows={4} defaultValue={prefill?.description ?? ""} className={vendorTextarea}/></label>
      {!categories.length && <p className={`${vendorNotice} sm:col-span-2`}>Aktiv kateqoriya yoxdur. Kateqoriya yaratmaq üçün adminlə əlaqə saxlayın. Məhsulu qaralama kimi saxlaya bilərsiniz.</p>}
    </VendorFormSection>
    <VendorFormSection title="Qiymətləndirmə" bodyClassName="sm:grid-cols-2">
      <label className={vendorLabel}>Qiymət (₼)<input name="price" type="number" required min="0.01" step="0.01" inputMode="decimal" defaultValue={prefill?.price ?? ""} aria-invalid={errorField === "price" || undefined} className={vendorInput}/></label>
      <label className={vendorLabel}>Endirimli qiymət (istəyə görə)<input name="discountPrice" type="number" min="0.01" step="0.01" inputMode="decimal" defaultValue={prefill?.discountPrice ?? ""} aria-invalid={errorField === "price" || undefined} className={vendorInput}/></label>
      <p className={`${vendorHint} sm:col-span-2`}>Endirimli qiymət əsas qiymətdən aşağı olmalıdır.</p>
      {inlineError("price") && <div className="sm:col-span-2">{inlineError("price")}</div>}
    </VendorFormSection>
    <VendorFormSection title="Anbar" bodyClassName="sm:grid-cols-2">
      <label className={vendorLabel}>İlkin stok miqdarı<input name="quantity" type="number" min="0" step="1" defaultValue="0" inputMode="numeric" aria-invalid={errorField === "stock" || undefined} className={vendorInput}/></label>
      <label className={vendorLabel}>Az stok xəbərdarlığı həddi<input name="lowStockThreshold" type="number" min="0" step="1" defaultValue="5" inputMode="numeric" aria-invalid={errorField === "stock" || undefined} className={vendorInput}/></label>
      <p className={`${vendorHint} sm:col-span-2`}>Variant əlavə ediləndə stok hər variant üzrə ayrıca idarə olunur.</p>
      {inlineError("stock") && <div className="sm:col-span-2">{inlineError("stock")}</div>}
    </VendorFormSection>
    <VendorVariantEditor storeId={storeId} name="variants" initial={prefill?.variants ?? []} categoryName={categories.find(item => item.id === categoryId)?.name || ""} error={inlineError("variants")}/>
    {!canSell && <p className={vendorNotice}>Mağaza, satıcı hesabı və abunəlik aktiv olana qədər məhsul qaralama kimi saxlanıla bilər, lakin yayımlana bilməz.</p>}
    {termsRequired && <SellerTermsCard compact onAccepted={() => { setTermsRequired(false); setError(""); }}/>}
    <VendorPublishChecklist blockers={blockers} serverBlockers={serverBlockers}/>
    <VendorStickyActions status={<>{error && !errorField && <p role="alert" className={vendorFieldError}>{error}</p>}{error && errorField && <p aria-hidden="true" className="text-sm font-medium text-danger">{error}</p>}{message && <p role="status" className="rounded-control bg-primary-subtle px-3 py-2 text-sm font-medium text-primary">{message}</p>}{dirty && !error && !message && <p data-vendor-unsaved="" className="text-sm font-medium text-gold-700">{SELLER_PANEL_3_TEXT.unsaved}</p>}</>}>
      <button type="submit" name="intent" value="draft" disabled={busy} onClick={() => setPublish(false)} className={buttonClass({ variant: "secondary", size: "sm" })}>{busy && !publish ? "Saxlanılır…" : "Qaralama saxla"}</button>
      <button type="submit" name="intent" value="publish" disabled={busy || !canSell || !categories.length} onClick={() => setPublish(true)} className={buttonClass({ size: "sm" })}>{busy && publish ? "Yayımlanır…" : "Yayımla"}</button>
    </VendorStickyActions>
  </form>;
}
