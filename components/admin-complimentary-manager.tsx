"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirmDialog } from "@/components/admin-ui/confirm-dialog";

export type ComplimentaryGrantView = {
  id: string;
  tier: "BASIC" | "PRO";
  endsAt: string | null;
  grantReason: string;
  grantedAt: string;
  grantedBy: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  revokedBy: string | null;
};

function day(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
const shown = (value: string | null) => (value ? new Date(value).toLocaleDateString("az-AZ") : "—");

/** Admin panel for a store's free selling grant ("Ödənişsiz satış (admin icazəsi)"). Every action needs a reason. */
export default function AdminComplimentaryManager({ storeId, grants }: { storeId: string; grants: ComplimentaryGrantView[] }) {
  const router = useRouter();
  const active = grants.find((grant) => !grant.revokedAt) ?? null;
  const ended = Boolean(active?.endsAt && new Date(active.endsAt) <= new Date());
  const [tier, setTier] = useState<"BASIC" | "PRO">(active?.tier ?? "BASIC");
  const { confirm, dialog } = useConfirmDialog();
  const [endsAt, setEndsAt] = useState(day(active?.endsAt ?? null));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(action: "grant" | "change" | "revoke") {
    if (busy) return;
    if (reason.trim().length < 8) { setError("Səbəb yazın (ən azı 8 simvol)."); return; }
    const confirmText = action === "revoke"
      ? "Ödənişsiz satış icazəsi ləğv edilsin? Ödənişli abunəlik yoxdursa, mağaza satışdan çıxacaq."
      : `Ödənişsiz satış: ${tier}${endsAt ? `, bitmə tarixi ${endsAt}` : ", bitmə tarixi yoxdur"}. Davam edilsin?`;
    if (!await confirm(confirmText)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const body = action === "revoke" ? { action, reason: reason.trim() } : { action, tier, endsAt: endsAt || null, reason: reason.trim() };
      const response = await fetch(`/api/admin/stores/${encodeURIComponent(storeId)}/complimentary`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Əməliyyat tamamlanmadı.");
      setMessage(result.message || "Saxlanıldı."); setReason(""); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Əməliyyat tamamlanmadı."); }
    finally { setBusy(false); }
  }

  const input = "w-full rounded-xl border border-[#ded9cf] bg-white px-3.5 py-2.5 text-sm";
  return <section className="mt-5 rounded-2xl border border-[#e7e3d9] bg-white p-5" aria-label="Ödənişsiz satış (admin icazəsi)">{dialog}
    <div className="flex flex-wrap items-start justify-between gap-2">
      <h2 className="font-semibold text-[#142d38]">Ödənişsiz satış (admin icazəsi)</h2>
      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${active && !ended ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
        {active ? (ended ? `Müddəti bitib (${active.tier})` : `Aktiv · ${active.tier}`) : "Yoxdur"}
      </span>
    </div>
    {active && <p className="mt-2 text-sm text-slate-600">
      Bitmə tarixi: {active.endsAt ? shown(active.endsAt) : "yoxdur"} · Verilib: {shown(active.grantedAt)}{active.grantedBy ? ` · ${active.grantedBy}` : ""}<br/>Səbəb: {active.grantReason}
    </p>}
    <p className="mt-2 text-xs leading-5 text-slate-500">Paket BASIC (300 aktiv məhsul) və ya PRO (2 000) ola bilər. Bitmə tarixi boşdursa, icazə ləğv edilənə qədər qüvvədədir; tarix daxil edilərsə, həmin günün 00:00 (UTC) anından satış dayanır. Ödənişli abunəlik ACTIVE saxlanılarsa, bu icazə avtomatik ləğv olunur. Mağaza gizlidirsə, icazədən sonra aktivlik bölməsindən yayımlayın.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-sm">Paket<select className={input} value={tier} onChange={(event) => setTier(event.target.value as "BASIC" | "PRO")}><option value="BASIC">BASIC (300 məhsul)</option><option value="PRO">PRO (2 000 məhsul)</option></select></label>
      <label className="grid gap-1 text-sm">Bitmə tarixi (istəyə bağlı)<input type="date" className={input} value={endsAt} onChange={(event) => setEndsAt(event.target.value)}/></label>
      <label className="grid gap-1 text-sm sm:col-span-2">Səbəb (məcburi)<textarea className={input} rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)}/></label>
    </div>
    <div className="mt-4 flex flex-wrap gap-2">
      {!active && <button type="button" disabled={busy} onClick={() => void submit("grant")} className="rounded-xl bg-[#173c40] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Gözləyin…" : "İcazə ver"}</button>}
      {active && <button type="button" disabled={busy} onClick={() => void submit("change")} className="rounded-xl bg-[#173c40] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Gözləyin…" : "Paketi / tarixi dəyiş"}</button>}
      {active && <button type="button" disabled={busy} onClick={() => void submit("revoke")} className="rounded-xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-800 disabled:opacity-50">Ləğv et</button>}
    </div>
    {message && <p role="status" className="mt-3 text-sm text-emerald-800">{message}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
    {grants.length > 0 && <details className="mt-4">
      <summary className="cursor-pointer text-sm font-medium">Tarixçə ({grants.length})</summary>
      <ul className="mt-2 divide-y rounded-lg border px-3 text-xs">
        {grants.map((grant) => <li key={grant.id} className="py-2">
          <b>{grant.tier}</b> · {shown(grant.grantedAt)} – {grant.revokedAt ? `ləğv: ${shown(grant.revokedAt)}` : grant.endsAt ? `bitmə: ${shown(grant.endsAt)}` : "bitmə tarixi yoxdur"}{grant.grantedBy ? ` · ${grant.grantedBy}` : ""}
          <p className="mt-1 text-slate-600">Səbəb: {grant.grantReason}{grant.revokeReason ? ` · Ləğv səbəbi: ${grant.revokeReason}${grant.revokedBy ? ` (${grant.revokedBy})` : ""}` : ""}</p>
        </li>)}
      </ul>
    </details>}
  </section>;
}
