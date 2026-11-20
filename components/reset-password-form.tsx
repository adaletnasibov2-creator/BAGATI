"use client";

import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { TextLink } from "@/components/ui/text-link";

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
    return <p role="status" className="mt-7 text-sm text-fg-secondary">Bərpa keçidi yoxlanılır…</p>;
  }

  if (!activeToken) {
    return <div className="mt-7 space-y-4"><p role="alert" className="rounded-control bg-danger-subtle px-4 py-3 text-sm font-medium text-danger">Bərpa keçidi tapılmadı və ya yanlışdır.</p><TextLink href="/forgot-password" className="inline-flex min-h-11 items-center text-sm">Yeni keçid istə</TextLink></div>;
  }

  return (
    <form onSubmit={submit} className="mt-7 space-y-4">
      {/* DESIGN-T9: shared fields and button (visible focus ring); the token handling above is unchanged. */}
      <Input id="reset-password" label="Yeni şifrə" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} />
      <Input id="reset-password-confirm" label="Yeni şifrəni təkrar yazın" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
      {message && <p role="status" className="rounded-control bg-primary-tint px-4 py-3 text-sm text-primary">{message} <TextLink href="/login">Daxil ol</TextLink></p>}
      {error && <p role="alert" className="rounded-control bg-danger-subtle px-4 py-3 text-sm font-medium text-danger">{error}</p>}
      <Button type="submit" size="lg" fullWidth disabled={busy} loading={busy} loadingLabel="Yenilənir…">Şifrəni yenilə</Button>
    </form>
  );
}
