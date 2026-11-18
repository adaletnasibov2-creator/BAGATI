"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LegalConsentCheckbox, SELLER_CONSENT_PARTS } from "@/components/legal-consent-checkbox";

const TERMS_ERROR = "Davam etmək üçün Satıcı şərtləri ilə razılığınızı təsdiqləyin.";

/**
 * Seller panel: shown while the CURRENT seller terms are not accepted (existing and admin-created sellers). Store
 * creation and product publishing answer 409 SELLER_TERMS_REQUIRED until then; the forms show this card inline.
 */
export function SellerTermsCard({ onAccepted, compact = false }: { onAccepted?: () => void; compact?: boolean }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function accept() {
    if (!checked) { setError(TERMS_ERROR); document.getElementById("seller-terms-accept")?.focus(); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/vendor/legal-acceptance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accept: true }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Təsdiqi saxlamaq mümkün olmadı. Yenidən cəhd edin.");
      setDone(true);
      onAccepted?.();
      router.refresh();
    } catch (reason) {
      setError(reason instanceof TypeError ? "Bağlantı xətası. Yenidən cəhd edin." : reason instanceof Error ? reason.message : "Təsdiqi saxlamaq mümkün olmadı.");
    } finally {
      setBusy(false);
    }
  }

  if (done) return <p role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">Satıcı şərtləri qəbul edildi. Davam edə bilərsiniz.</p>;

  return <section aria-labelledby="seller-terms-card-title" className={`rounded-2xl border border-[#e6d8bd] bg-[#fbf7ee] ${compact ? "p-4" : "p-5 sm:p-6"}`}>
    <p className="text-xs font-semibold uppercase tracking-[.16em] text-[#85621d]">Satıcı şərtləri</p>
    <h2 id="seller-terms-card-title" className="mt-1 text-lg font-semibold text-[#0B1726]">Satıcı şərtlərini təsdiqləyin</h2>
    <p className="mt-2 max-w-3xl text-sm leading-6 text-[#405451]">
      Mağaza yaratmaq və məhsul yayımlamaq üçün <Link href="/seller-terms" target="_blank" rel="noopener noreferrer" className="font-semibold text-emerald underline underline-offset-2">Satıcı şərtləri</Link> ilə razılığınız lazımdır: abunə planları, komissiya, ödəniş, çatdırılma, qaytarma və məsuliyyət qaydaları. Mövcud mağaza və məhsullarınız olduğu kimi qalır.
    </p>
    <div className="mt-4"><LegalConsentCheckbox id="seller-terms-accept" checked={checked} onChange={(value) => { setChecked(value); if (value) setError(""); }} error={error} parts={SELLER_CONSENT_PARTS}/></div>
    <button type="button" onClick={() => void accept()} disabled={busy} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#173c40] px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saxlanılır…" : "Təsdiqlə"}</button>
  </section>;
}
