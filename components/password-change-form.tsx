"use client";
import { FormEvent, useState } from "react";

export function PasswordChangeForm() {
  const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage(""); setBusy(true);
    const form = event.currentTarget; const values = Object.fromEntries(new FormData(form).entries());
    try {
      const response = await fetch("/api/account/security/password", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Şifrə dəyişdirilmədi.");
      form.reset(); setMessage(result.message);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Şifrə dəyişdirilmədi."); }
    finally { setBusy(false); }
  }
  const field = "rounded-xl border border-[#ded9cf] px-4 py-3 outline-none focus:border-[#bd9a5e]";
  return <form onSubmit={submit} className="mt-5 grid max-w-xl gap-4">
    <label className="grid gap-1.5 text-sm font-medium">Cari şifrə<input className={field} type="password" name="currentPassword" autoComplete="current-password" required maxLength={128}/></label>
    <label className="grid gap-1.5 text-sm font-medium">Yeni şifrə<input className={field} type="password" name="newPassword" autoComplete="new-password" required minLength={12} maxLength={128}/><span className="text-xs font-normal text-slate-500">Ən azı 12 simvol.</span></label>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}{message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    <button disabled={busy} className="w-fit rounded-xl bg-[#142d38] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Yadda saxlanır…" : "Şifrəni dəyiş"}</button>
  </form>;
}
