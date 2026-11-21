"use client";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

/**
 * Password change (customer account, seller panel, admin). DESIGN-T10: the shared field and button (visible focus
 * ring, busy spinner); texts, field names, limits and the API call are unchanged.
 */
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
  return <form onSubmit={submit} className="mt-5 grid max-w-xl gap-4" aria-busy={busy || undefined}>
    <Input id="password-change-current" label="Cari şifrə" type="password" name="currentPassword" autoComplete="current-password" required maxLength={128}/>
    <Input id="password-change-new" label="Yeni şifrə" hint="Ən azı 12 simvol." type="password" name="newPassword" autoComplete="new-password" required minLength={12} maxLength={128}/>
    {error && <p role="alert" className="rounded-control bg-danger-subtle px-4 py-3 text-sm font-medium text-danger">{error}</p>}{message && <p role="status" className="rounded-control bg-primary-tint px-4 py-3 text-sm text-primary">{message}</p>}
    <Button type="submit" loading={busy} loadingLabel="Yadda saxlanır…" pill={false} className="w-fit">Şifrəni dəyiş</Button>
  </form>;
}
