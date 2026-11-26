"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirmDialog } from "@/components/admin-ui/confirm-dialog";
import { buttonClass } from "@/components/admin-ui/styles";
import { cityStatusButtonLabel, cityStatusConfirm, cityStatusPayload } from "@/lib/admin-city-status";

/**
 * ADMIN-3-TODAY-1: one button per city on /admin/cities that does what its label says ("Deaktiv et" on an active city,
 * "Aktiv et" on an inactive one). Deactivating asks the owner-approved question first. Messages reuse the wording of
 * AdminMutationForm ("Gözləyin…", "Dəyişiklik yadda saxlanıldı.", "Əməliyyat tamamlanmadı").
 */
export function AdminCityStatusButton({ cityId, isActive }: { cityId: string; isActive: boolean }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirmDialog();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function toggle() {
    if (busy) return;
    const question = cityStatusConfirm(isActive);
    if (question && !(await confirm(question))) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const response = await fetch("/api/admin/cities", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cityStatusPayload(cityId, isActive)) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Əməliyyat tamamlanmadı");
      setSuccess(result.message || "Dəyişiklik yadda saxlanıldı.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Əməliyyat tamamlanmadı");
    } finally {
      setBusy(false);
    }
  }

  return <div className="mt-2 grid gap-2">{dialog}
    <button type="button" disabled={busy} onClick={() => void toggle()} className={buttonClass("secondary")}>{busy ? "Gözləyin…" : cityStatusButtonLabel(isActive)}</button>
    {error && <p role="alert" className="rounded-control bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {success && <p role="status" className="rounded-control bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}
  </div>;
}
