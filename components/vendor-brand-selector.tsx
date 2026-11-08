"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

type BrandOption = { id: string; name: string };

export default function VendorBrandSelector({ brands, value, onChange, name = "brandId" }: { brands: BrandOption[]; value: string; onChange: (brandId: string) => void; name?: string }) {
  const selected = brands.find(brand => brand.id === value);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = `brand-options-${name}`;
  const searchId = `brand-search-${name}`;

  useEffect(() => { if (!open) setQuery(""); }, [open]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("az-AZ");
    return brands.filter(brand => !needle || brand.name.toLocaleLowerCase("az-AZ").includes(needle));
  }, [brands, query]);

  function choose(brand: BrandOption) {
    onChange(brand.id);
    setOpen(false);
  }

  return <div className="relative grid gap-1 text-sm">
    <span>Brend</span>
    <input type="hidden" name={name} value={value}/>
    <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-[#ded9cf] bg-white px-3 py-2.5 text-left text-sm" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} onClick={() => { setOpen(current => !current); setActiveIndex(0); }}>
      <span className={selected ? "text-[#142d38]" : "text-slate-500"}>{selected?.name || "Brend axtar və seç..."}</span>
      <ChevronDown size={16} aria-hidden="true" className={`shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}/>
    </button>
    {open && <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-xl border border-[#ded9cf] bg-white p-2 shadow-lg">
      <label htmlFor={searchId} className="relative block"><Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input id={searchId} autoFocus className="w-full rounded-lg border border-[#e8e4da] bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-[#173c40]" value={query} placeholder="Brend axtar..." onChange={event => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
        else if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex(index => Math.min(index + 1, Math.max(0, filtered.length - 1))); }
        else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex(index => Math.max(0, index - 1)); }
        else if (event.key === "Enter" && filtered[activeIndex]) { event.preventDefault(); choose(filtered[activeIndex]); }
      }}/></label>
      <div id={listId} role="listbox" aria-label="Brendlər" className="mt-2 max-h-56 overflow-auto">
        {filtered.length ? filtered.map((brand, index) => <button key={brand.id} type="button" role="option" aria-selected={brand.id === value} onClick={() => choose(brand)} onMouseEnter={() => setActiveIndex(index)} className={`flex min-h-10 w-full items-center justify-between rounded-lg px-3 py-2 text-left ${index === activeIndex ? "bg-[#f3f8f5] text-[#173c40]" : "hover:bg-[#f8f7f4]"}`}>
          <span>{brand.name}</span>{brand.id === value && <Check size={16} aria-hidden="true"/>}
        </button>) : <p className="px-3 py-3 text-sm text-slate-500">Brend tapılmadı</p>}
      </div>
    </div>}
    {value && <button type="button" onClick={() => onChange("")} className="justify-self-start text-xs text-slate-500 underline">Brend seçimini təmizlə</button>}
  </div>;
}
