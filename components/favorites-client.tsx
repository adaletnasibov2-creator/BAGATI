"use client";
import { useEffect, useState } from "react";
import { ProductCard } from "@/components/product-card";
import { EmptyState } from "@/components/state-panel";
type Product = { id: string; name: string; price: string; discountPrice: string | null; images: string[]; stock:number; store: { name: string } };
export function FavoritesClient() {
  const [products, setProducts] = useState<Product[]>([]), [loaded, setLoaded] = useState(false);
  useEffect(() => { let active = true; async function load() { let ids: string[] = []; try { const value = JSON.parse(localStorage.getItem("bagati_favorites") || "[]"); if (Array.isArray(value)) ids = value.filter((id): id is string => typeof id === "string"); } catch { ids = []; } const records = await Promise.all(ids.map(async (id) => { try { const r = await fetch(`/api/products/${id}`); if (!r.ok) return null; const data = await r.json(); const p = data.item; return { id: p.id, name: p.name, price: String(p.price), discountPrice: p.discountPrice ? String(p.discountPrice) : null, images: p.images || [], stock:(p.inventory||[]).reduce((sum:any,row:any)=>sum+row.quantity-row.reserved,0), store: p.store } as Product; } catch { return null; } })); if (active) { setProducts(records.filter((p): p is Product => p !== null)); setLoaded(true); } } void load(); const sync = () => void load(); window.addEventListener("bagati:favorites", sync); return () => { active = false; window.removeEventListener("bagati:favorites", sync); }; }, []);
  if (!loaded) return <p className="text-sm text-[#667085]">Sevimlilər yüklənir…</p>;
  if (!products.length) return <EmptyState title="Sevimli məhsul yoxdur" detail="Məhsul kartındakı ürək işarəsinə toxunaraq seçimlərini burada saxlaya bilərsən."/>;
  return <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">{products.map((p) => { const discounted=p.discountPrice!==null&&Number(p.discountPrice)>0&&Number(p.discountPrice)<Number(p.price); return <ProductCard key={p.id} id={p.id} name={p.name} price={String(discounted?p.discountPrice:p.price)} originalPrice={discounted?String(p.price):null} store={p.store.name} image={p.images[0]} secondaryImage={p.images[1]} stock={p.stock}/>; })}</div>;
}
