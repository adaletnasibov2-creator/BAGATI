"use client";
import { useEffect, useState } from "react";
import { HeartIcon } from "@/components/header-icons";

const KEY = "bagati_favorites";
function readFavorites(): string[] { try { const parsed = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []; } catch { return []; } }
export function FavoriteToggle({ productId }: { productId: string }) {
  const [saved, setSaved] = useState(false);
  useEffect(() => { setSaved(readFavorites().includes(productId)); const sync = () => setSaved(readFavorites().includes(productId)); window.addEventListener("bagati:favorites", sync); return () => window.removeEventListener("bagati:favorites", sync); }, [productId]);
  function toggle() { const favorites = readFavorites(); const next = favorites.includes(productId) ? favorites.filter((id) => id !== productId) : [...favorites, productId]; localStorage.setItem(KEY, JSON.stringify(next)); setSaved(next.includes(productId)); window.dispatchEvent(new Event("bagati:favorites")); }
  return <button type="button" aria-label={saved ? "Sevimlilərdən çıxar" : "Sevimlilərə əlavə et"} aria-pressed={saved} onClick={toggle} className="grid h-11 w-11 place-items-center rounded-full border border-line bg-white shadow-subtle transition-[background-color,border-color,transform] duration-150 hover:border-brand-300 hover:bg-brand-50 active:bg-brand-100 motion-safe:active:scale-95 aria-pressed:border-gold-600 aria-pressed:bg-gold-100 aria-pressed:hover:bg-gold-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none"><HeartIcon size={22} filled={saved} /></button>;
}
