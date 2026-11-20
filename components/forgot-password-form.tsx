"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Sorğunu emal etmək mümkün olmadı.");
      setMessage(data.message || "Sorğu qəbul edildi.");
    } catch (reason) {
      setError(reason instanceof TypeError ? "Bağlantı xətası. Yenidən cəhd edin." : reason instanceof Error ? reason.message : "Sorğunu emal etmək mümkün olmadı.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-7 space-y-4">
      {/* DESIGN-T9: shared field and button (visible focus ring); request and texts unchanged. */}
      <Input id="forgot-email" label="Hesab e-poçtu" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />
      <p className="text-sm leading-6 text-fg-secondary">Google ilə yaradılmış hesablar üçün Google ilə daxil olun; bu formada onlar üçün şifrə bərpa məktubu göndərilmir.</p>
      {message && <p role="status" className="rounded-control bg-primary-tint px-4 py-3 text-sm text-primary">{message}</p>}
      {error && <p role="alert" className="rounded-control bg-danger-subtle px-4 py-3 text-sm font-medium text-danger">{error}</p>}
      <Button type="submit" size="lg" fullWidth disabled={busy} loading={busy} loadingLabel="Göndərilir…">Bərpa keçidi istə</Button>
    </form>
  );
}
