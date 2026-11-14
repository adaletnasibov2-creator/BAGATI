"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { presentStockQuantity } from "@/lib/stock-quantity";

type ProductEditValues = {
  name: string;
  description: string | null;
  sku: string | null;
  categoryId: string | null;
  brandId: string | null;
  price: string;
  discountPrice: string | null;
  images: string[];
  quantity: number;
  lowStockThreshold: number;
  variants: {
    id: string;
    name: string;
    sku: string | null;
    isActive: boolean;
    price: string | null;
    discountPrice: string | null;
    quantity: number;
    lowStockThreshold: number;
    reserved: number;
  }[];
};
type Option = { id: string; name: string };

export default function AdminProductEditForm({ productId, initial, categories, brands }: {
  productId: string;
  initial: ProductEditValues;
  categories: Option[];
  brands: Option[];
}) {
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const router = useRouter();
  const input = "w-full rounded-xl border border-[#ded9cf] bg-white px-3 py-2.5 text-sm";

  function update<K extends keyof ProductEditValues>(key: K, value: ProductEditValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/admin/products/${encodeURIComponent(productId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          images: values.images,
          price: Number(values.price),
          discountPrice: values.discountPrice === null || values.discountPrice === "" ? null : Number(values.discountPrice),
          variants: values.variants.map(({ reserved: _reserved, ...variant }) => ({
            ...variant,
            price: variant.price === null || variant.price === "" ? null : Number(variant.price),
            discountPrice: variant.discountPrice === null || variant.discountPrice === "" ? null : Number(variant.discountPrice),
          })),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Məhsul yadda saxlanılmadı.");
      setMessage(result.message || "Məhsul yadda saxlanıldı.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Məhsul yadda saxlanılmadı.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="mb-5 rounded-2xl border border-[#e7e3d9] bg-white p-5">
    <h2 className="font-semibold">Məhsul məlumatlarını redaktə et</h2>
    <p className="mt-1 text-sm text-slate-500">Şəkillər yalnız bu mağazaya aid yüklənmiş resurslardan seçilə bilər. Sifariş tarixçəsi dəyişdirilmir.</p>
    <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-2">
      <label className="grid gap-1 text-sm">Məhsul adı<input className={input} required maxLength={160} value={values.name} onChange={(event) => update("name", event.target.value)} /></label>
      <label className="grid gap-1 text-sm">SKU<input className={input} maxLength={80} value={values.sku ?? ""} onChange={(event) => update("sku", event.target.value || null)} /></label>
      <label className="grid gap-1 text-sm">Kateqoriya<select className={input} value={values.categoryId ?? ""} onChange={(event) => update("categoryId", event.target.value || null)}><option value="">Seçilməyib</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Brend<select className={input} value={values.brandId ?? ""} onChange={(event) => update("brandId", event.target.value || null)}><option value="">Seçilməyib</option>{brands.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Qiymət (AZN)<input className={input} type="number" min="0.01" step="0.01" required value={values.price} onChange={(event) => update("price", event.target.value)} /></label>
      <label className="grid gap-1 text-sm">Endirim qiyməti (AZN)<input className={input} type="number" min="0.01" step="0.01" value={values.discountPrice ?? ""} onChange={(event) => update("discountPrice", event.target.value || null)} /></label>
      <label className="grid gap-1 text-sm sm:col-span-2">Təsvir<textarea className={input} rows={4} maxLength={5000} value={values.description ?? ""} onChange={(event) => update("description", event.target.value || null)} /></label>
      <label className="grid gap-1 text-sm sm:col-span-2">Şəkil URL-ləri (hər sətirdə biri)<textarea className={input} rows={3} value={values.images.join("\n")} onChange={(event) => update("images", event.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))} /></label>
      <label className="grid gap-1 text-sm">Stok<input className={input} type="number" min="0" step="1" value={values.quantity} onChange={(event) => { const parsed = presentStockQuantity(event.target.value); if (parsed !== null) update("quantity", parsed); }} /></label>
      <label className="grid gap-1 text-sm">Az stok həddi<input className={input} type="number" min="0" step="1" value={values.lowStockThreshold} onChange={(event) => { const parsed = presentStockQuantity(event.target.value); if (parsed !== null) update("lowStockThreshold", parsed); }} /></label>
      {values.variants.map((variant, index) => <fieldset key={variant.id} className="grid gap-3 rounded-xl border border-[#e7e3d9] p-4 sm:col-span-2 sm:grid-cols-2">
        <legend className="px-1 text-sm font-medium">Variant: {variant.name} · rezerv: {variant.reserved}</legend>
        <label className="grid gap-1 text-sm">Variant adı<input className={input} required maxLength={100} value={variant.name} onChange={(event) => update("variants", values.variants.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} /></label>
        <label className="grid gap-1 text-sm">Variant SKU<input className={input} maxLength={80} value={variant.sku ?? ""} onChange={(event) => update("variants", values.variants.map((item, i) => i === index ? { ...item, sku: event.target.value || null } : item))} /></label>
        <label className="grid gap-1 text-sm">Variant qiyməti (boş = məhsul qiyməti)<input className={input} type="number" min="0.01" step="0.01" value={variant.price ?? ""} onChange={(event) => update("variants", values.variants.map((item, i) => i === index ? { ...item, price: event.target.value || null } : item))} /></label>
        <label className="grid gap-1 text-sm">Variant endirimi<input className={input} type="number" min="0.01" step="0.01" value={variant.discountPrice ?? ""} onChange={(event) => update("variants", values.variants.map((item, i) => i === index ? { ...item, discountPrice: event.target.value || null } : item))} /></label>
        <label className="grid gap-1 text-sm">Variant stoku<input className={input} type="number" min={variant.reserved} step="1" value={variant.quantity} onChange={(event) => { const parsed = presentStockQuantity(event.target.value); if (parsed !== null) update("variants", values.variants.map((item, i) => i === index ? { ...item, quantity: parsed } : item)); }} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={variant.isActive} onChange={(event) => update("variants", values.variants.map((item, i) => i === index ? { ...item, isActive: event.target.checked } : item))} />Variant aktivdir</label>
      </fieldset>)}
      {error && <p role="alert" className="sm:col-span-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="sm:col-span-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
      <button disabled={busy} className="w-fit rounded-xl bg-[#173c40] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Gözləyin…" : "Dəyişiklikləri saxla"}</button>
    </form>
  </section>;
}
