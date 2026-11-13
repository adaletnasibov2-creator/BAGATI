"use client";

import { FormEvent, useRef, useState } from "react";
import Link from "next/link";
import { finishAuthNavigation } from "@/lib/auth-client";
import { isLoginPortal, loginPortalLinkLabel, loginPortalPath } from "@/lib/login-portal";
import AdminTwoFactorEnrollment from "@/components/admin-two-factor-enrollment";

type Step = "password" | "code" | "enroll";
const field = "rounded-xl border border-[#ded9cf] px-4 py-3 outline-none focus:border-[#bd9a5e]";

export default function AdminLoginForm() {
  const [step, setStep] = useState<Step>("password");
  const [error, setError] = useState("");
  const [portalHint, setPortalHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);
  const [totpAvailable, setTotpAvailable] = useState(true);
  const submitting = useRef(false);

  function fail(reason: unknown) {
    setError(reason instanceof TypeError ? "Bağlantı xətası. Yenidən cəhd edin." : reason instanceof Error ? reason.message : "Giriş alınmadı");
    submitting.current = false;
    setBusy(false);
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setError("");
    setPortalHint("");
    setBusy(true);
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(values),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setPortalHint(data.code === "WRONG_PORTAL" && isLoginPortal(data.portal) ? data.portal : "");
        throw new Error(data.error || "Giriş alınmadı");
      }
      if (data.next === "code" || data.next === "enroll") {
        setTotpAvailable(data.totpAvailable !== false);
        setUseRecovery(data.totpAvailable === false);
        setStep(data.next);
        submitting.current = false;
        setBusy(false);
        return;
      }
      finishAuthNavigation("/admin");
    } catch (reason) {
      fail(reason);
    }
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setError("");
    setBusy(true);
    const value = String(new FormData(event.currentTarget).get("secondFactor") ?? "");
    try {
      const response = await fetch("/api/admin/login/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(useRecovery ? { recoveryCode: value } : { code: value }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (data.code === "CHALLENGE_EXPIRED") setStep("password");
        throw new Error(data.error || "Giriş alınmadı");
      }
      finishAuthNavigation("/admin");
    } catch (reason) {
      fail(reason);
    }
  }

  const errorBox = error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700"><p>{error}</p>{isLoginPortal(portalHint) && <Link href={loginPortalPath(portalHint) ?? "/login"} className="mt-2 inline-block font-semibold underline">{loginPortalLinkLabel(portalHint)}</Link>}</div>;

  if (step === "enroll") {
    return <div className="mt-7 space-y-4">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">İki mərhələli təsdiq tələb olunur</p>
        <p className="mt-1">Admin panelinə daxil olmazdan əvvəl autentifikator tətbiqini qoşun. Giriş yalnız aktivləşdirmədən sonra açılır.</p>
      </div>
      <AdminTwoFactorEnrollment mode="login" onFinished={() => finishAuthNavigation("/admin")} />
      <button type="button" onClick={() => { setStep("password"); setError(""); }} className="text-sm font-medium text-[#9a701e]">← Başqa hesabla daxil ol</button>
    </div>;
  }

  if (step === "code") {
    return <form onSubmit={submitCode} className="mt-7 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-[#0b1726]">{useRecovery ? "Bərpa kodu" : "Təsdiq kodu"}</h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">{useRecovery
          ? "Saxladığınız bərpa kodlarından birini daxil edin. Hər kod yalnız bir dəfə işləyir."
          : "Autentifikator tətbiqindəki 6 rəqəmli kodu daxil edin."}</p>
      </div>
      <label className="grid gap-1.5 text-sm font-medium">
        {useRecovery ? "Bərpa kodu" : "6 rəqəmli kod"}
        <input
          key={useRecovery ? "recovery" : "totp"}
          className={`${field} text-center font-mono text-lg tracking-[.3em]`}
          name="secondFactor"
          inputMode={useRecovery ? "text" : "numeric"}
          autoComplete="one-time-code"
          autoCapitalize="characters"
          maxLength={useRecovery ? 11 : 7}
          placeholder={useRecovery ? "XXXXX-XXXXX" : "000000"}
          required
          autoFocus
        />
      </label>
      {!totpAvailable && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Autentifikator kodu hazırda yoxlanıla bilmir. Bərpa kodundan istifadə edin.</p>}
      {errorBox}
      <button disabled={busy} className="w-full rounded-xl bg-[#0b1726] px-4 py-3 font-semibold text-white disabled:opacity-50">{busy ? "Yoxlanılır…" : "Təsdiqlə və daxil ol"}</button>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        {totpAvailable && <button type="button" onClick={() => { setUseRecovery(!useRecovery); setError(""); }} className="font-medium text-[#9a701e]">{useRecovery ? "Autentifikator kodu istifadə et" : "Bərpa kodu istifadə et"}</button>}
        <button type="button" onClick={() => { setStep("password"); setError(""); }} className="font-medium text-slate-500">← Geri</button>
      </div>
    </form>;
  }

  return <form onSubmit={submitPassword} className="mt-7 space-y-4">
    <label className="grid gap-1.5 text-sm font-medium">İdarəçi e-poçtu<input className={field} type="email" name="email" autoComplete="username" required /></label>
    <label className="grid gap-1.5 text-sm font-medium">Şifrə<input className={field} type="password" name="password" autoComplete="current-password" required /></label>
    <Link href="/forgot-password" className="block text-right text-sm font-medium text-[#9a701e]">Şifrəmi unutdum</Link>
    {errorBox}
    <button disabled={busy} className="w-full rounded-xl bg-[#0b1726] px-4 py-3 font-semibold text-white disabled:opacity-50">{busy ? "Yoxlanılır…" : "Admin panelinə daxil ol"}</button>
  </form>;
}
