import type { ReactNode } from "react";

/**
 * Admin list filter bar (GET form). Server component. The search box and every select show the values currently
 * applied (from the URL), so after "Filtrlə" the form shows what the list is filtered by.
 */
export function Filters({ path, q = "", children }: { path: string; q?: string; children?: ReactNode }) {
  return <form action={path} className="mb-4 flex flex-wrap items-end gap-3 rounded-2xl border border-[#e7e3d9] bg-white p-4">
    <label className="grid min-w-48 flex-1 gap-1 text-xs text-slate-500">Axtarış<input name="q" defaultValue={q} placeholder="Axtar…" className="rounded-lg border border-[#ded9cf] px-3 py-2.5 text-sm text-slate-800"/></label>
    {children}
    <button className="rounded-lg bg-[#173c40] px-4 py-2.5 text-sm font-semibold text-white">Filtrlə</button>
  </form>;
}

/** Select for a GET filter; `selected` is the applied value (an unknown value falls back to "Hamısı"). */
export function FilterSelect({ name, label, values, selected = "" }: { name: string; label: string; values: { id: string; name: string }[]; selected?: string }) {
  const value = values.some((item) => item.id === selected) ? selected : "";
  return <label className="grid min-w-36 gap-1 text-xs text-slate-500">{label}<select name={name} defaultValue={value} className="rounded-lg border border-[#ded9cf] bg-white px-3 py-2.5 text-sm text-slate-800"><option value="">Hamısı</option>{values.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;
}
