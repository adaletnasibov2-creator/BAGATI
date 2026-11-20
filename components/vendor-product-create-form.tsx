"use client";

import { CategoryPicker, type PickerCategory } from "@/components/category-picker";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import VendorImageUploader from "@/components/vendor-image-uploader";
import VendorVariantEditor from "@/components/vendor-variant-editor";
import VendorBrandSelector from "@/components/vendor-brand-selector";
import { presentStockQuantity } from "@/lib/stock-quantity";
import { SellerTermsCard } from "@/components/seller-terms-card";
import { VendorFormSection, VendorStickyActions, vendorFieldError, vendorHint, vendorInput, vendorLabel, vendorNotice, vendorOptional, vendorTextarea } from "@/components/vendor-form";
import { buttonClass } from "@/components/ui/button";

type Option = { id: string; name: string };
// Which block an error belongs to, so the message shows next to it (the texts and checks are unchanged).
type ErrorField = "stock" | "variants" | null;

export default function VendorProductCreateForm({ storeId, categories, brands, canSell }: { storeId: string; categories: PickerCategory[]; brands: Option[]; canSell: boolean }) {
  const router = useRouter();
  const [publish, setPublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<ErrorField>(null);
  const [message, setMessage] = useState("");
  const [termsRequired, setTermsRequired] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setErrorField(null); setMessage("");
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
        throw new Error(result.error || "Məhsul yadda saxlanmadı.");
      }
      setMessage(shouldPublish ? "Məhsul yayımlandı." : "Məhsul qaralama kimi saxlanıldı.");
      router.replace(`/vendor/${storeId}/products/${result.product.id}`); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Məhsul yadda saxlanmadı."); }
    finally { setBusy(false); }
  }

  const inlineError = (field: Exclude<ErrorField, null>) => error && errorField === field ? <p role="alert" className={vendorFieldError}>{error}</p> : null;
  return <form onSubmit={submit} className="mt-6 grid gap-5">
    <VendorFormSection eyebrow="Məhsul kartı" title="Ümumi məlumat" bodyClassName="sm:grid-cols-2">
      <label className={`${vendorLabel} sm:col-span-2`}>Məhsul adı<input name="name" required minLength={2} maxLength={160} className={vendorInput}/></label>
      <label className={vendorLabel}><span>Məhsul kodu <span className={vendorOptional}>(istəyə bağlı)</span></span><input name="sku" maxLength={80} className={vendorInput} placeholder="Boş saxlaya bilərsiniz"/><span className={vendorHint}>Bu kod mağazanızdakı məhsulları ayırmağa kömək edir; barkod deyil. Boş qoysanız sistem avtomatik yaradacaq.</span></label>
      <VendorBrandSelector brands={brands} value={brandId} onChange={setBrandId}/>
      <CategoryPicker categories={categories} name appearance="vendor" onChange={(choice) => setCategoryId(choice.categoryId ?? "")} />
      <label className={`${vendorLabel} sm:col-span-2`}>Təsvir<textarea name="description" maxLength={5000} rows={4} className={vendorTextarea}/></label>
      {!categories.length && <p className={`${vendorNotice} sm:col-span-2`}>Aktiv kateqoriya yoxdur. Kateqoriya yaratmaq üçün adminlə əlaqə saxlayın. Məhsulu qaralama kimi saxlaya bilərsiniz.</p>}
    </VendorFormSection>
    <VendorFormSection title="Qiymətləndirmə" bodyClassName="sm:grid-cols-2">
      <label className={vendorLabel}>Qiymət (₼)<input name="price" type="number" required min="0.01" step="0.01" inputMode="decimal" className={vendorInput}/></label>
      <label className={vendorLabel}>Endirimli qiymət (istəyə görə)<input name="discountPrice" type="number" min="0.01" step="0.01" inputMode="decimal" className={vendorInput}/></label>
      <p className={`${vendorHint} sm:col-span-2`}>Endirimli qiymət əsas qiymətdən aşağı olmalıdır. Server bu qaydanı ayrıca yoxlayır.</p>
    </VendorFormSection>
    <VendorFormSection title="Anbar" bodyClassName="sm:grid-cols-2">
      <label className={vendorLabel}>İlkin stok miqdarı<input name="quantity" type="number" min="0" step="1" defaultValue="0" inputMode="numeric" aria-invalid={errorField === "stock" || undefined} className={vendorInput}/></label>
      <label className={vendorLabel}>Az stok xəbərdarlığı həddi<input name="lowStockThreshold" type="number" min="0" step="1" defaultValue="5" inputMode="numeric" aria-invalid={errorField === "stock" || undefined} className={vendorInput}/></label>
      <p className={`${vendorHint} sm:col-span-2`}>Variant əlavə ediləndə stok hər variant üzrə ayrıca idarə olunur.</p>
      {inlineError("stock") && <div className="sm:col-span-2">{inlineError("stock")}</div>}
    </VendorFormSection>
    <VendorFormSection title="Şəkillər" description="Birinci şəkil əsas şəkil kimi göstərilir. Sıralama yükləmə ardıcıllığı ilə müəyyən olunur."><VendorImageUploader storeId={storeId}/></VendorFormSection>
    <VendorVariantEditor storeId={storeId} name="variants" initial={[]} categoryName={categories.find(item => item.id === categoryId)?.name || ""} error={inlineError("variants")}/>
    {!canSell && <p className={vendorNotice}>Mağaza, satıcı hesabı və abunəlik aktiv olana qədər məhsul qaralama kimi saxlanıla bilər, lakin yayımlana bilməz.</p>}
    {termsRequired && <SellerTermsCard compact onAccepted={() => { setTermsRequired(false); setError(""); }}/>}
    <VendorStickyActions status={<>{error && !errorField && <p role="alert" className={vendorFieldError}>{error}</p>}{error && errorField && <p aria-hidden="true" className="text-sm font-medium text-danger">{error}</p>}{message && <p role="status" className="rounded-control bg-primary-subtle px-3 py-2 text-sm font-medium text-primary">{message}</p>}</>}>
      <button type="submit" name="intent" value="draft" disabled={busy} onClick={() => setPublish(false)} className={buttonClass({ variant: "secondary", size: "sm" })}>{busy && !publish ? "Saxlanılır…" : "Qaralama saxla"}</button>
      <button type="submit" name="intent" value="publish" disabled={busy || !canSell || !categories.length} onClick={() => setPublish(true)} className={buttonClass({ size: "sm" })}>{busy && publish ? "Yayımlanır…" : "Yayımla"}</button>
    </VendorStickyActions>
  </form>;
}
