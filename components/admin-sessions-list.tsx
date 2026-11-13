"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Monitor } from "lucide-react";

export type AdminSessionRow = {
  id: string;
  createdLabel: string;
  lastSeenLabel: string;
  expiresLabel: string;
  ipMasked: string | null;
  userAgent: string | null;
  current: boolean;
};

export default function AdminSessionsList({ sessions }: { sessions: AdminSessionRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const others = sessions.filter((session) => !session.current).length;

  async function act(body: { action: "revoke"; sessionId: string } | { action: "revoke-others" }, confirmText: string) {
    if (!window.confirm(confirmText)) return;
    setBusy(body.action === "revoke" ? body.sessionId : "others"); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Əməliyyat alınmadı.");
      setMessage(data.message);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Əməliyyat alınmadı.");
    } finally {
      setBusy("");
    }
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-slate-500">{sessions.length} aktiv sessiya{others ? `, ${others} digər cihazda` : ""}.</p>
      <button type="button" disabled={!others || busy !== ""} onClick={() => void act({ action: "revoke-others" }, "Cari sessiyadan başqa bütün sessiyalar bağlansın?")} className="rounded-xl bg-[#142d38] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
        {busy === "others" ? "Bağlanır…" : "Bütün digər sessiyaları bağla"}
      </button>
    </div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{message}</p>}
    <ul className="divide-y divide-[#eeeae2] rounded-2xl border border-[#e7e3d9] bg-white">
      {sessions.map((session) => <li key={session.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <Monitor size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-slate-400" />
          <div className="min-w-0 text-sm">
            <p className="font-medium text-[#0d1b2a]">
              {session.userAgent ?? "Naməlum cihaz"}
              {session.current && <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">Bu cihaz</span>}
            </p>
            <p className="mt-1 text-slate-500">IP: <span className="font-mono">{session.ipMasked ?? "məlum deyil"}</span></p>
            <p className="mt-1 text-xs text-slate-500">Yaradılıb: {session.createdLabel} · Son aktivlik: {session.lastSeenLabel} · Bitir: {session.expiresLabel}</p>
          </div>
        </div>
        {!session.current && <button type="button" disabled={busy !== ""} onClick={() => void act({ action: "revoke", sessionId: session.id }, "Bu sessiya bağlansın?")} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-50">
          {busy === session.id ? "Bağlanır…" : "Bağla"}
        </button>}
      </li>)}
    </ul>
    <p className="text-xs text-slate-500">Vaxtlar Bakı vaxtı ilə göstərilir. Admin sessiyası 12 saat, 2 saat fəaliyyətsizlikdən sonra isə avtomatik bitir.</p>
  </div>;
}
