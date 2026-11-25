import type { ReactNode } from "react";
import { buttonClass, inputClass } from "@/components/admin-ui/styles";

// ADMIN-DESIGN-1: seller-panel look (card, labels, inputs and the primary button from the admin kit). Same fields.
const filterLabel = "grid gap-1.5 text-xs font-medium text-fg-secondary";

/**
 * Admin list filter bar (GET form). Server component. The search box and every select show the values currently
 * applied (from the URL), so after "Filtrlə" the form shows what the list is filtered by.
 */
export function Filters({ path, q = "", children }: { path: string; q?: string; children?: ReactNode }) {
  return <form action={path} className="mb-4 flex flex-wrap items-end gap-3 rounded-card border border-line bg-white p-4 shadow-subtle">
    <label className={`${filterLabel} min-w-48 flex-1`}>Axtarış<input name="q" defaultValue={q} placeholder="Axtar…" className={inputClass}/></label>
    {children}
    <button className={buttonClass("primary", "min-h-11 max-sm:w-full")}>Filtrlə</button>
  </form>;
}

/** Select for a GET filter; `selected` is the applied value (an unknown value falls back to "Hamısı"). */
export function FilterSelect({ name, label, values, selected = "" }: { name: string; label: string; values: { id: string; name: string }[]; selected?: string }) {
  const value = values.some((item) => item.id === selected) ? selected : "";
  return <label className={`${filterLabel} min-w-36 max-sm:flex-1`}>{label}<select name={name} defaultValue={value} className={inputClass}><option value="">Hamısı</option>{values.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;
}
