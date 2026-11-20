"use client";
import { PRODUCT_GRID_CLASS } from "@/components/product-layout";
import { useEffect, useState } from "react";
import { ProductCard } from "@/components/product-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { Heart } from "lucide-react";
import { productIdBatches } from "@/lib/product-id-batches";
type Product = { id: string; name: string; price: string; discountPrice: string | null; images: string[]; stock:number; store: { name: string } };
export function FavoritesClient() {
  const [products, setProducts] = useState<Product[]>([]), [loaded, setLoaded] = useState(false);
  useEffect(() => { let active = true; async function load() { let ids: unknown[] = []; try { const value = JSON.parse(localStorage.getItem("bagati_favorites") || "[]"); if (Array.isArray(value)) ids = value; } catch { ids = []; }
    // One request per 50 favorites (GET /api/products?ids=); a failed batch only hides its own products.
    const batches = await Promise.all(productIdBatches(ids).map(async (batch) => { try { const r = await fetch(`/api/products?ids=${batch.map(encodeURIComponent).join(",")}`); if (!r.ok) return []; const data = await r.json(); return (Array.isArray(data.items) ? data.items : []).map((p: any) => ({ id: p.id, name: p.name, price: String(p.price), discountPrice: p.discountPrice ? String(p.discountPrice) : null, images: p.images || [], stock:(p.inventory||[]).reduce((sum:any,row:any)=>sum+row.quantity-row.reserved,0), store: p.store } as Product)); } catch { return []; } }));
    if (active) { setProducts(batches.flat()); setLoaded(true); } } void load(); const sync = () => void load(); window.addEventListener("bagati:favorites", sync); return () => { active = false; window.removeEventListener("bagati:favorites", sync); }; }, []);
  if (!loaded) return <SkeletonRegion label="Sevimlilər yüklənir…" className={PRODUCT_GRID_CLASS}>{[0, 1, 2, 3].map((n) => <Skeleton key={n} rounded="card" className="aspect-[3/4]"/>)}</SkeletonRegion>;
  if (!products.length) return <EmptyState icon={<Heart size={24}/>} title="Sevimli məhsul yoxdur" description="Məhsul kartındakı ürək işarəsinə toxunaraq seçimlərini burada saxlaya bilərsən."/>;
  return <div className={PRODUCT_GRID_CLASS}>{products.map((p) => { const discounted=p.discountPrice!==null&&Number(p.discountPrice)>0&&Number(p.discountPrice)<Number(p.price); return <ProductCard key={p.id} id={p.id} name={p.name} price={String(discounted?p.discountPrice:p.price)} originalPrice={discounted?String(p.price):null} store={p.store.name} image={p.images[0]} secondaryImage={p.images[1]} stock={p.stock}/>; })}</div>;
}
