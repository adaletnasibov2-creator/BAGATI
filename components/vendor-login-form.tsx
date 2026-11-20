"use client";

import { FormEvent, useRef, useState } from "react";
import Link from "next/link";
import { finishAuthNavigation } from "@/lib/auth-client";
import { isLoginPortal, publicLoginPortalLink, SELLER_APPLY_LOGIN_PATH } from "@/lib/login-portal";
import { GoogleOAuthButton } from "@/components/google-oauth-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { TextLink } from "@/components/ui/text-link";

export function VendorLoginForm({ oauthError, notice, portal }: { oauthError?: string; notice?: string; portal?: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [portalHint, setPortalHint] = useState("");
  const [applyHint, setApplyHint] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setPortalHint("");
    setApplyHint(false);

    try {
      const response = await fetch("/api/auth/vendor-login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          email,
          password,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (data.requiresEmailVerification && data.verificationPath) {
        const params = new URLSearchParams({ from: "login" });
        window.location.replace(`${data.verificationPath}?${params.toString()}`);
        return;
      }

      if (!response.ok) {
        setPortalHint(data.code === "WRONG_PORTAL" && isLoginPortal(data.portal) ? data.portal : "");
        setApplyHint(data.code === "WRONG_PORTAL" && data.applyPath === SELLER_APPLY_LOGIN_PATH);
        throw new Error(data.error || "Giriş alınmadı.");
      }

      if (data.user?.role !== "VENDOR") {
        throw new Error("Satıcı girişi təsdiqlənmədi. Yenidən cəhd edin.");
      }

      finishAuthNavigation("/vendor");
    } catch (err) {
      setError(
        err instanceof TypeError
          ? "Bağlantı xətası. İnternet bağlantısını yoxlayıb yenidən cəhd edin."
          : err instanceof Error
          ? err.message
          : "Giriş alınmadı."
      );
      submitting.current = false;
      setBusy(false);
    }
  }

  const portalLink = publicLoginPortalLink(portalHint);
  return <>
    {notice && <p role="status" className="mt-6 rounded-control bg-primary-tint px-4 py-3 text-sm text-primary">{notice}</p>}
    <GoogleOAuthButton intent="vendor" mode="login" nextPath="/vendor" errorCode={oauthError} portal={portal}/>
    <form onSubmit={submit} className="mt-7 space-y-4">
      {/* DESIGN-T8: the same shared fields, links and button as the customer login form; texts unchanged. */}
      <Input id="vendor-login-email" label="E-poçt" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)}/>
      <Input id="vendor-login-password" label="Şifrə" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)}/>
      <div className="-mt-1 text-right"><TextLink href="/forgot-password" underline={false} className="inline-flex min-h-11 items-center text-sm">Şifrəmi unutdum</TextLink></div>

      {error && (
        <div
          role="alert"
          className="text-sm text-danger"
        >
          <p>{error}</p>
          {applyHint
            ? <Link href={SELLER_APPLY_LOGIN_PATH} className="mt-2 inline-block font-semibold underline">Satıcı müraciətinə keç</Link>
            : portalLink && <Link href={portalLink.href} className="mt-2 inline-block font-semibold underline">{portalLink.label}</Link>}
        </div>
      )}

      <Button type="submit" size="lg" fullWidth disabled={busy} loading={busy} loadingLabel="Yoxlanılır...">Satıcı kimi daxil ol</Button>

      <p className="text-center text-sm text-muted">
        Satıcı hesabınız yoxdur?{" "}
        <TextLink href="/vendor/apply">Satıcı olmaq istəyirəm</TextLink>
      </p>

      <p className="text-center text-sm text-muted">
        Müştəri hesabınıza <TextLink href="/login">müştəri girişindən</TextLink> daxil olun.
      </p>

      <TextLink href="/" underline={false} className="mx-auto flex min-h-11 w-fit items-center text-sm">Ana səhifəyə qayıt</TextLink>
    </form>
  </>;
}
