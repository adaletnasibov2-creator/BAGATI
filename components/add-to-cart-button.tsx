"use client";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ShoppingBag } from "lucide-react";
type Variant = { id: string; name: string; options?: Record<string, unknown>; available: number };
export function AddToCartButton({ productId, variants, stock }: { productId: string; variants: Variant[]; stock: number }) {
  const [variantId, setVariantId] = useState(variants[0]?.id ?? ""); const [quantity, setQuantity] = useState(1); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const router = useRouter(); const pathname = usePathname(); const available = variants.length ? variants.find(v => v.id === variantId)?.available ?? 0 : stock;
  async function add() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/cart/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId, ...(variantId ? { variantId } : {}), quantity }) });
      const result = await response.json();
      if (response.status === 401) { router.push(`/login?next=${encodeURIComponent(pathname)}`); return; }
      if (!response.ok) { setMessage(result.error ?? "Məhsul səbətə əlavə edilmədi."); return; }
      setMessage("Məhsul səbətə əlavə edildi.");
    } catch { setMessage("Bağlantı xətası. Yenidən cəhd edin."); }
    finally { setBusy(false); }
  }
  return <div className="mt-7 space-y-3">
    {variants.length > 0 && <label className="block text-sm font-medium">Variant<select value={variantId} onChange={event => setVariantId(event.target.value)} className="mt-2 block w-full rounded-xl border border-line bg-white px-4 py-3">{variants.map(variant => { const attributes = Object.entries(variant.options || {}).map(([key,value]) => `${key}: ${String(value)}`).join(", "); return <option key={variant.id} value={variant.id}>{variant.name}{attributes ? ` · ${attributes}` : ""}{variant.available <= 0 ? " — stokda yoxdur" : ""}</option>; })}</select></label>}
    <div className="flex items-center gap-3"><label className="sr-only" htmlFor="product-quantity">Miqdar</label><input id="product-quantity" type="number" min={1} max={Math.max(available,1)} value={quantity} onChange={event => setQuantity(Math.max(1, Math.min(available || 1, Number(event.target.value))))} className="w-20 rounded-xl border border-line bg-white px-3 py-3 text-center"/><button onClick={add} disabled={available < 1 || busy} className="flex flex-1 items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 font-medium text-white hover:bg-emerald disabled:cursor-not-allowed disabled:opacity-40"><ShoppingBag size={17}/>{busy ? "Əlavə olunur…" : "Səbətə əlavə et"}</button></div>
    <p className="text-sm text-muted" aria-live="polite">{message || (available > 0 ? `${available} ədəd stokda` : "Hazırda stokda yoxdur")}</p>
  </div>;
}
