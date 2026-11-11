"use client";
import { useEffect, useState } from "react";
import { Heart } from "lucide-react";

const KEY = "bagati_favorites";
function readFavorites(): string[] { try { const parsed = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []; } catch { return []; } }
export function FavoriteToggle({ productId }: { productId: string }) {
  const [saved, setSaved] = useState(false);
  useEffect(() => { setSaved(readFavorites().includes(productId)); const sync = () => setSaved(readFavorites().includes(productId)); window.addEventListener("bagati:favorites", sync); return () => window.removeEventListener("bagati:favorites", sync); }, [productId]);
  function toggle() { const favorites = readFavorites(); const next = favorites.includes(productId) ? favorites.filter((id) => id !== productId) : [...favorites, productId]; localStorage.setItem(KEY, JSON.stringify(next)); setSaved(next.includes(productId)); window.dispatchEvent(new Event("bagati:favorites")); }
  return <button type="button" aria-label={saved ? "Sevimlilərdən çıxar" : "Sevimlilərə əlavə et"} aria-pressed={saved} onClick={toggle} className="grid h-11 w-11 place-items-center rounded-full border border-[#E4EAE5] bg-white/95 text-[#36534D] transition hover:text-[#8A6A37] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C79A52]"><Heart aria-hidden="true" size={18} className={saved ? "fill-[#E8D7B7] text-[#8A6A37]" : ""}/></button>;
}
