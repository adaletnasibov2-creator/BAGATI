"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronRight, MapPin, Minus, PackageCheck, Plus, ShoppingBag, Store, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { cx, focusRing } from "@/components/ui/cx";
import ProductGallery from "@/components/product-gallery";
import { FavoriteToggle } from "@/components/favorite-toggle";
import { getProductDiscount } from "@/lib/product-card-pricing";
import { addRememberedCartItem, browserSessionStorage, rememberPendingCartAdd } from "@/lib/pending-cart-add";
import { notifyCartChanged } from "@/lib/cart-events";

type Variant = { id: string; name: string; options: Record<string, unknown>; isActive: boolean; images: string[]; available: number; basePrice: string; unitPrice: string; campaignName: string | null };
type Axis = { name: string; values: string[] };
/** SIGNUP-EASY-1 R6: after this message the status line also links to the cart ("Səbətə keç", the checkout's wording). */
const ADDED_TO_CART_MESSAGE = "Məhsul səbətə əlavə edildi.";
/** SIGNUP-EASY-2 T3: the item a guest chose before signing in was added after the login (also links to the cart). */
export const PENDING_CART_ADDED_MESSAGE = "Seçdiyiniz məhsul səbətə əlavə edildi.";
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
  /** SIGNUP-EASY-2: true only for a signed-in CUSTOMER (server-decided); only then is a remembered item added. */
  viewerIsCustomer?: boolean;
};

export default function ProductVariantPurchase({ productId, name, productImages, variants, hasVariants, stock, basePrice, unitPrice, campaignName, store, category, sku, viewerIsCustomer = false }: ProductVariantPurchaseProps) {
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
      if (response.status === 401) {
        // SIGNUP-EASY-2: remember the choice in this tab (no URL parameter); added once after the login.
        rememberPendingCartAdd(browserSessionStorage(), { productId, ...(selectedVariant ? { variantId: selectedVariant.id } : {}), quantity });
        router.push(`/login?next=${encodeURIComponent(pathname)}`); return;
      }
      if (!response.ok) { setMessage(result.error || "Məhsulu səbətə əlavə etmək mümkün olmadı."); return; }
      notifyCartChanged(); setMessage(ADDED_TO_CART_MESSAGE); router.refresh();
    } catch { setMessage("Bağlantı xətası. Yenidən cəhd edin."); }
    finally { setBusy(false); }
  }

  // SIGNUP-EASY-2: the remembered item for THIS product, once, only for a signed-in customer. addRememberedCartItem
  // removes it before the request, so a refresh, the back button or a second effect run cannot add it again.
  const pendingHandled = useRef(false);
  useEffect(() => {
    if (!viewerIsCustomer || pendingHandled.current) return;
    pendingHandled.current = true;
    void addRememberedCartItem({
      storage: browserSessionStorage(),
      productId,
      viewerIsCustomer,
      post: async body => {
        const response = await fetch("/api/cart/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const result = await response.json().catch(() => ({}));
        return { ok: response.ok, status: response.status, error: result.error };
      },
    }).then(outcome => {
      if (!outcome) return;
      if (outcome.kind === "added") { notifyCartChanged(); setMessage(PENDING_CART_ADDED_MESSAGE); router.refresh(); return; }
      setMessage(outcome.kind === "network" ? "Bağlantı xətası. Yenidən cəhd edin." : outcome.serverError || "Məhsulu səbətə əlavə etmək mümkün olmadı.");
    });
  }, [viewerIsCustomer, productId, router]);

  const canAdd = !(busy || (hasVariants && (!complete || !selectedVariant || !selectedVariant.isActive || selectedStock < 1)) || selectedStock < 1);
  const stockText = hasVariants && !complete ? "Əvvəlcə variant seçimlərini tamamlayın." : hasVariants && !selectedVariant ? "Bu seçim mövcud deyil." : selectedStock > 0 ? `Stokda ${selectedStock} ədəd` : "Tükənib";
  const setClampedQuantity = (value: number) => setQuantity(Number.isFinite(value) ? Math.max(1, Math.min(maxQuantity || 1, Math.floor(value))) : 1);
  const addLabel = busy ? "Əlavə olunur…" : "Səbətə əlavə et";
  const price = <>
    <span className="text-[1.75rem] font-semibold leading-none tracking-tight text-fg sm:text-[2rem]">{priceIsDiscounted ? currentPrice : currentBase} ₼</span>
    {priceIsDiscounted && <span className="text-base text-fg-muted line-through">{currentBase} ₼</span>}
  </>;

  // Mobile buy bar: rendered into the sticky slot at the end of the product page (app/(customer)/products/[productId]),
  // which reserves its height, so nothing moves when it appears and it never covers the footer.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setSlot(document.getElementById(PRODUCT_BUY_BAR_SLOT_ID)); }, []);

  return <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,.9fr)] lg:items-start lg:gap-10">
    <div className="min-w-0 lg:sticky lg:top-6">
      <ProductGallery key={selectedVariant?.id || "product-images"} images={selectedImages} name={name}/>
      {productImages.length > 1 && <p className="mt-2 text-center text-xs text-fg-muted">Şəkillərə toxunaraq digər görünüşlərə baxın</p>}
    </div>
    <section className="min-w-0 rounded-feature border border-line bg-white p-5 shadow-card sm:p-7" aria-labelledby="product-title">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {category && <Link href={category.href} className={cx("rounded-sm text-kicker uppercase text-gold-700 hover:text-primary", focusRing)}>{category.name}</Link>}
          <h1 id="product-title" className="mt-2 break-words font-display text-h1 text-fg">{name}</h1>
        </div>
        <FavoriteToggle productId={productId}/>
      </div>
      {sku && <p className="mt-2 text-xs text-fg-muted">SKU: {sku}</p>}

      <div className="mt-5 border-y border-line py-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
          {price}
          {priceIsDiscounted && <Badge tone="gold" size="md">{currentCampaign ? `Kampaniya: ${currentCampaign}` : "Endirim"}</Badge>}
        </div>
        <p className="mt-2 text-xs text-fg-muted">Yekun çatdırılma haqqı sifariş zamanı hesablanır.</p>
      </div>

      {hasVariants && axes.map(axis => <fieldset key={axis.name} className="mt-5">
        <legend className="text-sm font-semibold text-fg">{axis.name} seçin{selection[axis.name] ? <span className="font-normal text-fg-muted"> · {selection[axis.name]}</span> : ""}</legend>
        <div className="mt-2.5 flex flex-wrap gap-2">{axis.values.map(value => {
        const axisIndex = axes.findIndex(item => item.name === axis.name);
        const available = variants.some(variant => variant.isActive && variant.available > 0 && valueOf(variant, axis.name) === value && axes.slice(0, axisIndex).every(previous => !selection[previous.name] || valueOf(variant, previous.name) === selection[previous.name]));
        const active = selection[axis.name] === value;
        return <button key={value} type="button" disabled={!available && !active} aria-pressed={active} onClick={() => choose(axis.name, value)} className={cx("min-h-11 rounded-full border px-4 py-2 text-sm font-medium transition-colors motion-reduce:transition-none disabled:cursor-not-allowed disabled:border-dashed disabled:text-fg-muted disabled:opacity-60", focusRing, active ? "border-primary bg-primary text-white" : "border-line-strong bg-white text-fg hover:border-primary hover:text-primary")}>{value}{!available ? " · Tükənib" : ""}</button>;
        })}</div>
      </fieldset>)}
      {hasVariants && selectedVariant && <p className="mt-2 text-xs text-fg-muted">{selectedVariant.name}</p>}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="flex h-12 shrink-0 items-center rounded-full border border-line-strong bg-white">
          <button type="button" aria-label="Miqdarı azalt" disabled={quantity <= 1} onClick={() => setClampedQuantity(quantity - 1)} className={cx("grid h-12 w-11 place-items-center rounded-l-full text-fg transition-colors hover:text-primary disabled:text-fg-muted disabled:opacity-50", focusRing)}><Minus aria-hidden="true" size={16}/></button>
          <label className="sr-only" htmlFor="product-quantity">Miqdar</label>
          <input id="product-quantity" type="number" inputMode="numeric" min={1} max={Math.max(maxQuantity, 1)} step={1} value={quantity} onChange={event => setClampedQuantity(event.currentTarget.valueAsNumber)} className={cx("h-10 w-12 border-0 bg-transparent text-center text-base font-semibold text-fg [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none", focusRing)}/>
          <button type="button" aria-label="Miqdarı artır" disabled={quantity >= Math.max(maxQuantity, 1)} onClick={() => setClampedQuantity(quantity + 1)} className={cx("grid h-12 w-11 place-items-center rounded-r-full text-fg transition-colors hover:text-primary disabled:text-fg-muted disabled:opacity-50", focusRing)}><Plus aria-hidden="true" size={16}/></button>
        </div>
        <button type="button" onClick={() => void add()} disabled={!canAdd} className={cx(buttonClass({ size: "lg" }), "min-w-0 flex-1")}><ShoppingBag aria-hidden="true" size={18}/>{addLabel}</button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(!hasVariants || selectedVariant) && <span aria-hidden="true" className={cx("h-2.5 w-2.5 shrink-0 rounded-full", selectedStock > 0 ? "bg-primary" : "bg-danger")}/>}
        <p className={cx("text-sm font-medium", selectedStock > 0 ? "text-primary" : "text-fg-secondary")} aria-live="polite">{stockText}</p>
      </div>
      {message && <p role="status" className="mt-3 rounded-control bg-primary-subtle px-3 py-2 text-sm font-medium text-primary">{message}{(message === ADDED_TO_CART_MESSAGE || message === PENDING_CART_ADDED_MESSAGE) && <> <Link href="/cart" className="underline underline-offset-4">Səbətə keç</Link></>}</p>}

      <Link href={`/stores/${store.id}`} className={cx("mt-6 flex min-h-14 items-center gap-3 rounded-card border border-line bg-surface-page px-4 py-3 transition-colors hover:border-brand-300 hover:bg-primary-subtle", focusRing)}>
        <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-primary ring-1 ring-inset ring-brand-100"><Store size={18}/></span>
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-fg">{store.name}</span><span className="flex items-center gap-1 text-xs text-fg-muted"><MapPin aria-hidden="true" size={13} className="shrink-0"/>{store.city}</span></span>
        <ChevronRight aria-hidden="true" size={18} className="shrink-0 text-fg-muted"/>
      </Link>
      <div className="mt-4 grid gap-3 text-sm text-fg-secondary">
        <div className="flex items-start gap-3"><Truck aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-primary"/><p>Çatdırılma haqqı <strong className="font-semibold text-fg">{store.deliveryFee} ₼</strong>; mağaza sifarişlərində <strong className="font-semibold text-fg">{store.freeDeliveryThreshold} ₼</strong>-dan etibarən pulsuzdur.</p></div>
        <Link href="/delivery-returns" className={cx("flex min-h-11 items-center gap-3 rounded-control font-medium text-primary hover:text-primary-hover", focusRing)}><PackageCheck aria-hidden="true" size={18} className="shrink-0"/><span>Çatdırılma və qaytarılma şərtləri</span></Link>
      </div>
    </section>
    {slot && createPortal(<div data-product-buy-bar="" className="flex items-center gap-3">
      <div className="min-w-0 flex-1"><p className="flex flex-wrap items-baseline gap-x-2 leading-tight"><span className="text-lg font-semibold text-fg">{priceIsDiscounted ? currentPrice : currentBase} ₼</span>{priceIsDiscounted && <span className="text-xs text-fg-muted line-through">{currentBase} ₼</span>}</p><p className="truncate text-xs text-fg-muted">{stockText}</p></div>
      <button type="button" onClick={() => void add()} disabled={!canAdd} className={cx(buttonClass({ size: "md" }), "shrink-0")}><ShoppingBag aria-hidden="true" size={17}/>{addLabel}</button>
    </div>, slot)}
  </div>;
}

/** The page renders an element with this id (sticky, height reserved); the buy bar is portalled into it on mobile. */
export const PRODUCT_BUY_BAR_SLOT_ID = "product-buy-bar-slot";