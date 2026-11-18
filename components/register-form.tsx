"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { registrationErrorMessage } from "@/lib/auth-form-errors";
import { GoogleOAuthButton } from "@/components/google-oauth-button";
import { CUSTOMER_CONSENT_PARTS, LegalConsentCheckbox } from "@/components/legal-consent-checkbox";

const TERMS_ERROR = "Davam etmək üçün İstifadəçi şərtləri və Məxfilik siyasəti ilə razılığınızı təsdiqləyin.";

export function RegisterForm({ nextPath, oauthError, portal }: { nextPath: string; oauthError?: string; portal?: string | null }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [termsError, setTermsError] = useState("");
  const consentRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  /** The one checkbox covers both ways to register (Google and e-mail); without it neither starts. */
  function blockWithoutTerms() {
    setTermsError(TERMS_ERROR);
    consentRef.current?.querySelector("input")?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!acceptTerms) { blockWithoutTerms(); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email, password, acceptTerms: true }),
      });
      const data = await response.json().catch(() => ({}));
      if (data.requestAccepted && data.verificationPath) {
        const next = `?next=${encodeURIComponent(nextPath)}`;
        router.replace(`${data.verificationPath}${next}`);
        return;
      }
      if (!response.ok) throw new Error(registrationErrorMessage(data, data.error || "Qeydiyyat tamamlanmadı."));
      setError("Qeydiyyat sorğusu tamamlanmadı. Yenidən cəhd edin.");
    } catch (reason) {
      setError(reason instanceof TypeError ? "Bağlantı xətası. Məlumatlar saxlanılmadı; yenidən cəhd edin." : reason instanceof Error ? reason.message : "Qeydiyyat tamamlanmadı.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div ref={consentRef} className="mt-7 rounded-2xl border border-line bg-[#f7f8f6] p-4">
      <LegalConsentCheckbox id="register-accept-terms" checked={acceptTerms} onChange={(checked) => { setAcceptTerms(checked); if (checked) setTermsError(""); }} error={termsError} parts={CUSTOMER_CONSENT_PARTS}/>
    </div>
    <GoogleOAuthButton intent="customer" mode="register" nextPath={nextPath} errorCode={oauthError} portal={portal} termsGate={{ accepted: acceptTerms, onBlocked: blockWithoutTerms }}/>
    <form onSubmit={submit} className="mt-7 space-y-4">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-medium">Ad<input required maxLength={80} value={firstName} onChange={(event) => setFirstName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-line px-4 py-3"/></label>
      <label className="text-sm font-medium">Soyad<input required maxLength={80} value={lastName} onChange={(event) => setLastName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-line px-4 py-3"/></label>
    </div>
    <label className="block text-sm font-medium">E-poçt<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full rounded-xl border border-line px-4 py-3"/></label>
    <label className="block text-sm font-medium">Şifrə<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-line px-4 py-3"/><span className="mt-1 block text-xs text-muted">Ən azı 12 simvol</span></label>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <button disabled={busy} className="w-full rounded-full bg-ink px-5 py-3.5 font-medium text-white hover:bg-emerald disabled:opacity-50">{busy ? "Hesab yaradılır…" : "Hesab yarat"}</button>
    </form>
  </>;
}
