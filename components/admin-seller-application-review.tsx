"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SELLER_APPLICATION_RULES } from "@/lib/seller-application";

const field = "mt-1 w-full rounded-lg border border-[#ded9cf] bg-white px-3 py-2.5 text-sm";

/** Approve or reject one PENDING application. A duplicate VÖEN must be accepted explicitly before approval. */
export default function AdminSellerApplicationReview({ applicationId, duplicateCount, accountReady }: { applicationId: string; duplicateCount: number; accountReady: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"approve" | "reject">("approve");
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [reason, setReason] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    const body = mode === "approve"
      ? { action: "approve", confirmDuplicateVoen: confirmDuplicate, adminNote }
      : { action: "reject", reason, adminNote };
    try {
      const response = await fetch(`/api/admin/seller-applications/${encodeURIComponent(applicationId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Əməliyyat alınmadı.");
      setMessage(result.message || "Yadda saxlanıldı.");
      router.refresh();
    } catch (reasonError) {
      setError(reasonError instanceof Error ? reasonError.message : "Əməliyyat alınmadı.");
    } finally {
      setBusy(false);
    }
  }

  const approveBlocked = mode === "approve" && (!accountReady || (duplicateCount > 0 && !confirmDuplicate));
  const rejectBlocked = mode === "reject" && reason.trim().length < SELLER_APPLICATION_RULES.rejectionReasonMin;

  return <form onSubmit={submit} className="rounded-2xl border border-[#e7e3d9] bg-white p-5">
    <h2 className="font-semibold text-[#0d1b2a]">Qərar</h2>
    <div role="radiogroup" aria-label="Qərar" className="mt-3 grid grid-cols-2 gap-2">
      {(["approve", "reject"] as const).map((value) => <label key={value} className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium ${mode === value ? "border-[#173c40] bg-[#173c40] text-white" : "border-[#ded9cf] text-slate-700"}`}>
        <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="sr-only" />
        {value === "approve" ? "Təsdiqlə" : "Rədd et"}
      </label>)}
    </div>

    {mode === "approve" && <div className="mt-4 grid gap-3 text-sm">
      {!accountReady && <p className="rounded-lg bg-red-50 p-3 text-red-800">Hesab aktiv, e-poçtu təsdiqlənmiş müştəri hesabı deyil. Təsdiq mümkün deyil.</p>}
      <p className="text-slate-600">Təsdiqdən sonra hesab satıcı hesabına çevrilir və satıcı profili bu müraciətin məlumatları ilə yaradılır. Mağaza ictimai satış üçün ayrıca yoxlanılır.</p>
      {duplicateCount > 0 && <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
        <input type="checkbox" checked={confirmDuplicate} onChange={(event) => setConfirmDuplicate(event.target.checked)} className="mt-1" />
        <span>VÖEN-in başqa satıcıda və ya müraciətdə olduğunu yoxladım və təsdiqləyirəm.</span>
      </label>}
    </div>}

    {mode === "reject" && <label className="mt-4 grid gap-1 text-sm">Səbəb (müraciətçi görəcək)
      <textarea value={reason} onChange={(event) => setReason(event.target.value)} required minLength={SELLER_APPLICATION_RULES.rejectionReasonMin} maxLength={SELLER_APPLICATION_RULES.rejectionReasonMax} rows={4} className={field} />
      <span className="text-xs text-slate-500">{reason.trim().length} / {SELLER_APPLICATION_RULES.rejectionReasonMax} · ən azı {SELLER_APPLICATION_RULES.rejectionReasonMin} simvol</span>
    </label>}

    <label className="mt-4 grid gap-1 text-sm">Daxili qeyd (istəyə bağlı, müraciətçi görmür)
      <textarea value={adminNote} onChange={(event) => setAdminNote(event.target.value)} maxLength={SELLER_APPLICATION_RULES.adminNoteMax} rows={2} className={field} />
    </label>

    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-800">{message}</p>}
    <button disabled={busy || approveBlocked || rejectBlocked} className={`mt-4 w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${mode === "approve" ? "bg-[#173c40]" : "bg-red-700"}`}>
      {busy ? "Göndərilir…" : mode === "approve" ? "Müraciəti təsdiqlə" : "Müraciəti rədd et"}
    </button>
  </form>;
}
