"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck, ChevronRight } from "lucide-react";

type Item = { id: string; title: string; body: string; readAt: string | null; createdAt: string; href: string | null };

export default function VendorNotificationsPanel({ storeId }: { storeId: string }) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const base = `/api/vendor/${encodeURIComponent(storeId)}/notifications`;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${base}${filter === "unread" ? "?filter=unread" : ""}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Bildirişləri yükləmək mümkün olmadı.");
      setItems(data.items || []);
      setUnread(data.unread || 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Bildirişləri yükləmək mümkün olmadı.");
    } finally {
      setLoading(false);
    }
  }, [base, filter]);

  useEffect(() => { void load(); }, [load]);

  async function markRead(body: { id: string } | { all: true }) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(base, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Bildiriş yenilənmədi.");
      const now = new Date().toISOString();
      setUnread(data.unread ?? 0);
      setItems((current) => filter === "unread"
        ? current.filter((item) => "all" in body ? false : item.id !== body.id)
        : current.map((item) => ("all" in body || item.id === body.id) && !item.readAt ? { ...item, readAt: now } : item));
      router.refresh(); // keeps the header unread badge in sync
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Bildiriş yenilənmədi.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="mt-5 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="tablist" aria-label="Bildiriş filtri" className="inline-flex rounded-xl border border-[#ded9cf] bg-white p-1 text-sm">
        {(["all", "unread"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)} className={`min-h-10 rounded-lg px-4 font-medium transition ${filter === value ? "bg-[#173c40] text-white" : "text-[#536273] hover:bg-[#f4f2ed]"}`}>{value === "all" ? "Hamısı" : `Oxunmamış (${unread})`}</button>)}
      </div>
      <button type="button" disabled={busy || unread === 0} onClick={() => void markRead({ all: true })} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#ded9cf] bg-white px-4 text-sm font-medium text-[#173c40] disabled:cursor-not-allowed disabled:opacity-50"><CheckCheck size={16} aria-hidden="true"/> Hamısını oxunmuş et</button>
    </div>
    {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    {loading ? <div className="rounded-2xl border border-[#e9e4da] bg-white p-6 text-sm text-slate-500" role="status">Bildirişlər yüklənir…</div>
      : items.length === 0 ? <div className="rounded-2xl border border-[#e9e4da] bg-white p-8 text-center"><Bell className="mx-auto text-slate-300" size={26} aria-hidden="true"/><p className="mt-2 text-sm font-medium text-[#344254]">{filter === "unread" ? "Oxunmamış bildiriş yoxdur" : "Hələ bildiriş yoxdur"}</p><p className="mt-1 text-xs text-slate-500">Yeni sifarişlər, anbar xəbərdarlıqları və qaytarılma sorğuları burada görünəcək.</p></div>
      : <ul className="divide-y divide-[#eeeae2] overflow-hidden rounded-2xl border border-[#e9e4da] bg-white">
        {items.map((item) => <li key={item.id} className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5 ${item.readAt ? "" : "bg-[#fbf8f0]"}`}>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 font-semibold text-[#142d38]">{!item.readAt && <span className="h-2 w-2 shrink-0 rounded-full bg-[#c9973a]" aria-label="Yeni"/>}<span className="break-words">{item.title}</span></p>
            <p className="mt-1 break-words text-sm text-slate-600">{item.body}</p>
            <p className="mt-2 text-xs text-slate-400"><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString("az-AZ")}</time> · {item.readAt ? "Oxunub" : "Oxunmayıb"}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {item.href && <Link href={item.href} onClick={() => { if (!item.readAt) void markRead({ id: item.id }); }} className="inline-flex min-h-10 items-center gap-1 rounded-xl bg-[#173c40] px-3 text-sm font-medium text-white">Bax <ChevronRight size={15} aria-hidden="true"/></Link>}
            {!item.readAt && <button type="button" disabled={busy} onClick={() => void markRead({ id: item.id })} className="min-h-10 rounded-xl border border-[#ded9cf] px-3 text-sm text-[#173c40] disabled:opacity-50">Oxunmuş et</button>}
          </div>
        </li>)}
      </ul>}
  </section>;
}
