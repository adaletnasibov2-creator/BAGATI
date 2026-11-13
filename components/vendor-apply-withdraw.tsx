"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Withdraw the applicant's own PENDING application, after an explicit confirmation step. */
export default function VendorApplyWithdraw({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function withdraw() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/vendor/apply/withdraw", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ applicationId }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Müraciəti geri götürmək mümkün olmadı.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Müraciəti geri götürmək mümkün olmadı.");
      setBusy(false);
    }
  }

  return <div className="mt-5 border-t border-[#eeeae2] pt-4">
    {!confirming
      ? <button type="button" onClick={() => setConfirming(true)} className="rounded-xl border border-[#ded9cf] px-4 py-2.5 text-sm font-medium text-slate-700">Müraciəti geri götür</button>
      : <div className="grid gap-3">
        <p className="text-sm text-slate-700">Müraciəti geri götürsəniz, yeni müraciəti ən tezi 24 saat sonra göndərə bilərsiniz. Davam edilsin?</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={withdraw} className="rounded-xl bg-red-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Göndərilir…" : "Bəli, geri götür"}</button>
          <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="rounded-xl border border-[#ded9cf] px-4 py-2.5 text-sm">İmtina</button>
        </div>
      </div>}
    {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
  </div>;
}
