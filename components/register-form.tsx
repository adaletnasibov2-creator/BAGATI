"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { registrationErrorMessage } from "@/lib/auth-form-errors";
import { GoogleOAuthButton } from "@/components/google-oauth-button";

export function RegisterForm({ nextPath, oauthError, portal }: { nextPath: string; oauthError?: string; portal?: string | null }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email, password }),
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
    <GoogleOAuthButton intent="customer" mode="register" nextPath={nextPath} errorCode={oauthError} portal={portal}/>
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
