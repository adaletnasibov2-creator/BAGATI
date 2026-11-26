"use client";

import { useState } from "react";
import Link from "next/link";
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
    const reason = window.prompt(next ? "İctimai görünürlüyü aktiv etmə səbəbini qeyd edin:" : "İctimai görünürlüyü deaktiv etmə səbəbini qeyd edin:");
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

  // Reactivate only. Approve is a link to the store page (PILOT-FREE-ONBOARDING-1), so it never posts from this list.
  async function review(action: "reactivate") {
    const prompt = "Hüquqi məlumatları və satış uyğunluğunu yenidən yoxlayıb mağazanı bərpa etmək istəyirsiniz?";
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
      className={`w-fit rounded-control px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-wait disabled:opacity-50 ${visible ? "border border-amber-200 text-amber-900 hover:bg-amber-50" : "bg-primary text-white hover:bg-primary-hover"}`}
    >
      {busy ? "Gözləyin…" : visible ? "İctimai görünürlüyü deaktiv et" : "İctimai görünürlüyü aktiv et"}
    </button> : <p className="max-w-96 text-xs text-fg-secondary">
      {status === "PENDING_REVIEW" ? "İctimai görünürlükdən əvvəl mağaza admin yoxlamasından keçməlidir." :
        status === "SUSPENDED" ? "Mağaza dayandırılıb. Görünürlüyü birbaşa aktiv etmək olmaz; bərpa qərarı tələb olunur." :
          status === "REJECTED" ? "Rədd edilmiş mağazanı ictimai etmək olmaz." :
            "Qaralama mağazanı ictimai etmək olmaz; əvvəlcə admin yoxlamasına göndərin."}
    </p>}
    {visible && <button
      type="button"
      disabled={busy}
      onClick={() => void publishEligibleDrafts()}
      className="w-fit rounded-control border border-primary px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50"
    >
      Uyğun qaralama məhsulları yoxla və yayımla
    </button>}
    <p className="max-w-64 text-xs text-fg-secondary">
      Hüquqi baxış: {legalInfoApproved ? "təsdiqlənib" : "tamamlanmayıb"}. Bu görünürlük əməliyyatı abunəliyi və alış hüququnu dəyişmir.
    </p>
    {/* PILOT-FREE-ONBOARDING-1 (G2): approval happens on the store page, where the free-sale option is. */}
    {(status === "PENDING_REVIEW" || (status === "ACTIVE" && !legalInfoApproved)) && <Link href={`/admin/stores/${encodeURIComponent(storeId)}`} className="w-fit rounded-control border border-primary px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Hüquqi baxışdan sonra təsdiqlə</Link>}
    {status === "SUSPENDED" && <button type="button" disabled={busy} onClick={() => void review("reactivate")} className="w-fit rounded-control border border-primary px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50">Hüquqi baxışdan sonra bərpa et</button>}
    {(status === "DRAFT" || status === "REJECTED") && <p className="text-xs text-fg-secondary">{status === "DRAFT" ? "Müraciət qaralama vəziyyətindədir." : "Müraciət rədd edilib."}</p>}
    {error && <p role="alert" className="max-w-64 text-xs text-red-800">{error}</p>}
    {message && <p role="status" className="max-w-96 text-xs text-emerald-800">{message}</p>}
    <AdminStoreProductPublishingResult result={productResult}/>
  </div>;
}
