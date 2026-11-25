"use client";

import { useId, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { CATEGORY_ICONS, searchCategoryIcons, type CategoryIconKey } from "@/lib/category-icons";
import { inputClass } from "@/components/admin-ui/styles";

/** Searchable grid of the allowlisted icons (key or Azerbaijani word), with "no icon". */
export function AdminCategoryIconPicker({ value, onChange }: { value: string | null; onChange: (key: CategoryIconKey | null) => void }) {
  const [query, setQuery] = useState("");
  const keys = useMemo(() => searchCategoryIcons(query), [query]);
  const searchId = useId();
  const tile = "grid min-h-12 min-w-0 place-items-center gap-0.5 rounded-control border p-1.5 text-[.65rem] leading-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus";
  return (
    <div className="grid gap-2">
      <label htmlFor={searchId} className="text-sm">İkon axtar</label>
      <input id={searchId} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="məs. pişik, telefon, Car" className={inputClass} />
      <div role="group" aria-label="İkonlar" className="grid max-h-64 grid-cols-4 gap-1.5 overflow-y-auto rounded-control border border-line bg-surface-page p-2 min-[420px]:grid-cols-6 sm:grid-cols-8">
        <button type="button" aria-pressed={value === null} onClick={() => onChange(null)} className={`${tile} ${value === null ? "border-primary bg-white font-semibold" : "border-transparent bg-white/60 hover:bg-white"}`}>
          <span aria-hidden="true" className="text-base">—</span><span>İkon yoxdur</span>
        </button>
        {keys.map((key) => {
          const { Icon, label } = CATEGORY_ICONS[key];
          const selected = value === key;
          return (
            <button key={key} type="button" aria-pressed={selected} title={`${label} (${key})`} onClick={() => onChange(key)} className={`${tile} relative ${selected ? "border-primary bg-white font-semibold" : "border-transparent bg-white/60 hover:bg-white"}`}>
              <Icon aria-hidden="true" size={20} strokeWidth={1.8} className="text-primary-hover" />
              <span className="w-full truncate text-center">{label}</span>
              {selected && <Check aria-hidden="true" size={12} className="absolute right-1 top-1 text-primary" />}
            </button>
          );
        })}
      </div>
      {!keys.length && <p className="text-xs text-fg-secondary">Uyğun ikon tapılmadı.</p>}
    </div>
  );
}
