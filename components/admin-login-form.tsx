"use client";

import { FormEvent, useRef, useState } from "react";
import Link from "next/link";
import { finishAuthNavigation } from "@/lib/auth-client";
import { isLoginPortal, loginPortalLinkLabel, loginPortalPath } from "@/lib/login-portal";

export default function AdminLoginForm() {
  const [error, setError] = useState("");
  const [portalHint, setPortalHint] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
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
      finishAuthNavigation("/admin");
    } catch (reason) {
      setError(reason instanceof TypeError ? "Bağlantı xətası. Yenidən cəhd edin." : reason instanceof Error ? reason.message : "Giriş alınmadı");
      submitting.current = false;
      setBusy(false);
    }
  }

  return <form onSubmit={submit} className="mt-7 space-y-4">
    <label className="grid gap-1.5 text-sm font-medium">İdarəçi e-poçtu<input className="rounded-xl border border-[#ded9cf] px-4 py-3 outline-none focus:border-[#bd9a5e]" type="email" name="email" autoComplete="username" required /></label>
    <label className="grid gap-1.5 text-sm font-medium">Şifrə<input className="rounded-xl border border-[#ded9cf] px-4 py-3 outline-none focus:border-[#bd9a5e]" type="password" name="password" autoComplete="current-password" required /></label>
    <Link href="/forgot-password" className="block text-right text-sm font-medium text-[#9a701e]">Şifrəmi unutdum</Link>
    {error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700"><p>{error}</p>{isLoginPortal(portalHint) && <Link href={loginPortalPath(portalHint) ?? "/login"} className="mt-2 inline-block font-semibold underline">{loginPortalLinkLabel(portalHint)}</Link>}</div>}
    <button disabled={busy} className="w-full rounded-xl bg-[#0b1726] px-4 py-3 font-semibold text-white disabled:opacity-50">{busy ? "Yoxlanılır…" : "Admin panelinə daxil ol"}</button>
  </form>;
}
