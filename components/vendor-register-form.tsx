"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { registrationErrorMessage } from "@/lib/auth-form-errors";
import { GoogleOAuthButton } from "@/components/google-oauth-button";

export default function VendorRegisterForm({ oauthError, portal }: { oauthError?: string; portal?: string | null }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const fields = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const response = await fetch("/api/auth/vendor-register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) });
      const data = await response.json().catch(() => ({}));
      if (data.requestAccepted && data.verificationPath) {
        router.replace(data.verificationPath);
        return;
      }
      if (!response.ok) throw new Error(registrationErrorMessage(data, data.error || "Qeydiyyat mümkün olmadı."));
      setError("Qeydiyyat sorğusu tamamlanmadı. Yenidən cəhd edin.");
    } catch (reason) { setError(reason instanceof TypeError ? "Bağlantı xətası. Məlumatlar saxlanılmadı; yenidən cəhd edin." : reason instanceof Error ? reason.message : "Qeydiyyat mümkün olmadı."); }
    finally { setBusy(false); }
  }
  const field = "mt-1.5 w-full rounded-xl border border-[#E1DED4] bg-white px-4 py-3 outline-none focus:border-[#D9A441]";
  return <>
    <GoogleOAuthButton intent="vendor" mode="register" nextPath="/vendor" errorCode={oauthError} portal={portal}/>
    <form onSubmit={submit} className="mt-7 space-y-4">
    <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Ad<input name="firstName" required maxLength={80} autoComplete="given-name" className={field}/></label><label className="text-sm font-medium">Soyad<input name="lastName" required maxLength={80} autoComplete="family-name" className={field}/></label></div>
    <label className="block text-sm font-medium">E-poçt<input name="email" type="email" required maxLength={254} autoComplete="email" className={field}/></label>
    <label className="block text-sm font-medium">Əlaqə telefonu<input name="phone" type="tel" required minLength={5} maxLength={40} autoComplete="tel" className={field}/></label>
    <label className="block text-sm font-medium">Şifrə<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" className={field}/><span className="mt-1 block text-xs font-normal text-slate-500">Ən azı 12 simvol.</span></label>
    {error&&<p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    <button disabled={busy} className="w-full rounded-full bg-[#0B1726] px-5 py-3.5 font-medium text-white disabled:opacity-50">{busy?"Hesab yaradılır…":"Satıcı hesabı yarat"}</button>
    <p className="text-center text-sm text-[#667085]">Hesabınız var? <Link className="font-medium text-[#9A701E]" href="/vendor/login">Satıcı girişinə keçin</Link></p>
    </form>
  </>;
}
