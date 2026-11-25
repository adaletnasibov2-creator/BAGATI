"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { ADMIN_POWER_1_TEXT as T, ADMIN_SEARCH_MIN_LENGTH } from "@/lib/admin-power-1";
import type { AdminSearchHit, AdminSearchResult } from "@/lib/admin-global-search";

/**
 * ADMIN-POWER-1: the top-bar admin search (GET /api/admin/search). Waits 250 ms after typing, cancels the previous
 * request, needs 2 characters, shows grouped links (stores, products, orders, accounts). Esc or a click outside
 * closes the results. `onClose` (phone panel) adds a close button.
 */
const GROUPS: { key: keyof AdminSearchResult; label: string }[] = [
  { key: "stores", label: T.groupStores },
  { key: "products", label: T.groupProducts },
  { key: "orders", label: T.groupOrders },
  { key: "users", label: T.groupUsers },
];
const ring = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

type State = { kind: "idle" } | { kind: "short" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "done"; results: AdminSearchResult };

export function AdminGlobalSearch({ autoFocus = false, onClose }: { autoFocus?: boolean; onClose?: () => void }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const resultsId = useId();

  useEffect(() => { if (autoFocus) input.current?.focus(); }, [autoFocus]);

  useEffect(() => {
    const term = query.trim();
    if (!term) { setState({ kind: "idle" }); return; }
    if (term.length < ADMIN_SEARCH_MIN_LENGTH) { setState({ kind: "short" }); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setState({ kind: "loading" });
      try {
        const response = await fetch(`/api/admin/search?q=${encodeURIComponent(term)}`, { signal: controller.signal, headers: { accept: "application/json" } });
        const data = await response.json().catch(() => null) as { results?: AdminSearchResult; error?: string } | null;
        if (!response.ok || !data?.results) { setState({ kind: "error", message: data?.error || T.searchError }); return; }
        setState({ kind: "done", results: data.results });
      } catch (error) {
        if ((error as { name?: string }).name !== "AbortError") setState({ kind: "error", message: T.searchError });
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (box.current && !box.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);

  const groups = state.kind === "done" ? GROUPS.map((group) => ({ ...group, hits: state.results[group.key] as AdminSearchHit[] })).filter((group) => group.hits.length) : [];
  const status = state.kind === "short" ? T.searchMin : state.kind === "loading" ? T.searchLoading : state.kind === "error" ? state.message : state.kind === "done" && !groups.length ? T.searchEmpty : "";
  const showPanel = open && state.kind !== "idle";

  return <div ref={box} className="relative w-full" onKeyDown={(event) => { if (event.key === "Escape") { if (showPanel) setOpen(false); else onClose?.(); } }}>
    <div className="flex items-center gap-2">
      <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-surface-page px-3.5 text-fg-muted transition-colors focus-within:border-primary focus-within:bg-white focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus">
        <Search size={16} aria-hidden="true" />
        <input
          ref={input}
          type="search"
          value={query}
          aria-label={T.searchLabel}
          aria-controls={resultsId}
          aria-expanded={showPanel}
          autoComplete="off"
          maxLength={120}
          placeholder={T.searchPlaceholder}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          className="min-w-0 flex-1 bg-transparent py-2 text-sm text-fg outline-none placeholder:text-fg-muted focus-visible:outline-none"
        />
      </label>
      {onClose && <button type="button" aria-label={T.searchClose} onClick={onClose} className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line-strong text-fg hover:border-primary ${ring}`}><X size={18} aria-hidden="true" /></button>}
    </div>
    <div id={resultsId} hidden={!showPanel} className="absolute inset-x-0 top-full z-40 mt-2 max-h-[70vh] overflow-y-auto rounded-card border border-line bg-white p-2 shadow-overlay">
      <p role="status" className={status ? "px-3 py-2 text-sm text-fg-secondary" : "sr-only"}>{status}</p>
      {groups.map((group) => <section key={group.key} className="py-1">
        <h3 className="px-3 pb-1 pt-2 text-kicker uppercase text-gold-700">{group.label}</h3>
        <ul>{group.hits.map((hit) => <li key={hit.id}><Link href={hit.href} onClick={() => { setOpen(false); onClose?.(); }} className={`block rounded-control px-3 py-2 transition-colors hover:bg-primary-subtle ${ring}`}>
          <span className="block truncate text-sm font-semibold text-fg">{hit.title}</span>
          <span className="block truncate text-xs text-fg-secondary">{hit.detail}</span>
        </Link></li>)}</ul>
      </section>)}
    </div>
  </div>;
}
