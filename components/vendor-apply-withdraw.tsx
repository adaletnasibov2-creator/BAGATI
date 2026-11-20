"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/** Withdraw the applicant's own PENDING application, after an explicit confirmation step. */
/** `confirmText` comes from the server page (built from the configured wait in hours). */
export default function VendorApplyWithdraw({ applicationId, confirmText }: { applicationId: string; confirmText: string }) {
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

  return <div className="mt-5 border-t border-line pt-5">
    {!confirming
      ? <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>Müraciəti geri götür</Button>
      : <div className="grid gap-3 rounded-control bg-surface-page p-4">
        <p className="text-sm text-slate-700">{confirmText}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="danger" size="sm" loading={busy} loadingLabel="Göndərilir…" onClick={withdraw}>Bəli, geri götür</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>İmtina</Button>
        </div>
      </div>}
    {error && <p role="alert" className="mt-3 rounded-control bg-danger-subtle px-4 py-3 text-sm font-medium text-danger">{error}</p>}
  </div>;
}
