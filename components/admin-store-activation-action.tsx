"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProductPublicationResult } from "@/lib/admin-store-product-publishing";
import AdminStoreProductPublishingResult from "@/components/admin-store-product-publishing-result";
import { useConfirmDialog } from "@/components/admin-ui/confirm-dialog";

export default function AdminStoreActivationAction({
  storeId,
  status,
  isActive,
  legalInfoApproved,
}: {
  storeId: string;
  status: string;
  isActive: boolean;
  legalInfoApproved: boolean;
}) {
  const router = useRouter();
  const { confirm, dialog } = useConfirmDialog();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [productResult, setProductResult] = useState<ProductPublicationResult | null>(null);
  const visible = status === "ACTIVE" && isActive;
  const canToggleVisibility = status === "ACTIVE";

  async function toggleVisibility() {
    if (busy) return;
    const next = !visible;
    const reason = window.prompt(next ? "İctimai görünürlüğü aktiv etmə səbəbini qeyd edin:" : "İctimai görünürlüğü deaktiv etmə səbəbini qeyd edin:");
    if (reason === null) return;
    if (reason.trim().length < 3) {
      setError("Audit üçün ən azı 3 simvolluq səbəb daxil edin.");
      return;
    }
    if (!await confirm(next
      ? "Mağazanı ictimai kataloqda göstərmək istəyirsiniz? Satış hüququ ayrıca yoxlanılacaq."
      : "Mağazanı ictimai kataloqdan gizlətmək istəyirsiniz?")) return;

    setBusy(true);
    setError("");
    setMessage("");
    setProductResult(null);
    try {
      const response = await fetch(`/api/admin/stores/${encodeURIComponent(storeId)}/activation`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next, reason: reason.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Mağazanın görünürlüyünü dəyişmək mümkün olmadı.");
      setMessage(result.message || "İctimai görünürlük yeniləndi.");
      setProductResult(result.products ?? null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Mağazanın görünürlüyünü dəyişmək mümkün olmadı.");
    } finally {
      setBusy(false);
    }
  }

  async function publishEligibleDrafts() {
    if (busy || !visible) return;
    const reason = window.prompt("Uyğun qaralama məhsulların yayımlanması üçün audit səbəbini qeyd edin:");
    if (reason === null) return;
    if (reason.trim().length < 3) {
      setError("Audit üçün ən azı 3 simvolluq səbəb daxil edin.");
      return;
    }
    if (!await confirm("Yalnız yayımlanma tələblərinə cavab verən qaralama məhsulları yayımlamaq istəyirsiniz?")) return;

    setBusy(true);
    setError("");
    setMessage("");
    setProductResult(null);
    try {
      const response = await fetch(`/api/admin/stores/${encodeURIComponent(storeId)}/activation`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true, reason: reason.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Qaralama məhsulları yoxlamaq mümkün olmadı.");
      setMessage(result.message || "Qaralama məhsullar yoxlanıldı.");
      setProductResult(result.products ?? null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Qaralama məhsulları yoxlamaq mümkün olmadı.");
    } finally {
      setBusy(false);
    }
  }

  async function review(action: "approve" | "reactivate") {
    const prompt = action === "approve"
      ? "Hüquqi məlumatları və satış uyğunluğunu yoxlayıb müraciəti təsdiqləmək istəyirsiniz?"
      : "Hüquqi məlumatları və satış uyğunluğunu yenidən yoxlayıb mağazanı bərpa etmək istəyirsiniz?";
    if (busy || !await confirm(prompt)) return;
    setBusy(true);
    setError("");
    setMessage("");
    setProductResult(null);
    try {
      const response = await fetch(`/api/admin/stores/${encodeURIComponent(storeId)}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Mağaza yoxlama qərarını saxlamaq mümkün olmadı.");
      setMessage(result.message || "Mağaza yoxlama qərarı saxlanıldı.");
      setProductResult(result.products ?? null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Mağaza yoxlama qərarını saxlamaq mümkün olmadı.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="grid gap-2">{dialog}
    {canToggleVisibility ? <button
      type="button"
      disabled={busy}
      onClick={() => void toggleVisibility()}
      className={`w-fit rounded-lg px-3 py-2 text-xs font-semibold disabled:cursor-wait disabled:opacity-50 ${visible ? "border border-amber-200 text-amber-900 hover:bg-amber-50" : "bg-[#173c40] text-white hover:bg-[#24575b]"}`}
    >
      {busy ? "Gözləyin…" : visible ? "İctimai görünürlüğü deaktiv et" : "İctimai görünürlüğü aktiv et"}
    </button> : <p className="max-w-96 text-xs text-slate-600">
      {status === "PENDING_REVIEW" ? "İctimai görünürlükdən əvvəl mağaza admin yoxlamasından keçməlidir." :
        status === "SUSPENDED" ? "Mağaza dayandırılıb. Görünürlüyü birbaşa aktiv etmək olmaz; bərpa qərarı tələb olunur." :
          status === "REJECTED" ? "Rədd edilmiş mağazanı ictimai etmək olmaz." :
            "Qaralama mağazanı ictimai etmək olmaz; əvvəlcə admin yoxlamasına göndərin."}
    </p>}
    {visible && <button
      type="button"
      disabled={busy}
      onClick={() => void publishEligibleDrafts()}
      className="w-fit rounded-lg border border-[#173c40] px-3 py-2 text-xs font-semibold text-[#173c40] disabled:opacity-50"
    >
      Uyğun qaralama məhsulları yoxla və yayımla
    </button>}
    <p className="max-w-64 text-xs text-slate-500">
      Hüquqi baxış: {legalInfoApproved ? "təsdiqlənib" : "tamamlanmayıb"}. Bu görünürlük əməliyyatı abunəliyi və alış hüququnu dəyişmir.
    </p>
    {(status === "PENDING_REVIEW" || (status === "ACTIVE" && !legalInfoApproved)) && <button type="button" disabled={busy} onClick={() => void review("approve")} className="w-fit rounded-lg border border-[#173c40] px-3 py-2 text-xs font-semibold text-[#173c40] disabled:opacity-50">Hüquqi baxışdan sonra təsdiqlə</button>}
    {status === "SUSPENDED" && <button type="button" disabled={busy} onClick={() => void review("reactivate")} className="w-fit rounded-lg border border-[#173c40] px-3 py-2 text-xs font-semibold text-[#173c40] disabled:opacity-50">Hüquqi baxışdan sonra bərpa et</button>}
    {(status === "DRAFT" || status === "REJECTED") && <p className="text-xs text-slate-500">{status === "DRAFT" ? "Müraciət qaralama vəziyyətindədir." : "Müraciət rədd edilib."}</p>}
    {error && <p role="alert" className="max-w-64 text-xs text-red-800">{error}</p>}
    {message && <p role="status" className="max-w-96 text-xs text-emerald-800">{message}</p>}
    <AdminStoreProductPublishingResult result={productResult}/>
  </div>;
}
