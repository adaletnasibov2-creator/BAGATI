"use client";

import { useState, type ReactNode } from "react";
import { parseVoen, VOEN_ADMIN_NOTE, VOEN_HELP } from "@/lib/voen";
import { useRouter } from "next/navigation";
import { SELLER_APPLICATION_RULES } from "@/lib/seller-application";
import { firstInvalidField, sellerApplicationFieldErrors, type SellerApplicationField, type SellerApplicationFieldErrors } from "@/lib/seller-application-form";
import { LegalConsentCheckbox, SELLER_CONSENT_PARTS } from "@/components/legal-consent-checkbox";
import { Input, Select, controlClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";

export type VendorApplyDefaults = {
  displayName: string;
  phone: string;
  sellerType: "INDIVIDUAL_ENTREPRENEUR" | "REGISTERED_COMPANY";
  legalName: string;
  voen: string;
  legalAddress: string;
  plannedStoreName: string;
};

/** Element id of each field; the consent box keeps its existing id. */
const fieldId = (field: SellerApplicationField) => field === "acceptSellerTerms" ? "vendor-apply-accept-terms" : `vendor-apply-${field}`;

/** Visual "required" mark. Screen readers get "required" from the input's own `required` attribute instead. */
function Required() {
  return <span aria-hidden="true" className="ml-0.5 font-semibold text-gold-700">*</span>;
}

function SectionCard({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section aria-labelledby={id} className="rounded-card border border-line bg-white p-5 shadow-subtle sm:p-6">
    <h2 id={id} className="font-display text-h3 text-fg">{title}</h2>
    <div className="mt-5 grid gap-5 md:grid-cols-2">{children}</div>
  </section>;
}

/**
 * Seller application form. Submitting does not change the account: an admin reviews the application first.
 * Which fields are required is decided by the server schema (lib/seller-application.ts); the browser runs the same
 * schema only to show the errors next to the fields before sending (lib/seller-application-form.ts).
 */
export default function VendorApplyForm({ defaults }: { defaults: VendorApplyDefaults }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<SellerApplicationFieldErrors>({});
  const [sellerType, setSellerType] = useState(defaults.sellerType);
  const [note, setNote] = useState("");
  const [voen, setVoen] = useState(defaults.voen);
  const [voenTouched, setVoenTouched] = useState(false);
  const [voenServerError, setVoenServerError] = useState("");
  const [acceptSellerTerms, setAcceptSellerTerms] = useState(false);
  const [termsError, setTermsError] = useState("");
  const voenCheck = parseVoen(voen);
  const company = sellerType === "REGISTERED_COMPANY";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const values = { ...Object.fromEntries(new FormData(event.currentTarget).entries()), acceptSellerTerms: true };
    // Same schema as the server (the server checks again). The VÖEN error is shown by its own field below.
    const found = sellerApplicationFieldErrors({ ...values, acceptSellerTerms: acceptSellerTerms || undefined });
    if (!voenCheck.ok) setVoenTouched(true);
    setTermsError(found.acceptSellerTerms ?? "");
    setErrors(found);
    const first = firstInvalidField(found);
    if (first) { setError(""); document.getElementById(fieldId(first))?.focus(); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/vendor/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      const result = await response.json().catch(() => ({}));
      // The server names the field for a VÖEN already in use (409 DUPLICATE_VOEN): show its text under VÖEN.
      if (!response.ok && result.field === "voen" && result.error) {
        setVoenServerError(result.error); setBusy(false);
        document.getElementById(fieldId("voen"))?.focus();
        return;
      }
      if (!response.ok) throw new Error(result.error || "Müraciəti göndərmək mümkün olmadı.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Müraciəti göndərmək mümkün olmadı.");
      setBusy(false);
    }
  }

  /** Editing a field clears its own error; the others stay until the next submit. */
  function clearError(name: string) {
    if (!(name in errors)) return;
    setErrors((current) => { const next = { ...current }; delete next[name as SellerApplicationField]; return next; });
  }
  const fieldError = (field: SellerApplicationField) => errors[field];

  return <form noValidate onSubmit={submit} onChange={(event) => clearError((event.target as unknown as { name?: string }).name ?? "")} className="grid gap-5">
    <p aria-hidden="true" className="text-sm text-fg-secondary"><span className="font-semibold text-gold-700">*</span> məcburi xanadır</p>

    <SectionCard id="vendor-apply-section-seller" title="Satıcı məlumatları">
      <Select id={fieldId("sellerType")} name="sellerType" required label={<>Satıcı növü<Required/></>} value={sellerType} onChange={(event) => setSellerType(event.target.value as VendorApplyDefaults["sellerType"])} error={fieldError("sellerType")}>
        <option value="INDIVIDUAL_ENTREPRENEUR">Fərdi sahibkar</option>
        <option value="REGISTERED_COMPANY">Qeydiyyatdan keçmiş şirkət</option>
      </Select>
      <Input id={fieldId("displayName")} name="displayName" required minLength={2} maxLength={120} defaultValue={defaults.displayName} autoComplete="organization" label={<>Satıcı / şirkət adı<Required/></>} error={fieldError("displayName")}/>
      <Input id={fieldId("legalName")} name="legalName" required minLength={2} maxLength={200} defaultValue={defaults.legalName} autoComplete={company ? "organization" : "name"} className="md:col-span-2" label={<>{company ? "Şirkətin hüquqi adı" : "Sahibkarın adı və soyadı"}<Required/></>} error={fieldError("legalName")}/>
      <div className="grid content-start gap-1.5">
        <label htmlFor={fieldId("voen")} className="text-sm font-medium text-fg">VÖEN<Required/></label>
        <input id={fieldId("voen")} name="voen" required inputMode="numeric" autoComplete="off" maxLength={40} value={voen} onChange={(event) => { setVoen(event.target.value); setVoenServerError(""); }} onBlur={() => setVoenTouched(true)} placeholder="10 rəqəm" aria-invalid={(voenTouched && !voenCheck.ok) || Boolean(voenServerError)} aria-describedby={cx("voen-help voen-error", voenServerError && "voen-server-error")} className={controlClass((voenTouched && !voenCheck.ok) || Boolean(voenServerError))}/>
        <span id="voen-help" className="text-xs text-fg-muted">{VOEN_HELP} {VOEN_ADMIN_NOTE}</span>
        {voenTouched && !voenCheck.ok && <span id="voen-error" role="alert" className="text-sm font-medium text-danger">{voenCheck.error}</span>}
        {voenServerError && <span id="voen-server-error" role="alert" className="text-sm font-medium text-danger">{voenServerError}</span>}
      </div>
      <Input id={fieldId("phone")} name="phone" type="tel" inputMode="tel" required maxLength={40} defaultValue={defaults.phone} autoComplete="tel" placeholder="+994 55 123 45 67" className="content-start" label={<>Telefon<Required/></>} error={fieldError("phone")}/>
    </SectionCard>

    <SectionCard id="vendor-apply-section-more" title="Əlavə məlumat">
      <Input id={fieldId("legalAddress")} name="legalAddress" required={company} maxLength={300} defaultValue={defaults.legalAddress} autoComplete="street-address" className="md:col-span-2" label={<>Hüquqi ünvan{company ? <Required/> : " (istəyə bağlı)"}</>} error={fieldError("legalAddress")}/>
      <Input id={fieldId("plannedStoreName")} name="plannedStoreName" maxLength={120} defaultValue={defaults.plannedStoreName} label="Planlaşdırdığınız mağaza adı (istəyə bağlı)" error={fieldError("plannedStoreName")}/>
    </SectionCard>

    <section aria-labelledby="vendor-apply-section-send" className="rounded-card border border-line bg-white p-5 shadow-subtle sm:p-6">
      <h2 id="vendor-apply-section-send" className="font-display text-h3 text-fg">Qeyd və razılıq</h2>
      <div className="mt-5 grid gap-1.5">
        <label htmlFor={fieldId("applicantNote")} className="text-sm font-medium text-fg">Admin üçün qeyd (istəyə bağlı)</label>
        <textarea id={fieldId("applicantNote")} name="applicantNote" rows={3} maxLength={SELLER_APPLICATION_RULES.applicantNoteMax} value={note} onChange={(event) => setNote(event.target.value)} aria-invalid={fieldError("applicantNote") ? true : undefined} aria-describedby={cx("vendor-apply-note-count", fieldError("applicantNote") && "vendor-apply-applicantNote-error")} className={cx(controlClass(Boolean(fieldError("applicantNote"))), "min-h-28 resize-y")}/>
        <span id="vendor-apply-note-count" className="text-xs text-fg-muted">{note.length} / {SELLER_APPLICATION_RULES.applicantNoteMax} · yalnız BAGATI adminləri görür</span>
        {fieldError("applicantNote") && <p id="vendor-apply-applicantNote-error" role="alert" className="text-sm font-medium text-danger">{fieldError("applicantNote")}</p>}
      </div>
      {/* From 1024 px the same steps are in the "Müraciət necə işləyir" side card. */}
      <p className="mt-5 text-sm leading-6 text-fg-secondary lg:hidden">Müraciət göndərildikdən sonra admin məlumatları yoxlayır. Təsdiqə qədər hesabınız müştəri hesabı olaraq qalır. Təsdiqdən sonra satıcı panelində mağaza qaralaması yarada bilərsiniz; mağaza ictimai satış üçün ayrıca yoxlanılır.</p>
      {/* The whole label row toggles the box; at least 44 px tall here (touch target) without changing the shared component. */}
      <div className={cx("mt-5 rounded-control border bg-surface-page p-4 [&_label]:min-h-11", termsError ? "border-danger" : "border-line")}>
        <LegalConsentCheckbox id="vendor-apply-accept-terms" checked={acceptSellerTerms} onChange={(checked) => { setAcceptSellerTerms(checked); if (checked) setTermsError(""); }} error={termsError} parts={SELLER_CONSENT_PARTS}/>
      </div>
      {error && <p role="alert" className="mt-5 rounded-control bg-danger-subtle px-4 py-3 text-sm font-medium text-danger">{error}</p>}
      <Button type="submit" loading={busy} loadingLabel="Göndərilir…" className="mt-5 w-full sm:w-auto">Müraciəti göndər</Button>
    </section>
  </form>;
}
