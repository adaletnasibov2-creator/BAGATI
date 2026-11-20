"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { vendorInput } from "@/components/vendor-form";

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

  return <div className="relative grid min-w-0 gap-1.5 text-sm">
    <span className="font-medium text-fg">Brend</span>
    <input type="hidden" name={name} value={value}/>
    <button type="button" className={`${vendorInput} flex items-center justify-between gap-3 text-left`} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} onClick={() => { setOpen(current => !current); setActiveIndex(0); }}>
      <span className={`min-w-0 truncate ${selected ? "text-fg" : "text-fg-muted"}`}>{selected?.name || "Brend axtar və seç..."}</span>
      <ChevronDown size={16} aria-hidden="true" className={`shrink-0 text-fg-muted transition-transform ${open ? "rotate-180" : ""}`}/>
    </button>
    {open && <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-control border border-line bg-white p-2 shadow-overlay">
      <label htmlFor={searchId} className="relative block"><Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"/><input id={searchId} autoFocus className="min-h-11 w-full rounded-control border border-line-strong bg-white py-2 pl-9 pr-3 text-sm text-fg focus:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus" value={query} placeholder="Brend axtar..." onChange={event => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
        else if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex(index => Math.min(index + 1, Math.max(0, filtered.length - 1))); }
        else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex(index => Math.max(0, index - 1)); }
        else if (event.key === "Enter" && filtered[activeIndex]) { event.preventDefault(); choose(filtered[activeIndex]); }
      }}/></label>
      <div id={listId} role="listbox" aria-label="Brendlər" className="mt-2 max-h-56 overflow-auto">
        {filtered.length ? filtered.map((brand, index) => <button key={brand.id} type="button" role="option" aria-selected={brand.id === value} onClick={() => choose(brand)} onMouseEnter={() => setActiveIndex(index)} className={`flex min-h-11 w-full items-center justify-between rounded-control px-3 py-2 text-left ${index === activeIndex ? "bg-primary-subtle text-primary" : "text-fg hover:bg-primary-subtle"}`}>
          <span>{brand.name}</span>{brand.id === value && <Check size={16} aria-hidden="true"/>}
        </button>) : <p className="px-3 py-3 text-sm text-fg-muted">Brend tapılmadı</p>}
      </div>
    </div>}
    {value && <button type="button" onClick={() => onChange("")} className="inline-flex min-h-8 items-center justify-self-start text-xs font-medium text-primary underline underline-offset-2">Brend seçimini təmizlə</button>}
  </div>;
}
