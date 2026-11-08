"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { finishAuthNavigation } from "@/lib/auth-client";

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

  if (!challenge) return <p className="mt-3 text-sm text-[#667085]">Yoxlanılır…</p>;
  if (challenge.status !== "ready" || !("role" in challenge)) {
    const message = challenge.status === "unavailable"
      ? "Google bağlantısı bu serverdə hələ saxlanıla bilmir. E-poçt və şifrə ilə daxil olun."
      : challenge.status === "reused"
        ? "Bu Google təsdiqi artıq istifadə olunub. Google ilə yenidən davam edin."
        : "Google təsdiqinin vaxtı bitib və ya tapılmadı. Google ilə yenidən davam edin.";
    return (
      <>
        <p className="mt-3 text-sm leading-6 text-[#667085]">{message}</p>
        <nav className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-sm font-semibold text-[#85621d] underline">
          <Link href="/login">Müştəri girişi</Link>
          <Link href="/vendor/login">Satıcı girişi</Link>
        </nav>
      </>
    );
  }

  const destination = challenge.role === "VENDOR" ? "/vendor" : "/account";
  const portalLabel = challenge.role === "VENDOR" ? "satıcı paneli" : "müştəri paneli";
  return (
    <>
      <p className="mt-3 text-sm leading-6 text-[#667085]">
        Bu Google e-poçtu mövcud BAGATI hesabına uyğundur. Hesablar avtomatik birləşdirilmir. Şifrəni bir dəfə təsdiqləyin, sonra {portalLabel} açılacaq.
      </p>
      {challenge.emailHint && <p className="mt-4 rounded-xl bg-[#F7F5EF] px-4 py-3 text-sm font-medium text-[#0B1726]">{challenge.emailHint}</p>}
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
      <label className="block text-sm font-medium text-[#16202C]">
        BAGATI şifrəsi
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-1.5 w-full rounded-xl border border-[#E1DED4] bg-white px-4 py-3 outline-none focus:border-[#C49A50]"
        />
      </label>
      {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      <button disabled={busy} className="w-full rounded-full bg-[#0B1726] px-5 py-3.5 font-medium text-white disabled:opacity-60">
        {busy ? "Təsdiqlənir…" : "Təsdiqlə və davam et"}
      </button>
    </form>
  );
}
