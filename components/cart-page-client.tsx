"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { ErrorState } from "@/components/state-panel";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { cx, focusRing } from "@/components/ui/cx";
import { centsToFixed, lineTotalCents, storeDeliveryCents, type StoreDeliveryCents } from "@/lib/delivery-cents";

type CartItem = {
  id: string; productId: string; variantId: string | null; quantity: number;
  variant: { name: string; options?: Record<string, unknown>; images?: string[] } | null;
  available: number; effectivePrice: string; effectiveBasePrice: string; activePromotionName: string | null;
  purchasable: boolean; unavailableReason: string | null;
  product: { name: string; price: string; images: string[]; store: { id: string; name: string; cityId: string; deliveryFee: string; freeDeliveryThreshold: string }; inventory: { variantId: string | null; quantity: number; reserved: number }[] };
};
type Cart = { id: string; items: CartItem[] } | null;
/** Loading and loaded cart share this box: the same padding and a minimum height, so the footer does not jump. */
const CART_PAGE = "container min-h-[80svh] py-10 md:py-14";
const money = (value: number) => new Intl.NumberFormat("az-AZ", { style: "currency", currency: "AZN", maximumFractionDigits: 2 }).format(value);

export function CartPageClient() {
  const [cart, setCart] = useState<Cart>(null), [loading, setLoading] = useState(true), [error, setError] = useState(""), [busy, setBusy] = useState<string | null>(null);
  async function load() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/cart", { cache: "no-store" }), data = await response.json();
      if (response.status === 401) { location.assign(`/login?next=${encodeURIComponent("/cart")}`); return; }
      if (!response.ok) throw new Error(data.error || "Səbət yüklənmədi.");
      setCart(data.cart);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Səbət yüklənmədi."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  // CART-DELIVERY: per store the same delivery as the checkout and the order (lib/delivery-cents.ts = the rules of
  // calculateStoreDelivery, in whole cents). Totals cover every item shown, also unavailable ones, exactly like the
  // checkout page; ordering stays blocked until those are removed or fixed.
  const groups = useMemo(() => {
    const map = new Map<string, { store: CartItem["product"]["store"]; items: CartItem[] }>();
    for (const item of cart?.items ?? []) { const group = map.get(item.product.store.id) ?? { store: item.product.store, items: [] }; group.items.push(item); map.set(item.product.store.id, group); }
    return [...map.values()].map((group): { store: CartItem["product"]["store"]; items: CartItem[]; delivery: StoreDeliveryCents } => ({ ...group, delivery: storeDeliveryCents(group.items.reduce((sum, item) => sum + lineTotalCents(item.effectivePrice, item.quantity), 0), { deliveryFee: group.store.deliveryFee, freeDeliveryThreshold: group.store.freeDeliveryThreshold }) }));
  }, [cart]);
  const subtotalCents = groups.reduce((sum, group) => sum + group.delivery.subtotalCents, 0);
  const deliveryCents = groups.reduce((sum, group) => sum + group.delivery.deliveryFeeCents, 0);
  const totalCents = subtotalCents + deliveryCents;
  const canCheckout = (cart?.items ?? []).every(item => item.purchasable && item.available >= item.quantity);

  async function update(item: CartItem, quantity?: number) {
    setBusy(item.id); setError("");
    try {
      const response = await fetch(`/api/cart/items/${item.id}`, quantity === undefined ? { method: "DELETE" } : { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantity }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Səbət yenilənmədi."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Səbət yenilənmədi."); }
    finally { setBusy(null); }
  }

  // Loading: the same heading and a skeleton shaped like the cart (rows + summary), in a box as tall as the loaded page,
  // so nothing jumps when the cart arrives (DESIGN-T6: the old small box caused a layout shift of up to 0.18 at 390 px).
  if (loading) return <div className={CART_PAGE}>
    <p className="text-kicker uppercase text-gold-700">Sifarişə hazırlıq</p>
    <h1 className="mt-2 font-display text-h1 text-fg">Səbət</h1>
    <SkeletonRegion label="Səbət yüklənir…" className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
      <div className="space-y-5"><Skeleton rounded="card" className="h-72"/><Skeleton rounded="card" className="h-40"/></div>
      <Skeleton rounded="card" className="h-80"/>
    </SkeletonRegion>
  </div>;
  if (error && !cart) return <div className="container py-12"><ErrorState message={error}/><button type="button" onClick={() => void load()} className={`mt-4 ${buttonClass({ variant: "secondary", size: "sm" })}`}>Yenidən cəhd et</button></div>;
  if (!cart?.items.length) return <div className={CART_PAGE}><h1 className="font-display text-h1 text-fg">Səbət</h1><EmptyState className="mt-8" icon={<ShoppingBag size={24}/>} title="Səbətiniz boşdur" description="Mağazalara baxın və bəyəndiyiniz məhsulları səbətə əlavə edin." action={<ButtonLink href="/products" size="sm"><ShoppingBag aria-hidden="true" size={17}/> Məhsullara bax</ButtonLink>}/></div>;

  return <div className={CART_PAGE}>
    <p className="text-kicker uppercase text-gold-700">Sifarişə hazırlıq</p>
    <h1 className="mt-2 font-display text-h1 text-fg">Səbət <span className="font-sans text-lg font-normal text-fg-muted">({cart.items.length})</span></h1>
    {error && <div className="mt-5"><ErrorState message={error}/></div>}
    <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
      <div className="min-w-0 space-y-5">{groups.map(group => <section key={group.store.id} data-cart-store="" className="overflow-hidden rounded-card border border-line bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-page px-5 py-4">
          <div className="min-w-0"><p className="text-xs text-fg-muted">Mağaza</p><Link href={`/stores/${group.store.id}`} className={cx("rounded-sm font-semibold text-fg hover:text-primary", focusRing)}>{group.store.name}</Link><p className="mt-1 text-xs text-fg-muted">Mağaza üzrə cəm: <b className="text-fg">{money(group.delivery.subtotalCents / 100)}</b></p></div>
          <Link href={`/stores/${group.store.id}`} className={cx("inline-flex min-h-11 items-center rounded-sm text-sm font-medium text-primary hover:text-primary-hover", focusRing)}>Mağazaya bax →</Link>
        </div>
        <ul className="divide-y divide-line">{group.items.map(item => {
          const current = Number(item.effectivePrice) || 0, original = Number(item.effectiveBasePrice) || 0;
          const stock = item.product.inventory.find(row => row.variantId === item.variantId), available = stock ? Math.max(0, stock.quantity - stock.reserved) : 0;
          const image = item.variant?.images?.[0] || item.product.images[0];
          const options = Object.entries(item.variant?.options || {}).map(([key, value]) => `${key}: ${String(value)}`).join(" · ");
          const ok = item.purchasable && item.available >= item.quantity;
          return <li key={item.id} data-cart-item="" className="grid grid-cols-[80px_minmax(0,1fr)] gap-4 p-4 sm:grid-cols-[96px_minmax(0,1fr)_auto] sm:items-center sm:p-5">
            <Link href={`/products/${item.productId}`} className={cx("flex h-20 w-20 items-center justify-center overflow-hidden rounded-control border border-line bg-surface-sunken text-center text-[11px] text-fg-muted sm:h-24 sm:w-24", focusRing)}>{image ? <img src={image} alt={item.product.name} className="h-full w-full object-cover"/> : "Şəkil yoxdur"}</Link>
            <div className="min-w-0">
              <Link href={`/products/${item.productId}`} className={cx("line-clamp-2 break-words rounded-sm font-semibold text-fg hover:text-primary", focusRing)}>{item.product.name}</Link>
              {item.variant && <p className="mt-1 text-xs text-fg-muted">{item.variant.name}{options ? ` · ${options}` : ""}</p>}
              <p className="mt-2 text-sm text-fg-secondary">Vahid qiymət: <b className="text-fg">{money(current)}</b>{current < original && <span className="ml-2 text-xs text-fg-muted line-through">{money(original)}</span>}</p>
              {item.activePromotionName && <p className="mt-1 text-xs font-medium text-gold-700">Kampaniya · {item.activePromotionName}</p>}
              <p className="mt-1 font-semibold text-fg sm:hidden">Cəmi: {money(current * item.quantity)}</p>
              <p className={cx("mt-1 text-xs font-medium", ok ? "text-primary" : "text-danger")}>{item.purchasable ? `Mövcud stok: ${item.available}` : item.unavailableReason || "Seçilən məhsul və ya variant artıq sifariş üçün mövcud deyil."}</p>
              <div className="mt-3 flex items-center gap-2 sm:hidden"><QuantityControl item={item} available={available} busy={busy === item.id} onUpdate={update}/><RemoveButton item={item} busy={busy === item.id} onUpdate={update}/></div>
            </div>
            <div className="hidden items-center gap-4 sm:flex"><QuantityControl item={item} available={available} busy={busy === item.id} onUpdate={update}/><span className="w-28 text-right font-semibold text-fg">{money(current * item.quantity)}</span><RemoveButton item={item} busy={busy === item.id} onUpdate={update}/></div>
          </li>;
        })}</ul>
        {/* Delivery of this store: the checkout's texts and numbers (the fee, or none once the store's own threshold is reached). */}
        <div data-cart-store-delivery="" className="border-t border-line bg-surface-page px-5 py-4 text-sm">
          <div className="flex justify-between gap-3 text-fg-secondary"><span>Çatdırılma</span><b className="text-fg">{group.delivery.freeDelivery ? "PULSUZ" : money(group.delivery.deliveryFeeCents / 100)}</b></div>
          {!group.delivery.freeDelivery && <p className="mt-1 text-xs text-fg-muted">{centsToFixed(group.delivery.freeDeliveryThresholdCents)} AZN və yuxarı sifarişlərdə çatdırılma pulsuzdur.</p>}
          <p className="mt-2 flex justify-between gap-3 border-t border-line pt-2 font-semibold text-fg"><span>Mağaza cəmi:</span><span>{money(group.delivery.storeTotalCents / 100)}</span></p>
        </div></section>)}</div>
      <aside className="h-fit space-y-4 lg:sticky lg:top-36">
        <section data-cart-summary="" className="rounded-card border border-line bg-white p-5 shadow-card sm:p-6">
          <h2 className="font-display text-h3 text-fg">Sifariş xülasəsi</h2>
          <p className="mt-3 text-sm text-fg-muted">{groups.length} mağazadan məhsullar</p>
          <dl className="mt-4 space-y-2.5 text-sm text-fg-secondary">
            <div className="flex justify-between gap-3"><dt>Ara cəm</dt><dd className="font-medium text-fg">{money(subtotalCents / 100)}</dd></div>
            <div className="flex justify-between gap-3"><dt>Çatdırılma</dt><dd className="font-medium text-fg">{money(deliveryCents / 100)}</dd></div>
            <div className="flex justify-between gap-3 border-t border-line pt-4 text-lg font-semibold text-fg"><dt>Cəmi</dt><dd>{money(totalCents / 100)}</dd></div>
          </dl>
          <Link aria-disabled={!canCheckout} href={canCheckout ? "/checkout" : "/cart"} className={`mt-5 ${buttonClass({ size: "lg", fullWidth: true })}`} onClick={event => { if (!canCheckout) event.preventDefault(); }}>Sifarişi rəsmiləşdir</Link>
          {!canCheckout && <p role="alert" className="mt-2 text-xs font-medium text-danger">Mövcud olmayan və ya stoku dəyişmiş məhsulları silin və ya miqdarını yeniləyin.</p>}
          <Link href="/products" className={cx("mt-3 flex min-h-11 items-center justify-center rounded-full text-sm font-medium text-fg-secondary hover:text-primary", focusRing)}>Alış-verişə davam et</Link>
        </section>
        <div className="rounded-card bg-surface-sunken p-5 text-sm leading-6 text-fg-secondary">Səbətdəki məhsullar fərqli mağazalara aid ola bilər. Hər mağaza öz məhsullarını ayrıca hazırlayır.</div>
      </aside>
    </div>
  </div>;
}

/** 44 px stepper: the same PATCH as before; − is disabled at 1, + at the available stock. */
function QuantityControl({ item, available, busy, onUpdate }: { item: CartItem; available: number; busy: boolean; onUpdate: (item: CartItem, quantity?: number) => void }) {
  const step = cx("grid h-11 w-11 place-items-center text-fg transition-colors hover:text-primary disabled:text-fg-muted disabled:opacity-50", focusRing);
  return <div className="flex h-11 items-center rounded-full border border-line-strong bg-white"><button type="button" aria-label="Miqdarı azalt" disabled={busy || item.quantity <= 1} onClick={() => onUpdate(item, item.quantity - 1)} className={cx(step, "rounded-l-full")}><Minus aria-hidden="true" size={15}/></button><span aria-live="polite" className="min-w-8 text-center text-sm font-semibold text-fg">{item.quantity}</span><button type="button" aria-label="Miqdarı artır" disabled={busy || item.quantity >= available} onClick={() => onUpdate(item, item.quantity + 1)} className={cx(step, "rounded-r-full")}><Plus aria-hidden="true" size={15}/></button></div>;
}

function RemoveButton({ item, busy, onUpdate }: { item: CartItem; busy: boolean; onUpdate: (item: CartItem, quantity?: number) => void }) {
  return <button type="button" aria-label="Məhsulu səbətdən sil" onClick={() => void onUpdate(item)} disabled={busy} className={cx("grid h-11 w-11 place-items-center rounded-full text-fg-muted transition-colors hover:bg-danger-subtle hover:text-danger disabled:opacity-50", focusRing)}><Trash2 aria-hidden="true" size={17}/></button>;
}
