"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { registrationErrorMessage } from "@/lib/auth-form-errors";
import { GoogleOAuthButton, googleOAuthMessage } from "@/components/google-oauth-button";
import { finishAuthNavigation } from "@/lib/auth-client";
import { CUSTOMER_CONSENT_PARTS, LegalConsentCheckbox } from "@/components/legal-consent-checkbox";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";

const TERMS_ERROR = "Davam etmək üçün İstifadə şərtləri və Məxfilik siyasəti ilə razılığınızı təsdiqləyin.";
/** SIGNUP-EASY-2 T1: shown while a verified Google identity waits in the signed HttpOnly cookie. */
export const googlePendingSignupText = (email: string) => `Google hesabınız: ${email}. Hesab yaratmaq üçün şərtlərlə razılığınızı təsdiqləyib «Hesab yarat» düyməsini basın.`;
/** SIGNUP-EASY-2 T2. */
export const GOOGLE_PENDING_SIGNUP_BUTTON = "Google hesabı ilə hesab yarat";

export function RegisterForm({ nextPath, oauthError, portal, googlePendingEmail }: { nextPath: string; oauthError?: string; portal?: string | null; googlePendingEmail?: string }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [termsError, setTermsError] = useState("");
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState("");
  const consentRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  /** The one checkbox covers both ways to register (Google and e-mail); without it neither starts. */
  function blockWithoutTerms() {
    setTermsError(TERMS_ERROR);
    consentRef.current?.querySelector("input")?.focus();
  }

  /**
   * SIGNUP-EASY-2: finishes the Google sign-up waiting in the cookie (POST /api/auth/google/complete-register). The
   * server re-checks everything; the messages are the existing Google texts.
   */
  async function completeGoogle() {
    setGoogleError("");
    if (!acceptTerms) { blockWithoutTerms(); return; }
    if (googleBusy) return;
    setGoogleBusy(true);
    try {
      const response = await fetch("/api/auth/google/complete-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ acceptTerms: true }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && typeof data.redirectTo === "string" && data.redirectTo.startsWith("/") && !data.redirectTo.startsWith("//")) {
        finishAuthNavigation(data.redirectTo);
        return;
      }
      if (data.code === "terms-required") { blockWithoutTerms(); setGoogleBusy(false); return; }
      if (data.code === "rate-limited") { setGoogleError(googleOAuthMessage("rate-limited")); setGoogleBusy(false); return; }
      // The cookie is cleared on these answers: show the normal page with the existing Google message.
      const code = data.code === "invalid" || data.code === "account-exists" ? data.code : "failed";
      const query = new URLSearchParams({ oauth: code });
      if (nextPath !== "/account") query.set("next", nextPath);
      window.location.replace(`/register?${query.toString()}`);
    } catch {
      setGoogleError("Bağlantı xətası. Məlumatlar saxlanılmadı; yenidən cəhd edin.");
      setGoogleBusy(false);
    }
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
    {googlePendingEmail ? <div className="mt-7 space-y-3">
      {(googleError || googleOAuthMessage(oauthError, "customer", portal)) && <p role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950">{googleError || googleOAuthMessage(oauthError, "customer", portal)}</p>}
      <p role="status" className="rounded-control bg-primary-tint px-4 py-3 text-sm text-primary">{googlePendingSignupText(googlePendingEmail)}</p>
      <Button type="button" size="lg" fullWidth loading={googleBusy} loadingLabel="Hesab yaradılır…" onClick={() => void completeGoogle()}>{GOOGLE_PENDING_SIGNUP_BUTTON}</Button>
      <div className="flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line"/><span>və ya e-poçtla</span><span className="h-px flex-1 bg-line"/></div>
    </div> : <GoogleOAuthButton intent="customer" mode="register" nextPath={nextPath} errorCode={oauthError} portal={portal} termsGate={{ accepted: acceptTerms, onBlocked: blockWithoutTerms }}/>}
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
