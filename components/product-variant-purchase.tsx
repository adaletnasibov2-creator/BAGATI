"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MapPin, PackageCheck, ShoppingBag, Truck } from "lucide-react";
import ProductGallery from "@/components/product-gallery";
import { FavoriteToggle } from "@/components/favorite-toggle";
import { getProductDiscount } from "@/lib/product-card-pricing";

type Variant = { id: string; name: string; options: Record<string, unknown>; isActive: boolean; images: string[]; available: number; basePrice: string; unitPrice: string; campaignName: string | null };
type Axis = { name: string; values: string[] };
const valueOf = (variant: Variant, axis: string) => axis === "Seçim" && !Object.keys(variant.options || {}).length ? variant.name : String(variant.options?.[axis] ?? "");

type ProductVariantPurchaseProps = {
  productId: string;
  name: string;
  productImages: string[];
  variants: Variant[];
  hasVariants: boolean;
  stock: number;
  basePrice: string;
  unitPrice: string;
  campaignName: string | null;
  store: { id: string; name: string; city: string; deliveryFee: string; freeDeliveryThreshold: string };
  category: { name: string; href: string } | null;
  sku: string | null;
};

export default function ProductVariantPurchase({ productId, name, productImages, variants, hasVariants, stock, basePrice, unitPrice, campaignName, store, category, sku }: ProductVariantPurchaseProps) {
  const axes = useMemo<Axis[]>(() => {
    const values = new Map<string, Set<string>>();
    for (const variant of variants) for (const [key, raw] of Object.entries(variant.options || {})) {
      const value = String(raw ?? "").trim(); if (!key.trim() || !value) continue;
      if (!values.has(key)) values.set(key, new Set()); values.get(key)!.add(value);
    }
    if (!values.size && variants.length) return [{ name: "Seçim", values: [...new Set(variants.map(variant => variant.name))] }];
    return [...values].map(([axis, entries]) => ({ name: axis, values: [...entries] }));
  }, [variants]);
  const initialVariant = variants.find(variant => variant.isActive && variant.available > 0) || variants.find(variant => variant.isActive) || variants[0];
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
  const { discounted: priceIsDiscounted } = getProductDiscount(currentPrice, currentBase);
  const maxQuantity = Math.min(selectedStock, 50);

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

  return <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,.9fr)] lg:items-start lg:gap-10">
    <div className="min-w-0">
      <ProductGallery key={selectedVariant?.id || "product-images"} images={selectedImages} name={name}/>
      {productImages.length > 1 && <p className="mt-2 text-center text-xs text-muted">Şəkillərə toxunaraq digər görünüşlərə baxın</p>}
    </div>
    <section className="min-w-0 rounded-3xl border border-[#E5EAE6] bg-white p-5 shadow-[0_12px_36px_-30px_rgba(18,46,46,.45)] sm:p-7" aria-labelledby="product-title">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {category && <Link href={category.href} className="text-xs font-semibold uppercase tracking-[.14em] text-[#8A6A37] hover:text-emerald">{category.name}</Link>}
          <h1 id="product-title" className="mt-2 break-words text-2xl font-semibold leading-tight tracking-tight text-[#233432] sm:text-3xl">{name}</h1>
        </div>
        <FavoriteToggle productId={productId}/>
      </div>
      <Link href={`/stores/${store.id}`} className="mt-5 inline-flex min-h-11 max-w-full items-center gap-2 rounded-full bg-[#F4F7F4] px-3.5 py-2 text-sm font-medium text-[#315A51] hover:bg-[#EAF1EC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C79A52]">
        <MapPin aria-hidden="true" size={16} className="shrink-0"/>
        <span className="truncate">{store.name}</span>
        <span aria-hidden="true" className="text-[#A7B2AC]">·</span>
        <span className="shrink-0 text-[#697875]">{store.city}</span>
      </Link>
      {sku && <p className="mt-3 text-xs text-muted">SKU: {sku}</p>}

      <div className="mt-6 border-y border-[#E8EDE9] py-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {priceIsDiscounted && <span className="text-3xl font-semibold tracking-tight text-[#173A3A]">{currentPrice} ₼</span>}
          <span className={priceIsDiscounted ? "text-lg text-muted line-through" : "text-3xl font-semibold tracking-tight text-[#173A3A]"}>{currentBase} ₼</span>
          {priceIsDiscounted && <span className="rounded-full bg-[#F3E9D5] px-3 py-1 text-xs font-semibold text-[#70552E]">{currentCampaign ? `Kampaniya: ${currentCampaign}` : "Endirim"}</span>}
        </div>
        <p className="mt-2 text-xs text-muted">Yekun çatdırılma haqqı sifariş zamanı hesablanır.</p>
      </div>

      {hasVariants && axes.map(axis => <fieldset key={axis.name} className="mt-5">
        <legend className="text-sm font-semibold text-[#233432]">{axis.name} seçin{selection[axis.name] ? <span className="font-normal text-muted"> · {selection[axis.name]}</span> : ""}</legend>
        <div className="mt-2 flex flex-wrap gap-2">{axis.values.map(value => {
        const axisIndex = axes.findIndex(item => item.name === axis.name);
        const available = variants.some(variant => variant.isActive && variant.available > 0 && valueOf(variant, axis.name) === value && axes.slice(0, axisIndex).every(previous => !selection[previous.name] || valueOf(variant, previous.name) === selection[previous.name]));
        const active = selection[axis.name] === value;
        return <button key={value} type="button" disabled={!available && !active} aria-pressed={active} onClick={() => choose(axis.name, value)} className={`min-h-11 rounded-xl border px-3.5 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C79A52] motion-reduce:transition-none ${active ? "border-[#173c40] bg-[#173c40] text-white" : "border-[#DDE5E0] bg-white text-[#344C46] hover:border-[#93ADA0]"} disabled:cursor-not-allowed disabled:opacity-45`}>{value}{!available ? " · Tükənib" : ""}</button>;
        })}</div>
      </fieldset>)}
      {hasVariants && selectedVariant && <p className="mt-2 text-xs text-muted">{selectedVariant.name}</p>}
      <div className="mt-6 flex items-center gap-3">
        <label className="sr-only" htmlFor="product-quantity">Miqdar</label>
        <input id="product-quantity" type="number" min={1} max={Math.max(maxQuantity, 1)} step={1} value={quantity} onChange={event => {
          const value = event.currentTarget.valueAsNumber;
          setQuantity(Number.isFinite(value) ? Math.max(1, Math.min(maxQuantity || 1, Math.floor(value))) : 1);
        }} className="h-12 w-[5.25rem] rounded-xl border border-[#DDE5E0] bg-white px-3 text-center text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C79A52]"/>
        <button type="button" onClick={() => void add()} disabled={busy || (hasVariants && (!complete || !selectedVariant || !selectedVariant.isActive || selectedStock < 1)) || selectedStock < 1} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-[#173A3A] px-5 py-3 font-medium text-white transition-colors hover:bg-emerald focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C79A52] disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"><ShoppingBag aria-hidden="true" size={17}/>{busy ? "Əlavə olunur…" : "Səbətə əlavə et"}</button>
      </div>
      <p className="mt-2 text-sm text-muted" aria-live="polite">{hasVariants && !complete ? "Əvvəlcə variant seçimlərini tamamlayın." : hasVariants && !selectedVariant ? "Bu seçim mövcud deyil." : selectedStock > 0 ? `Stokda ${selectedStock} ədəd` : "Tükənib"}</p>
      {message && <p role="status" className="mt-2 text-sm text-muted">{message}</p>}
      <div className="mt-6 grid gap-3 border-t border-[#E8EDE9] pt-5 text-sm text-[#52645D] sm:grid-cols-2 lg:grid-cols-1">
        <div className="flex items-start gap-3"><Truck aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-[#52766A]"/><p>Çatdırılma haqqı <strong className="font-semibold text-[#233432]">{store.deliveryFee} ₼</strong>; mağaza sifarişlərində <strong className="font-semibold text-[#233432]">{store.freeDeliveryThreshold} ₼</strong>-dan etibarən pulsuzdur.</p></div>
        <Link href="/delivery-returns" className="flex min-h-11 items-center gap-3 rounded-xl text-[#315A51] hover:text-emerald focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C79A52]"><PackageCheck aria-hidden="true" size={18} className="shrink-0"/><span>Çatdırılma və qaytarılma şərtləri</span></Link>
      </div>
    </section>
  </div>;
}
