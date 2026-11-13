"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SELLER_APPLICATION_RULES } from "@/lib/seller-application";

const field = "mt-1 w-full rounded-xl border border-[#ded9cf] bg-white px-3.5 py-3 text-sm";
const label = "grid gap-1 text-sm";

export type VendorApplyDefaults = {
  displayName: string;
  phone: string;
  sellerType: "INDIVIDUAL_ENTREPRENEUR" | "REGISTERED_COMPANY";
  legalName: string;
  voen: string;
  legalAddress: string;
  plannedStoreName: string;
};

/** Seller application form. Submitting does not change the account: an admin reviews the application first. */
export default function VendorApplyForm({ defaults }: { defaults: VendorApplyDefaults }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sellerType, setSellerType] = useState(defaults.sellerType);
  const [note, setNote] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const response = await fetch("/api/vendor/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Müraciəti göndərmək mümkün olmadı.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Müraciəti göndərmək mümkün olmadı.");
      setBusy(false);
    }
  }

  return <form onSubmit={submit} className="mt-6 grid gap-4 rounded-2xl border border-[#e8e4db] bg-white p-5 sm:p-7">
    <label className={label}>Satıcı / şirkət adı<input name="displayName" required minLength={2} maxLength={120} defaultValue={defaults.displayName} autoComplete="organization" className={field}/></label>
    <label className={label}>Telefon<input name="phone" type="tel" required maxLength={40} defaultValue={defaults.phone} autoComplete="tel" placeholder="+994 55 123 45 67" className={field}/></label>
    <label className={label}>Satıcı növü<select name="sellerType" required value={sellerType} onChange={(event) => setSellerType(event.target.value as VendorApplyDefaults["sellerType"])} className={field}>
      <option value="INDIVIDUAL_ENTREPRENEUR">Fərdi sahibkar</option>
      <option value="REGISTERED_COMPANY">Qeydiyyatdan keçmiş şirkət</option>
    </select></label>
    <label className={label}>{sellerType === "REGISTERED_COMPANY" ? "Şirkətin hüquqi adı" : "Sahibkarın adı və soyadı"}<input name="legalName" required minLength={2} maxLength={200} defaultValue={defaults.legalName} className={field}/></label>
    <label className={label}>VÖEN<input name="voen" required inputMode="numeric" maxLength={40} defaultValue={defaults.voen} placeholder="10 rəqəm" className={field}/></label>
    <label className={label}>Hüquqi ünvan{sellerType === "REGISTERED_COMPANY" ? "" : " (istəyə bağlı)"}<input name="legalAddress" required={sellerType === "REGISTERED_COMPANY"} maxLength={300} defaultValue={defaults.legalAddress} className={field}/></label>
    <label className={label}>Planlaşdırdığınız mağaza adı (istəyə bağlı)<input name="plannedStoreName" maxLength={120} defaultValue={defaults.plannedStoreName} className={field}/></label>
    <label className={label}>Admin üçün qeyd (istəyə bağlı)
      <textarea name="applicantNote" rows={3} maxLength={SELLER_APPLICATION_RULES.applicantNoteMax} value={note} onChange={(event) => setNote(event.target.value)} className={field}/>
      <span className="text-xs text-slate-500">{note.length} / {SELLER_APPLICATION_RULES.applicantNoteMax} · yalnız BAGATI adminləri görür</span>
    </label>
    <p className="text-sm leading-6 text-slate-600">Müraciət göndərildikdən sonra admin məlumatları yoxlayır. Təsdiqə qədər hesabınız müştəri hesabı olaraq qalır. Təsdiqdən sonra satıcı panelində mağaza qaralaması yarada bilərsiniz; mağaza ictimai satış üçün ayrıca yoxlanılır.</p>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <button disabled={busy} className="w-fit rounded-xl bg-[#173c40] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Göndərilir…" : "Müraciəti göndər"}</button>
  </form>;
}
