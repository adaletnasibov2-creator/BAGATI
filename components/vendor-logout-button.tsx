"use client";
import { useRef, useState } from "react";
import { finishAuthNavigation, postLogout } from "@/lib/auth-client";
export default function VendorLogoutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  async function logout() {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    const result = await postLogout();
    if (!result.ok) { setError(result.error); submitting.current = false; setBusy(false); return; }
    finishAuthNavigation("/vendor/login");
  }
  return <span className="text-right"><button type="button" disabled={busy} onClick={() => void logout()} className="inline-flex min-h-11 items-center rounded-xl px-2 text-sm text-slate-600 hover:bg-[#f7f5ef] hover:text-[#85621d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9973a] disabled:opacity-60">{busy ? "Çıxış edilir…" : "Çıxış"}</button>{error && <span role="alert" className="block max-w-40 text-xs text-red-700">{error}</span>}</span>;
}
