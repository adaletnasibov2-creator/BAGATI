"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { EmptyState, ErrorState, LoadingState } from "@/components/state-panel";

type CartItem = {
  id: string; productId: string; variantId: string | null; quantity: number;
  variant: { name: string; options?: Record<string, unknown>; images?: string[] } | null;
  available: number; effectivePrice: string; effectiveBasePrice: string; activePromotionName: string | null;
  purchasable: boolean; unavailableReason: string | null;
  product: { name: string; price: string; images: string[]; store: { id: string; name: string; cityId: string }; inventory: { variantId: string | null; quantity: number; reserved: number }[] };
};
type Cart = { id: string; items: CartItem[] } | null;
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
  const groups = useMemo(() => {
    const map = new Map<string, { store: CartItem["product"]["store"]; items: CartItem[] }>();
    for (const item of cart?.items ?? []) { const group = map.get(item.product.store.id) ?? { store: item.product.store, items: [] }; group.items.push(item); map.set(item.product.store.id, group); }
    return [...map.values()];
  }, [cart]);
  const subtotal = (cart?.items ?? []).reduce((sum, item) => sum + Math.max(0, Number(item.effectivePrice) || 0) * item.quantity, 0);
  const canCheckout = (cart?.items ?? []).every(item => item.purchasable && item.available >= item.quantity);

  async function update(item: CartItem, quantity?: number) {
    setBusy(item.id); setError("");
    try {
      const response = await fetch(`/api/cart/items/${item.id}`, quantity === undefined ? { method: "DELETE" } : { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantity }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Səbət yenilənmədi."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Səbət yenilənmədi."); }
    finally { setBusy(null); }
  }

  if (loading) return <div className="container py-12"><LoadingState label="Səbət yüklənir"/></div>;
  if (error && !cart) return <div className="container py-12"><ErrorState message={error}/><button onClick={() => void load()} className="mt-4 text-sm font-medium text-emerald">Yenidən cəhd et</button></div>;
  if (!cart?.items.length) return <div className="container py-12"><h1 className="text-3xl font-semibold">Səbət</h1><div className="mt-8"><EmptyState title="Səbətiniz boşdur" detail="Mağazalara baxın və bəyəndiyiniz məhsulları səbətə əlavə edin."/></div><Link href="/products" className="mx-auto mt-6 flex w-fit items-center gap-2 rounded-full bg-ink px-6 py-3 text-sm font-medium text-white hover:bg-emerald"><ShoppingBag size={17}/> Məhsullara bax</Link></div>;

  return <div className="container py-10 md:py-14"><p className="text-xs font-semibold uppercase tracking-[.18em] text-emerald">Sifarişə hazırlıq</p><h1 className="mt-2 text-3xl font-semibold text-ink">Səbət <span className="text-lg font-normal text-muted">({cart.items.length})</span></h1>{error && <div className="mt-5"><ErrorState message={error}/></div>}
    <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_340px]">
      <div className="space-y-5">{groups.map(group => <section key={group.store.id} className="overflow-hidden rounded-2xl border border-line bg-white"><div className="flex items-center justify-between border-b border-line bg-[#fbfaf8] px-5 py-4"><div><p className="text-xs text-muted">Mağaza</p><Link href={`/stores/${group.store.id}`} className="font-semibold text-ink hover:text-emerald">{group.store.name}</Link><p className="mt-1 text-xs text-muted">Mağaza üzrə cəm: <b className="text-ink">{money(group.items.reduce((sum, item) => sum + Math.max(0, Number(item.effectivePrice) || 0) * item.quantity, 0))}</b></p></div><Link href={`/stores/${group.store.id}`} className="text-sm text-emerald">Mağazaya bax →</Link></div>
        <ul className="divide-y divide-line">{group.items.map(item => {
          const current = Number(item.effectivePrice) || 0, original = Number(item.effectiveBasePrice) || 0;
          const stock = item.product.inventory.find(row => row.variantId === item.variantId), available = stock ? Math.max(0, stock.quantity - stock.reserved) : 0;
          const image = item.variant?.images?.[0] || item.product.images[0];
          const options = Object.entries(item.variant?.options || {}).map(([key, value]) => `${key}: ${String(value)}`).join(" · ");
          return <li key={item.id} className="grid grid-cols-[72px_1fr] gap-4 p-4 sm:grid-cols-[88px_1fr_auto] sm:items-center sm:p-5">
            <Link href={`/products/${item.productId}`} className="flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-xl bg-[#efeee9] text-center text-[10px] text-muted sm:h-[88px] sm:w-[88px]">{image ? <img src={image} alt={item.product.name} className="h-full w-full object-cover"/> : "Şəkil yoxdur"}</Link>
            <div className="min-w-0"><Link href={`/products/${item.productId}`} className="font-medium text-ink hover:text-emerald">{item.product.name}</Link>{item.variant && <p className="mt-1 text-xs text-muted">{item.variant.name}{options ? ` · ${options}` : ""}</p>}
              <p className="mt-2 text-sm">Vahid qiymət: <b>{money(current)}</b>{current < original && <span className="ml-2 text-xs text-slate-400 line-through">{money(original)}</span>}</p>{item.activePromotionName && <p className="mt-1 text-xs text-[#85621d]">Kampaniya · {item.activePromotionName}</p>}<p className="mt-1 font-semibold">Cəmi: {money(current * item.quantity)}</p><p className={item.purchasable && item.available >= item.quantity ? "mt-1 text-xs text-emerald-700" : "mt-1 text-xs text-red-700"}>{item.purchasable ? `Mövcud stok: ${item.available}` : item.unavailableReason || "Seçilən məhsul və ya variant artıq sifariş üçün mövcud deyil."}</p>
              <div className="mt-3 flex items-center gap-2 sm:hidden"><QuantityControl item={item} available={available} busy={busy === item.id} onUpdate={update}/><button aria-label="Məhsulu səbətdən sil" onClick={() => void update(item)} disabled={busy === item.id} className="rounded-lg p-2 text-muted hover:bg-paper hover:text-red-700"><Trash2 size={16}/></button></div>
            </div><div className="hidden items-center gap-4 sm:flex"><QuantityControl item={item} available={available} busy={busy === item.id} onUpdate={update}/><span className="w-24 text-right font-semibold">{money(current * item.quantity)}</span><button aria-label="Məhsulu səbətdən sil" onClick={() => void update(item)} disabled={busy === item.id} className="rounded-lg p-2 text-muted hover:bg-paper hover:text-red-700"><Trash2 size={16}/></button></div>
          </li>;
        })}</ul></section>)}</div>
      <aside className="h-fit space-y-4 lg:sticky lg:top-36"><section className="rounded-2xl border border-line bg-white p-5"><h2 className="text-lg font-semibold">Sifariş xülasəsi</h2><div className="mt-5 flex justify-between text-sm text-muted"><span>{groups.length} mağazadan məhsullar</span><span>{money(subtotal)}</span></div><div className="mt-4 flex justify-between border-t border-line pt-4 text-lg font-semibold"><span>Cəmi</span><span>{money(subtotal)}</span></div><p className="mt-3 text-xs leading-5 text-muted">Çatdırılma xərci ünvan və sifariş təsdiqi mərhələsində dəqiqləşdiriləcək.</p><Link aria-disabled={!canCheckout} href={canCheckout ? "/checkout" : "/cart"} className={`mt-5 block rounded-full px-5 py-3.5 text-center text-sm font-medium text-white ${canCheckout ? "bg-ink hover:bg-emerald" : "cursor-not-allowed bg-slate-400"}`} onClick={event => { if (!canCheckout) event.preventDefault(); }}>Sifarişi rəsmiləşdir</Link>{!canCheckout && <p className="mt-2 text-xs text-red-700">Mövcud olmayan və ya stoku dəyişmiş məhsulları silin və ya miqdarını yeniləyin.</p>}<Link href="/products" className="mt-4 block text-center text-sm text-muted hover:text-emerald">Alış-verişə davam et</Link></section><div className="rounded-2xl bg-[#edf1ed] p-5 text-sm leading-6 text-muted">Səbətdəki məhsullar fərqli mağazalara aid ola bilər. Hər mağaza öz məhsullarını ayrıca hazırlayır.</div></aside>
    </div>
  </div>;
}

function QuantityControl({ item, available, busy, onUpdate }: { item: CartItem; available: number; busy: boolean; onUpdate: (item: CartItem, quantity?: number) => void }) {
  return <div className="flex items-center rounded-lg border border-line"><button aria-label="Miqdarı azalt" disabled={busy || item.quantity <= 1} onClick={() => onUpdate(item, item.quantity - 1)} className="p-2 disabled:opacity-40"><Minus size={14}/></button><span className="min-w-8 text-center text-sm">{item.quantity}</span><button aria-label="Miqdarı artır" disabled={busy || item.quantity >= available} onClick={() => onUpdate(item, item.quantity + 1)} className="p-2 disabled:opacity-40"><Plus size={14}/></button></div>;
}
