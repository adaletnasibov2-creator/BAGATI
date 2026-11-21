"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { cx, focusRing } from "@/components/ui/cx";
import { controlClass } from "@/components/ui/field";

type Option = { id: string; name: string };
type Result = { items: Option[]; hasNext: boolean; hasPrevious: boolean; nextCursor: string | null; previousCursor: string | null };

export function StoreFilterSelect({ initialOptions, initialSelected, city }: { initialOptions: Option[]; initialSelected: string; city: string }) {
  const [options, setOptions] = useState(initialOptions);
  const [selected, setSelected] = useState(initialSelected);
  const [term, setTerm] = useState("");
  const [activeTerm, setActiveTerm] = useState("");
  const [page, setPage] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function search(cursor?: string, searchTerm = term.trim()) {
    const query = searchTerm.trim();
    if (query.length > 80) { setError("Mağaza axtarışı 80 simvoldan uzun ola bilməz."); return; }
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (city) params.set("city", city);
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/store-options?${params}`, { headers: { Accept: "application/json" } });
      const data = await response.json() as Result & { error?: string };
      if (!response.ok) throw new Error(data.error || "Mağazaları yükləmək mümkün olmadı.");
      const selectedOption = options.find((option) => option.id === selected);
      setOptions(selectedOption && !data.items.some((option) => option.id === selectedOption.id)
        ? [...data.items, selectedOption]
        : data.items);
      setPage(data);
      setActiveTerm(query);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Mağazaları yükləmək mümkün olmadı.");
    } finally { setBusy(false); }
  }

  // DESIGN-T10: shared control style and buttons (visible focus ring, busy state); texts and requests unchanged.
  return <div className="grid min-w-0 gap-2" aria-busy={busy || undefined}>
    <label htmlFor="store-filter-search" className="text-xs font-medium text-fg-secondary">Mağaza axtarışı</label>
    <div className="flex gap-2">
      <input id="store-filter-search" value={term} onChange={(event) => setTerm(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} placeholder="Mağaza adı" maxLength={80} className={cx(controlClass(), "min-w-0 flex-1")} />
      <button type="button" onClick={() => void search()} disabled={busy} aria-busy={busy || undefined} className={cx(buttonClass({ variant: "secondary", size: "sm", pill: false }), "min-h-12 shrink-0")}>{busy ? "Axtarılır…" : "Axtar"}</button>
    </div>
    <select name="store" value={selected} onChange={(event) => setSelected(event.target.value)} className={cx(controlClass(), "cursor-pointer")}>
      <option value="">Bütün mağazalar</option>
      {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
    </select>
    {page && <div className="flex items-center justify-between gap-2 text-xs text-fg-muted">
      <span>{page.items.length ? `“${activeTerm || "bütün"}” üzrə ${page.items.length} nəticə` : "Uyğun mağaza tapılmadı"}</span>
      <span className="flex gap-2">
        {page.hasPrevious && page.previousCursor && <button type="button" disabled={busy} onClick={() => void search(page.previousCursor!, activeTerm)} className={cx("min-h-11 rounded-sm underline disabled:opacity-60", focusRing)}>Əvvəlki</button>}
        {page.hasNext && page.nextCursor && <button type="button" disabled={busy} onClick={() => void search(page.nextCursor!, activeTerm)} className={cx("min-h-11 rounded-sm underline disabled:opacity-60", focusRing)}>Daha çox</button>}
      </span>
    </div>}
    {error && <p role="alert" className="text-xs font-medium text-danger">{error}</p>}
  </div>;
}
