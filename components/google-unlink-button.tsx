"use client";

import { useState } from "react";

export function GoogleUnlinkButton({ canUnlink }: { canUnlink: boolean }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function unlink() {
    if (!canUnlink || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/google/unlink", { method: "POST", credentials: "same-origin" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "Google bağlantısı silinmədi.");
        setBusy(false);
        return;
      }
      const next = new URL(window.location.href);
      next.searchParams.set("oauth", "unlinked");
      window.location.assign(next.toString());
    } catch {
      setError("Bağlantı xətası. Yenidən cəhd edin.");
      setBusy(false);
    }
  }

  return <div className="mt-3">
    <p className="text-sm text-emerald-800">Google hesabı bu BAGATI hesabına bağlıdır.</p>
    {canUnlink
      ? <button type="button" onClick={() => void unlink()} disabled={busy} className="mt-3 rounded-full border border-[#E4E8E4] px-4 py-2 text-sm font-semibold text-[#173A3A] hover:bg-[#F6F7F4] disabled:opacity-60">{busy ? "Silinir..." : "Google bağlantısını sil"}</button>
      : <p className="mt-2 text-sm text-[#667085]">Google bağlantısını silmək mümkün deyil, çünki hesabda başqa giriş üsulu yoxdur.</p>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
  </div>;
}
