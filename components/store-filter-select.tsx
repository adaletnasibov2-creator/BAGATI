"use client";

import { useState } from "react";

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

  return <div className="grid gap-2">
    <label htmlFor="store-filter-search" className="text-xs font-medium text-muted">Mağaza axtarışı</label>
    <div className="flex gap-2">
      <input id="store-filter-search" value={term} onChange={(event) => setTerm(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} placeholder="Mağaza adı" maxLength={80} className="min-w-0 flex-1 rounded-xl border border-line bg-white px-3 py-2 text-sm" />
      <button type="button" onClick={() => void search()} disabled={busy} className="rounded-xl border border-line px-3 py-2 text-xs font-medium disabled:opacity-50">{busy ? "Axtarılır…" : "Axtar"}</button>
    </div>
    <select name="store" value={selected} onChange={(event) => setSelected(event.target.value)} className="w-full rounded-xl border border-line bg-white px-3 py-3 text-sm">
      <option value="">Bütün mağazalar</option>
      {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
    </select>
    {page && <div className="flex items-center justify-between gap-2 text-xs text-muted">
      <span>{page.items.length ? `“${activeTerm || "bütün"}” üzrə ${page.items.length} nəticə` : "Uyğun mağaza tapılmadı"}</span>
      <span className="flex gap-2">
        {page.hasPrevious && page.previousCursor && <button type="button" disabled={busy} onClick={() => void search(page.previousCursor!, activeTerm)} className="underline">Əvvəlki</button>}
        {page.hasNext && page.nextCursor && <button type="button" disabled={busy} onClick={() => void search(page.nextCursor!, activeTerm)} className="underline">Daha çox</button>}
      </span>
    </div>}
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
  </div>;
}
