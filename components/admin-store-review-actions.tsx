"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProductPublicationResult } from "@/lib/admin-store-product-publishing";
import AdminStoreProductPublishingResult from "@/components/admin-store-product-publishing-result";
import { useConfirmDialog } from "@/components/admin-ui/confirm-dialog";

type Props = { storeId: string; status: string; legalInfoApproved: boolean; sellerType: string | null; legalName: string | null; voen: string | null; legalAddress: string | null; hasActiveGrant?: boolean };

export default function AdminStoreReviewActions(props: Props) {
  const router = useRouter();
  const { confirm, dialog } = useConfirmDialog();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [productResult, setProductResult] = useState<ProductPublicationResult | null>(null);
  const [busy, setBusy] = useState(false);
  // "Ödənişsiz satış (admin icazəsi)" — OFF by default; only sent with "approve".
  const [freeSale, setFreeSale] = useState(false);
  const [freeTier, setFreeTier] = useState<"BASIC" | "PRO">("BASIC");
  const [freeEndsAt, setFreeEndsAt] = useState("");
  const [freeReason, setFreeReason] = useState("");
  async function act(action: "approve" | "reject" | "suspend" | "reactivate") {
    if (busy) return;
    if ((action === "reject" || action === "suspend") && !reason.trim()) { setError("Rədd etmə və ya dayandırma səbəbini yazın."); return; }
    const withFreeSale = action === "approve" && freeSale;
    if (withFreeSale && freeReason.trim().length < 8) { setError("Ödənişsiz satış üçün səbəb yazın (ən azı 8 simvol)."); return; }
    const labels = { approve: "təsdiqləmək", reject: "rədd etmək", suspend: "dayandırmaq", reactivate: "yenidən aktivləşdirmək" };
    const freeText = withFreeSale ? ` Ödənişsiz satış icazəsi də veriləcək (${freeTier}${freeEndsAt ? `, ${freeEndsAt} tarixinədək` : ", bitmə tarixi yoxdur"}).` : "";
    if (!await confirm(`Mağazanı ${labels[action]} istədiyinizə əminsiniz?${freeText}`)) return;
    setBusy(true); setError(""); setMessage(""); setProductResult(null);
    try {
      const response = await fetch(`/api/admin/stores/${encodeURIComponent(props.storeId)}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...(reason.trim() ? { reason: reason.trim() } : {}), ...(withFreeSale ? { complimentary: { tier: freeTier, endsAt: freeEndsAt || null, reason: freeReason.trim() } } : {}) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Qərarı saxlamaq mümkün olmadı.");
      setMessage(result.message || "Qərar saxlanıldı."); setProductResult(result.products ?? null); setReason(""); setFreeSale(false); setFreeReason(""); setFreeEndsAt(""); setFreeTier("BASIC"); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Qərarı saxlamaq mümkün olmadı."); }
    finally { setBusy(false); }
  }
  const input = "w-full rounded-xl border border-[#ded9cf] bg-white px-3.5 py-2.5 text-sm";
  const actions = props.status === "PENDING_REVIEW" ? ["approve", "reject", "suspend"] as const : props.status === "ACTIVE" ? ["approve", "suspend"] as const : props.status === "SUSPENDED" ? ["reactivate"] as const : [];
  return <section className="mt-5 rounded-2xl border border-[#e7e3d9] bg-white p-5">{dialog}
    <h2 className="font-semibold text-[#142d38]">Satıcı məlumatları və admin qərarı</h2>
    <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2"><dt className="text-slate-500">Satıcı növü</dt><dd>{props.sellerType === "INDIVIDUAL_ENTREPRENEUR" ? "Fərdi sahibkar" : props.sellerType === "REGISTERED_COMPANY" ? "Qeydiyyatdan keçmiş şirkət" : "Seçilməyib"}</dd><dt className="text-slate-500">Hüquqi ad</dt><dd>{props.legalName || "Daxil edilməyib"}</dd><dt className="text-slate-500">VÖEN</dt><dd>{props.voen || "Daxil edilməyib"}</dd><dt className="text-slate-500">Hüquqi ünvan</dt><dd>{props.legalAddress || "Daxil edilməyib"}</dd><dt className="text-slate-500">Hüquqi məlumatların admin yoxlaması</dt><dd>{props.legalInfoApproved ? "Təsdiqlənib" : "Təsdiqlənməyib"}</dd></dl>
    <p className="mt-3 text-xs leading-5 text-slate-500">Tələb olunan sahələr serverdəki satıcı növü siyasətinə əsaslanır. Bu panel məlumatların dövlət reyestrində yoxlanmasını həyata keçirmir.</p>
    {(props.status === "PENDING_REVIEW" || props.status === "ACTIVE" || props.status === "SUSPENDED") && <>
      <label className="mt-4 grid gap-1 text-sm">Rədd etmə / dayandırma səbəbi<textarea className={input} rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)}/></label>
      {(actions as readonly string[]).includes("approve") && <fieldset className="mt-4 rounded-xl border border-[#ece7dc] p-3">
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={freeSale} disabled={busy || props.hasActiveGrant} onChange={(event) => setFreeSale(event.target.checked)}/>Ödənişsiz satış (admin icazəsi)</label>
        <p className="mt-1 text-xs leading-5 text-slate-500">{props.hasActiveGrant ? "Bu mağazanın artıq ödənişsiz satış icazəsi var; onu aşağıdakı bölmədən idarə edin." : "Seçilməsə, satış üçün aktiv və qüvvədə olan ödənişli Basic və ya Pro abunəliyi tələb olunur."}</p>
        {freeSale && <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">Paket<select className={input} value={freeTier} onChange={(event) => setFreeTier(event.target.value as "BASIC" | "PRO")}><option value="BASIC">BASIC (300 məhsul)</option><option value="PRO">PRO (2 000 məhsul)</option></select></label>
          <label className="grid gap-1 text-sm">Bitmə tarixi (istəyə bağlı)<input type="date" className={input} value={freeEndsAt} onChange={(event) => setFreeEndsAt(event.target.value)}/></label>
          <label className="grid gap-1 text-sm sm:col-span-2">Ödənişsiz satışın səbəbi (məcburi)<textarea className={input} rows={2} maxLength={500} value={freeReason} onChange={(event) => setFreeReason(event.target.value)}/></label>
        </div>}
      </fieldset>}
      <div className="mt-4 flex flex-wrap gap-2">{actions.map((action) => <button key={action} type="button" disabled={busy} onClick={() => void act(action)} className={`rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50 ${action === "reject" || action === "suspend" ? "border border-red-200 text-red-800" : "bg-[#173c40] text-white"}`}>{busy ? "Gözləyin…" : ({ approve: "Təsdiqlə", reject: "Rədd et", suspend: "Dayandır", reactivate: "Yenidən aktivləşdir" } as const)[action]}</button>)}</div>
    </>}
    {message && <p role="status" className="mt-3 text-sm text-emerald-800">{message}</p>}{error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
    <AdminStoreProductPublishingResult result={productResult}/>
  </section>;
}
