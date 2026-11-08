"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ShoppingBag } from "lucide-react";
import ProductGallery from "@/components/product-gallery";

type Variant = { id: string; name: string; options: Record<string, unknown>; isActive: boolean; images: string[]; available: number; basePrice: string; unitPrice: string; campaignName: string | null };
type Axis = { name: string; values: string[] };
const valueOf = (variant: Variant, axis: string) => axis === "Seçim" && !Object.keys(variant.options || {}).length ? variant.name : String(variant.options?.[axis] ?? "");

export default function ProductVariantPurchase({ productId, name, productImages, variants, hasVariants, stock, basePrice, unitPrice, campaignName }: { productId: string; name: string; productImages: string[]; variants: Variant[]; hasVariants: boolean; stock: number; basePrice: string; unitPrice: string; campaignName: string | null }) {
  const axes = useMemo<Axis[]>(() => {
    const values = new Map<string, Set<string>>();
    for (const variant of variants) for (const [key, raw] of Object.entries(variant.options || {})) {
      const value = String(raw ?? "").trim(); if (!key.trim() || !value) continue;
      if (!values.has(key)) values.set(key, new Set()); values.get(key)!.add(value);
    }
    if (!values.size && variants.length) return [{ name: "Seçim", values: [...new Set(variants.map(variant => variant.name))] }];
    return [...values].map(([axis, entries]) => ({ name: axis, values: [...entries] }));
  }, [variants]);
  const initialVariant = variants.find(variant => variant.isActive && variant.available > 0) || variants[0];
  const [selection, setSelection] = useState<Record<string, string>>(() => Object.fromEntries(axes.map(axis => [axis.name, initialVariant ? valueOf(initialVariant, axis.name) : ""])));
  const [quantity, setQuantity] = useState(1), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const router = useRouter(), pathname = usePathname();
  const matching = (variant: Variant, selected: Record<string, string>) => axes.every(axis => !selected[axis.name] || valueOf(variant, axis.name) === selected[axis.name]);
  const complete = !hasVariants || axes.every(axis => Boolean(selection[axis.name]));
  const selectedVariant = hasVariants && complete ? variants.find(variant => matching(variant, selection)) || null : null;
  const selectedStock = hasVariants ? selectedVariant?.available ?? 0 : stock;
  const currentBase = hasVariants ? selectedVariant?.basePrice ?? basePrice : basePrice;
  const currentPrice = hasVariants ? selectedVariant?.unitPrice ?? unitPrice : unitPrice;
  const currentCampaign = hasVariants ? selectedVariant?.campaignName ?? null : campaignName;
  const selectedImages = selectedVariant?.images?.length ? selectedVariant.images : productImages;
  const priceIsDiscounted = Number(currentPrice) < Number(currentBase);

  function choose(axis: string, value: string) {
    const next = { ...selection, [axis]: value };
    for (const other of axes) if (other.name !== axis && next[other.name] && !variants.some(variant => variant.isActive && variant.available > 0 && matching(variant, next))) delete next[other.name];
    setSelection(next); setQuantity(1); setMessage("");
  }

  async function add() {
    if (hasVariants && (!selectedVariant || !selectedVariant.isActive || selectedVariant.available < 1)) { setMessage("Zəhmət olmasa stokda olan variantı seçin."); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/cart/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId, ...(selectedVariant ? { variantId: selectedVariant.id } : {}), quantity }) });
      const result = await response.json();
      if (response.status === 401) { router.push(`/login?next=${encodeURIComponent(pathname)}`); return; }
      if (!response.ok) { setMessage(result.error || "Məhsulu səbətə əlavə etmək mümkün olmadı."); return; }
      setMessage("Məhsul səbətə əlavə edildi."); router.refresh();
    } catch { setMessage("Bağlantı xətası. Yenidən cəhd edin."); }
    finally { setBusy(false); }
  }

  return <div className="grid min-w-0 gap-7 lg:grid-cols-[1fr_.9fr] lg:items-start">
    <ProductGallery key={selectedVariant?.id || "product-images"} images={selectedImages} name={name}/>
    <div>
      {hasVariants && axes.map(axis => <fieldset key={axis.name} className="mt-4"><legend className="text-sm font-medium">{axis.name} seçin</legend><div className="mt-2 flex flex-wrap gap-2">{axis.values.map(value => {
        const axisIndex = axes.findIndex(item => item.name === axis.name);
        const available = variants.some(variant => variant.isActive && variant.available > 0 && valueOf(variant, axis.name) === value && axes.slice(0, axisIndex).every(previous => !selection[previous.name] || valueOf(variant, previous.name) === selection[previous.name]));
        const active = selection[axis.name] === value;
        return <button key={value} type="button" disabled={!available && !active} aria-pressed={active} onClick={() => choose(axis.name, value)} className={`rounded-xl border px-3 py-2 text-sm ${active ? "border-[#173c40] bg-[#173c40] text-white" : "border-line bg-white text-ink"} disabled:cursor-not-allowed disabled:opacity-40`}>{value}{!available ? " · Tükənib" : ""}</button>;
      })}</div></fieldset>)}
      <div className="mt-6 flex flex-wrap items-baseline gap-3">{priceIsDiscounted && <span className="text-3xl font-semibold text-ink">{currentPrice} ₼</span>}<span className={priceIsDiscounted ? "text-lg text-muted line-through" : "text-3xl font-semibold text-ink"}>{currentBase} ₼</span>{priceIsDiscounted && <span className="rounded-full bg-[#edf1ed] px-3 py-1 text-xs font-semibold text-emerald">{currentCampaign ? `Kampaniya: ${currentCampaign}` : "Endirim"}</span>}</div>
      {hasVariants && selectedVariant && <p className="mt-2 text-xs text-muted">{selectedVariant.name}</p>}
      <div className="mt-4 flex items-center gap-3"><label className="sr-only" htmlFor="product-quantity">Miqdar</label><input id="product-quantity" type="number" min={1} max={Math.max(selectedStock, 1)} value={quantity} onChange={event => setQuantity(Math.max(1, Math.min(selectedStock || 1, Number(event.target.value))))} className="w-20 rounded-xl border border-line bg-white px-3 py-3 text-center"/><button type="button" onClick={() => void add()} disabled={busy || (hasVariants && (!complete || !selectedVariant || !selectedVariant.isActive || selectedStock < 1)) || selectedStock < 1} className="flex flex-1 items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 font-medium text-white hover:bg-emerald disabled:cursor-not-allowed disabled:opacity-40"><ShoppingBag size={17}/>{busy ? "Əlavə olunur…" : "Səbətə əlavə et"}</button></div>
      <p className="mt-2 text-sm text-muted" aria-live="polite">{hasVariants && !complete ? "Əvvəlcə variant seçimlərini tamamlayın." : hasVariants && !selectedVariant ? "Bu seçim mövcud deyil." : selectedStock > 0 ? `Stokda ${selectedStock} ədəd` : "Tükənib"}</p>
      {message && <p role="status" className="mt-2 text-sm text-muted">{message}</p>}
    </div>
  </div>;
}
