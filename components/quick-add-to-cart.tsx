"use client";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ShoppingBag } from "lucide-react";
export function QuickAddToCart({ productId, stock }: { productId: string; stock?: number }) {
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false); const router = useRouter(); const pathname = usePathname();
  const outOfStock = stock !== undefined && stock <= 0;
  async function add() { setBusy(true); setMessage(""); try { const detail = await fetch(`/api/products/${productId}`); if (!detail.ok) { setMessage("Məhsul artıq əlçatan deyil."); return; } const item = (await detail.json()).item; if (item.variants?.length) { router.push(`/products/${productId}`); return; } const r = await fetch("/api/cart/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId, quantity: 1 }) }); const data = await r.json(); if (r.status === 401) { router.push(`/login?next=${encodeURIComponent(pathname)}`); return; } if (!r.ok) { setMessage(data.error || "Məhsulu səbətə əlavə etmək mümkün olmadı."); return; } setMessage("Səbətə əlavə edildi."); } catch { setMessage("Bağlantı xətası. Yenidən cəhd edin."); } finally { setBusy(false); } }
  return <div><button type="button" onClick={() => void add()} disabled={busy || outOfStock} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#174746] px-3 text-xs font-semibold text-white transition hover:bg-[#23635D] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2F6F68] disabled:cursor-not-allowed disabled:opacity-50"><ShoppingBag size={15}/>{busy ? "Əlavə olunur…" : outOfStock ? "Stokda yoxdur" : "Səbətə əlavə et"}</button>{message && <p className="mt-1 text-center text-[.68rem] text-[#697875]" role="status">{message}</p>}</div>;
}
