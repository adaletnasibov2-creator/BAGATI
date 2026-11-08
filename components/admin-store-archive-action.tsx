"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Props = { storeId: string; storeName: string; redirectToList?: boolean; compact?: boolean; showArchive?: boolean };
type StoreAction = "archive" | "delete";

export default function AdminStoreArchiveAction({ storeId, storeName, redirectToList = true, compact = false, showArchive = true }: Props) {
  const router = useRouter();
  const busyRef = useRef(false);
  const [action, setAction] = useState<StoreAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function confirmAction() {
    if (!action || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        action === "archive"
          ? `/api/admin/stores/${encodeURIComponent(storeId)}/archive`
          : `/api/admin/stores/${encodeURIComponent(storeId)}`,
        { method: action === "archive" ? "POST" : "DELETE" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Mağaza əməliyyatını tamamlamaq mümkün olmadı.");
      setMessage(result.message || (action === "archive" ? "Mağaza satışdan deaktiv edildi." : "Mağaza sistemdən çıxarıldı."));
      setAction(null);
      if (action === "delete" && redirectToList) router.replace("/admin/stores");
      else router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Mağaza əməliyyatını tamamlamaq mümkün olmadı.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return <div className={compact ? "grid justify-items-start gap-2" : "mt-5 border-t border-red-100 pt-4"}>
    <div className="flex flex-wrap gap-2">
      {showArchive && <button type="button" onClick={() => { setError(""); setAction("archive"); }} className="rounded-xl border border-amber-200 px-4 py-2.5 text-sm font-semibold text-amber-900 hover:bg-amber-50">
        Arxivləşdir / satışdan çıxar
      </button>}
      <button type="button" onClick={() => { setError(""); setAction("delete"); }} className={`rounded-xl border border-red-200 px-4 ${compact ? "py-2 text-xs" : "py-2.5 text-sm"} font-semibold text-red-800 hover:bg-red-50`}>
        Sil
      </button>
    </div>
    {!compact && <p className="mt-2 text-xs leading-5 text-slate-500">
      Silmə təsdiqindən sonra əlaqəli tarixçəsi olan mağaza satışdan çıxarılıb arxivlənir; tarixçə yoxdursa fiziki silinir. Arxiv əməliyyatı bütün əlaqəli qeydləri qoruyur.
    </p>}
    {message && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    {error && !action && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {action && <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/50 p-4" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setAction(null); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="store-action-title" className="w-full max-w-md rounded-2xl border border-[#e7e3d9] bg-white p-5 shadow-2xl sm:p-6">
        <h2 id="store-action-title" className="text-lg font-semibold text-[#142d38]">{action === "archive" ? "Mağazanı arxivləşdir" : "Mağazanı sil"}</h2>
        <p className="mt-3 text-sm text-slate-700">“{storeName}” mağazası üçün bu əməliyyatı təsdiqləyirsiniz?</p>
        <p className="mt-2 text-sm leading-6 text-slate-600">{action === "archive" ? "Mağaza ictimai satışdan çıxarılacaq. Sifariş və maliyyə tarixçəsi qorunacaq." : "Mağaza aktiv sistemdən çıxarılacaq. Əlaqəli sifariş və maliyyə qeydləri varsa qorunacaq; tarixçə yoxdursa mağaza daimi silinə bilər."}</p>
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" disabled={busy} onClick={() => setAction(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 disabled:opacity-50">Ləğv et</button>
          <button type="button" disabled={busy} onClick={() => void confirmAction()} className="rounded-xl bg-red-800 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Gözləyin…" : action === "archive" ? "Arxivləşdir" : "Sil"}</button>
        </div>
      </section>
    </div>}
  </div>;
}
