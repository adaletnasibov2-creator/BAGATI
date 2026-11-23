"use client";

import { FormEvent, useRef, useState } from "react";
import Link from "next/link";
import { finishAuthNavigation } from "@/lib/auth-client";
import { isLoginPortal, publicLoginPortalLink } from "@/lib/login-portal";
import { GoogleOAuthButton } from "@/components/google-oauth-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { TextLink } from "@/components/ui/text-link";

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
    {notice && <p role="status" className="mt-6 rounded-control bg-primary-tint px-4 py-3 text-sm text-primary">{notice}</p>}
    <GoogleOAuthButton intent="customer" mode="login" nextPath={nextPath} errorCode={oauthError} portal={portal}/>
    <form onSubmit={submit} className="mt-7 space-y-4">
      <Input id="login-email" label="E-poçt" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)}/>
      <Input id="login-password" label="Şifrə" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)}/>
      <div className="-mt-1 text-right"><TextLink href="/forgot-password" underline={false} className="inline-flex min-h-11 items-center text-sm">Şifrəmi unutdum</TextLink></div>
      {error && <div role="alert" className="text-sm text-danger"><p>{error}</p>{portalLink && <Link href={portalLink.href} className="mt-2 inline-block font-semibold underline">{portalLink.label}</Link>}</div>}
      <Button type="submit" size="lg" fullWidth loading={busy} loadingLabel="Yoxlanılır...">Daxil ol</Button>
      <p className="text-center text-sm text-muted">Satıcı hesabınız var? <TextLink href="/vendor/login">Satıcı girişinə keçin</TextLink></p>
    </form>
    {/* SIGNUP-EASY-2 T4: plain hint, no logic. */}
    <p className="mt-4 text-center text-sm text-muted">Hesabınızı Google ilə yaratmısınızsa, «Google ilə davam et» düyməsindən istifadə edin.</p>
  </>;
}