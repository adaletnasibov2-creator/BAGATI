"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProductPublicationResult } from "@/lib/admin-store-product-publishing";
import AdminStoreProductPublishingResult from "@/components/admin-store-product-publishing-result";

type Props = { storeId: string; status: string; legalInfoApproved: boolean; sellerType: string | null; legalName: string | null; voen: string | null; legalAddress: string | null };

export default function AdminStoreReviewActions(props: Props) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [productResult, setProductResult] = useState<ProductPublicationResult | null>(null);
  const [busy, setBusy] = useState(false);
  async function act(action: "approve" | "reject" | "suspend" | "reactivate") {
    if (busy) return;
    if ((action === "reject" || action === "suspend") && !reason.trim()) { setError("Rədd etmə və ya dayandırma səbəbini yazın."); return; }
    const labels = { approve: "təsdiqləmək", reject: "rədd etmək", suspend: "dayandırmaq", reactivate: "yenidən aktivləşdirmək" };
    if (!window.confirm(`Mağazanı ${labels[action]} istədiyinizə əminsiniz?`)) return;
    setBusy(true); setError(""); setMessage(""); setProductResult(null);
    try {
      const response = await fetch(`/api/admin/stores/${encodeURIComponent(props.storeId)}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...(reason.trim() ? { reason: reason.trim() } : {}) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Qərarı saxlamaq mümkün olmadı.");
      setMessage(result.message || "Qərar saxlanıldı."); setProductResult(result.products ?? null); setReason(""); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Qərarı saxlamaq mümkün olmadı."); }
    finally { setBusy(false); }
  }
  const input = "w-full rounded-xl border border-[#ded9cf] bg-white px-3.5 py-2.5 text-sm";
  const actions = props.status === "PENDING_REVIEW" ? ["approve", "reject", "suspend"] as const : props.status === "ACTIVE" ? ["approve", "suspend"] as const : props.status === "SUSPENDED" ? ["reactivate"] as const : [];
  return <section className="mt-5 rounded-2xl border border-[#e7e3d9] bg-white p-5">
    <h2 className="font-semibold text-[#142d38]">Satıcı məlumatları və admin qərarı</h2>
    <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2"><dt className="text-slate-500">Satıcı növü</dt><dd>{props.sellerType === "INDIVIDUAL_ENTREPRENEUR" ? "Fərdi sahibkar" : props.sellerType === "REGISTERED_COMPANY" ? "Qeydiyyatdan keçmiş şirkət" : "Seçilməyib"}</dd><dt className="text-slate-500">Hüquqi ad</dt><dd>{props.legalName || "Daxil edilməyib"}</dd><dt className="text-slate-500">VÖEN</dt><dd>{props.voen || "Daxil edilməyib"}</dd><dt className="text-slate-500">Hüquqi ünvan</dt><dd>{props.legalAddress || "Daxil edilməyib"}</dd><dt className="text-slate-500">Hüquqi məlumatların admin yoxlaması</dt><dd>{props.legalInfoApproved ? "Təsdiqlənib" : "Təsdiqlənməyib"}</dd></dl>
    <p className="mt-3 text-xs leading-5 text-slate-500">Tələb olunan sahələr serverdəki satıcı növü siyasətinə əsaslanır. Bu panel məlumatların dövlət reyestrində yoxlanmasını həyata keçirmir.</p>
    {(props.status === "PENDING_REVIEW" || props.status === "ACTIVE" || props.status === "SUSPENDED") && <>
      <label className="mt-4 grid gap-1 text-sm">Rədd etmə / dayandırma səbəbi<textarea className={input} rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)}/></label>
      <div className="mt-4 flex flex-wrap gap-2">{actions.map((action) => <button key={action} type="button" disabled={busy} onClick={() => void act(action)} className={`rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50 ${action === "reject" || action === "suspend" ? "border border-red-200 text-red-800" : "bg-[#173c40] text-white"}`}>{busy ? "Gözləyin…" : ({ approve: "Təsdiqlə", reject: "Rədd et", suspend: "Dayandır", reactivate: "Yenidən aktivləşdir" } as const)[action]}</button>)}</div>
    </>}
    {message && <p role="status" className="mt-3 text-sm text-emerald-800">{message}</p>}{error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
    <AdminStoreProductPublishingResult result={productResult}/>
  </section>;
}
