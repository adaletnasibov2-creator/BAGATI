"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import VendorImageUploader from "@/components/vendor-image-uploader";
import VendorVariantEditor from "@/components/vendor-variant-editor";
import VendorBrandSelector from "@/components/vendor-brand-selector";
import { presentStockQuantity } from "@/lib/stock-quantity";

type Option = { id: string; name: string };
const input = "mt-1 w-full rounded-xl border border-[#ded9cf] bg-white px-3 py-2.5 text-sm";

export default function VendorProductCreateForm({ storeId, categories, brands, canSell }: { storeId: string; categories: Option[]; brands: Option[]; canSell: boolean }) {
  const router = useRouter();
  const [publish, setPublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const form = new FormData(event.currentTarget);
    const shouldPublish = submitter?.value === "publish";
    let variants: unknown[];
    try { variants = JSON.parse(String(form.get("variants") || "[]")); }
    catch { setError("Variant məlumatlarının formatı yanlışdır."); setBusy(false); return; }
    const variantsEnabled = form.get("variantsEnabled") === "true";
    if (variantsEnabled && !variants.length) { setError("Əvvəlcə xüsusiyyətləri və variant kombinasiyalarını yaradın."); setBusy(false); return; }
    if (variantsEnabled && variants.some((variant) => presentStockQuantity((variant as { quantity?: unknown }).quantity) === null)) { setError("Hər variantın stoku tam ədəd olmalıdır. Boş sahə 0 kimi saxlanmır."); setBusy(false); return; }
    const quantity = presentStockQuantity(form.get("quantity"));
    const lowStockThreshold = presentStockQuantity(form.get("lowStockThreshold"));
    if (quantity === null || lowStockThreshold === null) { setError("İlkin stok və az stok həddi tam ədəd olmalıdır. Boş sahə 0 kimi saxlanmır; sıfır yazıla bilər."); setBusy(false); return; }
    const payload = {
      name: form.get("name"), sku: form.get("sku") || null, description: form.get("description") || null,
      categoryId: form.get("categoryId") || null, brandId: form.get("brandId") || null,
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
      if (!response.ok) throw new Error(result.error || "Məhsul yadda saxlanmadı.");
      setMessage(shouldPublish ? "Məhsul yayımlandı." : "Məhsul qaralama kimi saxlanıldı.");
      router.replace(`/vendor/${storeId}/products/${result.product.id}`); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Məhsul yadda saxlanmadı."); }
    finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="mt-5 grid gap-5">
    <section className="grid gap-4 rounded-2xl border border-[#e9e4da] bg-white p-5 sm:grid-cols-2 sm:p-7"><div className="sm:col-span-2"><p className="text-xs font-semibold uppercase tracking-[.16em] text-[#967844]">Məhsul kartı</p><h2 className="mt-1 text-lg font-semibold">Ümumi məlumat</h2></div>
      <label className="grid gap-1 text-sm sm:col-span-2">Məhsul adı<input name="name" required minLength={2} maxLength={160} className={input}/></label>
      <label className="grid gap-1 text-sm">SKU / Məhsul kodu<input name="sku" maxLength={80} className={input}/><span className="text-xs leading-5 text-slate-500">Stok və satış izləməsi üçün unikal məhsul kodudur. Variantlı məhsullarda hər variantın ayrıca kodu ola bilər.</span></label>
      <label className="grid gap-1 text-sm">Kateqoriya<select name="categoryId" value={categoryId} onChange={event => setCategoryId(event.target.value)} className={input}><option value="">Kateqoriya seçin</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <VendorBrandSelector brands={brands} value={brandId} onChange={setBrandId}/>
      <label className="grid gap-1 text-sm sm:col-span-2">Təsvir<textarea name="description" maxLength={5000} rows={4} className={input}/></label>
      {!categories.length && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 sm:col-span-2">Aktiv kateqoriya yoxdur. Kateqoriya yaratmaq üçün adminlə əlaqə saxlayın. Məhsulu qaralama kimi saxlaya bilərsiniz.</p>}
    </section>
    <section className="grid gap-4 rounded-2xl border border-[#e9e4da] bg-white p-5 sm:grid-cols-2 sm:p-7"><h2 className="font-semibold sm:col-span-2">Qiymətləndirmə</h2><label className="grid gap-1 text-sm">Qiymət (₼)<input name="price" type="number" required min="0.01" step="0.01" className={input}/></label><label className="grid gap-1 text-sm">Endirimli qiymət (istəyə görə)<input name="discountPrice" type="number" min="0.01" step="0.01" className={input}/></label><p className="text-xs text-slate-500 sm:col-span-2">Endirimli qiymət əsas qiymətdən aşağı olmalıdır. Server bu qaydanı ayrıca yoxlayır.</p></section>
    <section className="grid gap-4 rounded-2xl border border-[#e9e4da] bg-white p-5 sm:grid-cols-2 sm:p-7"><h2 className="font-semibold sm:col-span-2">Anbar</h2><label className="grid gap-1 text-sm">İlkin stok miqdarı<input name="quantity" type="number" min="0" step="1" defaultValue="0" className={input}/></label><label className="grid gap-1 text-sm">Az stok xəbərdarlığı həddi<input name="lowStockThreshold" type="number" min="0" step="1" defaultValue="5" className={input}/></label><p className="text-xs text-slate-500 sm:col-span-2">Variant əlavə ediləndə stok hər variant üzrə ayrıca idarə olunur.</p></section>
    <section className="grid gap-4 rounded-2xl border border-[#e9e4da] bg-white p-5 sm:p-7"><div><h2 className="font-semibold">Şəkillər</h2><p className="mt-1 text-sm text-slate-500">Birinci şəkil əsas şəkil kimi göstərilir. Sıralama yükləmə ardıcıllığı ilə müəyyən olunur.</p></div><VendorImageUploader storeId={storeId}/></section>
    <VendorVariantEditor storeId={storeId} name="variants" initial={[]} categoryName={categories.find(item => item.id === categoryId)?.name || ""}/>
    {!canSell && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Mağaza, satıcı hesabı və abunəlik aktiv olana qədər məhsul qaralama kimi saxlanıla bilər, lakin yayımlana bilməz.</p>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}{message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    <div className="flex flex-wrap gap-3"><button type="submit" name="intent" value="draft" disabled={busy} onClick={() => setPublish(false)} className="min-h-11 rounded-xl border border-[#173c40] px-5 py-3 text-sm font-semibold text-[#173c40]">{busy && !publish ? "Saxlanılır…" : "Qaralama saxla"}</button><button type="submit" name="intent" value="publish" disabled={busy || !canSell || !categories.length} onClick={() => setPublish(true)} className="min-h-11 rounded-xl bg-[#173c40] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy && publish ? "Yayımlanır…" : "Yayımla"}</button></div>
  </form>;
}
