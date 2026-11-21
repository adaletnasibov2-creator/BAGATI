"use client";

import { FormEvent, useEffect, useState } from "react";
import { TextLink } from "@/components/ui/text-link";
import { finishAuthNavigation } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

type Challenge = { status: "ready"; role: "CUSTOMER" | "VENDOR"; emailHint: string; destination: string } | { status: string };

export function GoogleLinkPanel() {
  const [challenge, setChallenge] = useState<Challenge | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/google/link", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json())
      .then((data: Challenge) => setChallenge(data))
      .catch(() => setChallenge({ status: "invalid" }));
    return () => controller.abort();
  }, []);

  if (!challenge) return <p role="status" className="mt-3 text-sm text-fg-secondary">Yoxlanılır…</p>;
  if (challenge.status !== "ready" || !("role" in challenge)) {
    const message = challenge.status === "unavailable"
      ? "Google bağlantısı bu serverdə hələ saxlanıla bilmir. E-poçt və şifrə ilə daxil olun."
      : challenge.status === "reused"
        ? "Bu Google təsdiqi artıq istifadə olunub. Google ilə yenidən davam edin."
        : "Google təsdiqinin vaxtı bitib və ya tapılmadı. Google ilə yenidən davam edin.";
    return (
      <>
        <p className="mt-3 text-sm leading-6 text-fg-secondary">{message}</p>
        <nav className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <TextLink href="/login" className="inline-flex min-h-11 items-center">Müştəri girişi</TextLink>
          <TextLink href="/vendor/login" className="inline-flex min-h-11 items-center">Satıcı girişi</TextLink>
        </nav>
      </>
    );
  }

  const destination = challenge.role === "VENDOR" ? "/vendor" : "/account";
  const portalLabel = challenge.role === "VENDOR" ? "satıcı paneli" : "müştəri paneli";
  return (
    <>
      <p className="mt-3 text-sm leading-6 text-fg-secondary">
        Bu Google e-poçtu mövcud BAGATI hesabına uyğundur. Hesablar avtomatik birləşdirilmir. Şifrəni bir dəfə təsdiqləyin, sonra {portalLabel} açılacaq.
      </p>
      {challenge.emailHint && <p className="mt-4 rounded-control bg-surface-sunken px-4 py-3 text-sm font-medium text-fg">{challenge.emailHint}</p>}
      <GoogleLinkForm destination={destination} />
    </>
  );
}

function GoogleLinkForm({ destination }: { destination: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/google/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Təsdiq alınmadı.");
      const redirect = typeof data.redirect === "string" ? data.redirect : destination;
      const samePortal = destination === "/vendor"
        ? redirect === "/vendor" || redirect.startsWith("/vendor/")
        : redirect.startsWith("/") && !redirect.startsWith("//") && !redirect.startsWith("/vendor") && !redirect.startsWith("/admin");
      finishAuthNavigation(samePortal ? redirect : destination);
    } catch (reason) {
      setError(reason instanceof TypeError ? "Bağlantı xətası. Yenidən cəhd edin." : reason instanceof Error ? reason.message : "Təsdiq alınmadı.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-4">
      {/* DESIGN-T9: shared field and button (visible focus ring); request and texts unchanged. */}
      <Input id="google-link-password" label="BAGATI şifrəsi" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
      {error && <p role="alert" className="rounded-control bg-danger-subtle px-4 py-3 text-sm font-medium text-danger">{error}</p>}
      <Button type="submit" size="lg" fullWidth disabled={busy} loading={busy} loadingLabel="Təsdiqlənir…">Təsdiqlə və davam et</Button>
    </form>
  );
}
