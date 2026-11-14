"use client";

import { FormEvent, useRef, useState } from "react";
import Link from "next/link";
import { finishAuthNavigation } from "@/lib/auth-client";
import { isLoginPortal, publicLoginPortalLink } from "@/lib/login-portal";
import { GoogleOAuthButton } from "@/components/google-oauth-button";

export function LoginForm({ nextPath, oauthError, notice, portal }: { nextPath: string; oauthError?: string; notice?: string; portal?: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [portalHint, setPortalHint] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setPortalHint("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (data.requiresEmailVerification && data.verificationPath) {
        const params = new URLSearchParams({ from: "login" });
        if (data.verificationPath === "/verify-email") params.set("next", nextPath);
        window.location.replace(`${data.verificationPath}?${params.toString()}`);
        return;
      }
      if (!response.ok) {
        setPortalHint(data.code === "WRONG_PORTAL" && isLoginPortal(data.portal) ? data.portal : "");
        throw new Error(data.error || "Giriş alınmadı.");
      }
      finishAuthNavigation(nextPath);
    } catch (reason) {
      setError(reason instanceof TypeError ? "Bağlantı xətası. İnternet bağlantısını yoxlayıb yenidən cəhd edin." : reason instanceof Error ? reason.message : "Giriş alınmadı.");
      submitting.current = false;
      setBusy(false);
    }
  }

  const portalLink = publicLoginPortalLink(portalHint);
  return <>
    {notice && <p role="status" className="mt-6 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>}
    <GoogleOAuthButton intent="customer" mode="login" nextPath={nextPath} errorCode={oauthError} portal={portal}/>
    <form onSubmit={submit} className="mt-7 space-y-4">
      <label className="block text-sm font-medium">E-poçt<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full rounded-xl border border-line bg-white px-4 py-3 outline-none focus:border-emerald"/></label>
      <label className="block text-sm font-medium">Şifrə<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-line bg-white px-4 py-3 outline-none focus:border-emerald"/></label>
      <Link href="/forgot-password" className="block text-right text-sm font-medium text-emerald">Şifrəmi unutdum</Link>
      {error && <div role="alert" className="text-sm text-red-700"><p>{error}</p>{portalLink && <Link href={portalLink.href} className="mt-2 inline-block font-semibold underline">{portalLink.label}</Link>}</div>}
      <button disabled={busy} className="w-full rounded-full bg-ink px-5 py-3.5 font-medium text-white hover:bg-emerald disabled:opacity-60">{busy ? "Yoxlanılır..." : "Daxil ol"}</button>
      <p className="text-center text-sm text-muted">Satıcı hesabınız var? <Link href="/vendor/login" className="font-medium text-emerald">Satıcı girişinə keçin</Link></p>
    </form>
  </>;
}