"use client";

import { useRef, useState } from "react";
import { finishAuthNavigation, postLogout } from "@/lib/auth-client";

export function AccountSwitchBar({ email, roleLabel, returnTo }: { email: string; roleLabel: string; returnTo: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);

  async function logout() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    const result = await postLogout();
    if (!result.ok) {
      setError(result.error);
      submitting.current = false;
      setBusy(false);
      return;
    }
    finishAuthNavigation(returnTo);
  }

  return <div className="mt-6 rounded-xl border border-[#E6E0D2] bg-[#FBF8F1] px-4 py-3 text-sm leading-6 text-[#3E4A46]">
    <p>Hazırda <span className="font-semibold text-[#0B1726]">{email}</span> ({roleLabel}) hesabındasınız.</p>
    <p className="mt-1">Başqa e-poçt və şifrə ilə daxil olmaq bu sessiyanı bağlayır və yeni hesabı açır. Çıxış etmədən də başqa hesabla daxil ola bilərsiniz.</p>
    <button type="button" disabled={busy} onClick={() => void logout()} className="mt-3 min-h-11 rounded-full border border-[#D9CDB4] px-4 py-2 text-sm font-medium text-[#6B5424] hover:bg-white disabled:opacity-60">{busy ? "Çıxış edilir…" : "Bu hesabdan çıx"}</button>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
  </div>;
}
