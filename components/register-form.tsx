"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { registrationErrorMessage } from "@/lib/auth-form-errors";
import { GoogleOAuthButton } from "@/components/google-oauth-button";
import { CUSTOMER_CONSENT_PARTS, LegalConsentCheckbox } from "@/components/legal-consent-checkbox";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";

const TERMS_ERROR = "Davam etmək üçün İstifadə şərtləri və Məxfilik siyasəti ilə razılığınızı təsdiqləyin.";

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
    <Card ref={consentRef} tone="sunken" padding="sm" className="mt-7">
      <LegalConsentCheckbox id="register-accept-terms" checked={acceptTerms} onChange={(checked) => { setAcceptTerms(checked); if (checked) setTermsError(""); }} error={termsError} parts={CUSTOMER_CONSENT_PARTS}/>
    </Card>
    <GoogleOAuthButton intent="customer" mode="register" nextPath={nextPath} errorCode={oauthError} portal={portal} termsGate={{ accepted: acceptTerms, onBlocked: blockWithoutTerms }}/>
    <form onSubmit={submit} className="mt-7 space-y-4">
    <div className="grid gap-4 sm:grid-cols-2 sm:gap-3">
      <Input id="register-first-name" label="Ad" required maxLength={80} value={firstName} onChange={(event) => setFirstName(event.target.value)}/>
      <Input id="register-last-name" label="Soyad" required maxLength={80} value={lastName} onChange={(event) => setLastName(event.target.value)}/>
    </div>
    <Input id="register-email" label="E-poçt" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)}/>
    <Input id="register-password" label="Şifrə" hint="Ən azı 12 simvol" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)}/>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <Button type="submit" size="lg" fullWidth loading={busy} loadingLabel="Hesab yaradılır…">Hesab yarat</Button>
    </form>
  </>;
}
