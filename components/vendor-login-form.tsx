"use client";

import { FormEvent, useRef, useState } from "react";
import Link from "next/link";
import { finishAuthNavigation } from "@/lib/auth-client";
import { isLoginPortal, publicLoginPortalLink, SELLER_APPLY_LOGIN_PATH } from "@/lib/login-portal";
import { GoogleOAuthButton } from "@/components/google-oauth-button";

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
    {notice && <p role="status" className="mt-6 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>}
    <GoogleOAuthButton intent="vendor" mode="login" nextPath="/vendor" errorCode={oauthError} portal={portal}/>
    <form onSubmit={submit} className="mt-7 space-y-4">
      <label className="block text-sm font-medium text-[#0B1726]">
        E-poçt
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-1.5 w-full rounded-xl border border-[#E1DED4] bg-white px-4 py-3 outline-none focus:border-[#D9A441]"
        />
      </label>

      <label className="block text-sm font-medium text-[#0B1726]">
        Şifrə
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-1.5 w-full rounded-xl border border-[#E1DED4] bg-white px-4 py-3 outline-none focus:border-[#D9A441]"
        />
      </label>

      <Link href="/forgot-password" className="block text-right text-sm font-medium text-[#9A701E]">
        Şifrəmi unutdum
      </Link>

      {error && (
        <div
          role="alert"
          className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <p>{error}</p>
          {applyHint
            ? <Link href={SELLER_APPLY_LOGIN_PATH} className="mt-2 inline-block font-semibold underline">Satıcı müraciətinə keç</Link>
            : portalLink && <Link href={portalLink.href} className="mt-2 inline-block font-semibold underline">{portalLink.label}</Link>}
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-full bg-[#0B1726] px-5 py-3.5 font-medium text-white transition hover:bg-[#17324A] disabled:opacity-50"
      >
        {busy ? "Yoxlanılır..." : "Satıcı kimi daxil ol"}
      </button>

      <p className="text-center text-sm text-[#667085]">
        Satıcı hesabınız yoxdur?{" "}
        <Link
          href="/vendor/apply"
          className="font-medium text-[#9A701E]"
        >
          Satıcı olmaq istəyirəm
        </Link>
      </p>

      <p className="text-center text-sm text-[#667085]">
        Müştəri hesabınıza <Link href="/login" className="font-medium text-[#9A701E]">müştəri girişindən</Link> daxil olun.
      </p>

      <Link
        href="/"
        className="block text-center text-sm text-[#667085]"
      >
        Ana səhifəyə qayıt
      </Link>
    </form>
  </>;
}
