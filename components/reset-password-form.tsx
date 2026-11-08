"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

export function ResetPasswordForm({ token }: { token: string }) {
  const [activeToken, setActiveToken] = useState(token);
  const [tokenReady, setTokenReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const fragmentToken = new URLSearchParams(window.location.hash.slice(1)).get("token");
    if (fragmentToken) {
      setActiveToken(fragmentToken);
    }
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("token");
    cleanUrl.hash = "";
    if (cleanUrl.href !== window.location.href) {
      window.history.replaceState(null, "", `${cleanUrl.pathname}${cleanUrl.search}`);
    }
    setTokenReady(true);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (password !== confirmation) {
      setError("Şifrələr uyğun gəlmir.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        referrerPolicy: "no-referrer",
        body: JSON.stringify({ token: activeToken, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Şifrəni yeniləmək mümkün olmadı.");
      setMessage(data.message || "Şifrə yeniləndi.");
      setPassword("");
      setConfirmation("");
    } catch (reason) {
      setError(reason instanceof TypeError ? "Bağlantı xətası. Yenidən cəhd edin." : reason instanceof Error ? reason.message : "Şifrəni yeniləmək mümkün olmadı.");
    } finally {
      setBusy(false);
    }
  }

  if (!tokenReady) {
    return <p role="status" className="mt-7 text-sm text-[#667085]">Bərpa keçidi yoxlanılır…</p>;
  }

  if (!activeToken) {
    return <div className="mt-7 space-y-4"><p role="alert" className="text-sm text-red-700">Bərpa keçidi tapılmadı və ya yanlışdır.</p><Link href="/forgot-password" className="text-sm font-medium text-[#9A701E]">Yeni keçid istə</Link></div>;
  }

  return (
    <form onSubmit={submit} className="mt-7 space-y-4">
      <label className="block text-sm font-medium text-[#0B1726]">
        Yeni şifrə
        <input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-[#E1DED4] bg-white px-4 py-3 outline-none focus:border-[#D9A441]" />
      </label>
      <label className="block text-sm font-medium text-[#0B1726]">
        Yeni şifrəni təkrar yazın
        <input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-1.5 w-full rounded-xl border border-[#E1DED4] bg-white px-4 py-3 outline-none focus:border-[#D9A441]" />
      </label>
      {message && <p role="status" className="rounded-xl bg-green-50 px-4 py-3 text-sm text-green-800">{message} <Link href="/login" className="font-medium underline">Daxil ol</Link></p>}
      {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={busy} className="w-full rounded-full bg-[#0B1726] px-5 py-3.5 font-medium text-white disabled:opacity-50">
        {busy ? "Yenilənir…" : "Şifrəni yenilə"}
      </button>
    </form>
  );
}
