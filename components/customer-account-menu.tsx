"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { LogOut, UserRound } from "lucide-react";
import { finishAuthNavigation, postLogout } from "@/lib/auth-client";

type AccountIdentity = { email: string; displayName: string; role: "CUSTOMER" | "VENDOR" | "ADMIN" };

export function CustomerAccountMenu({ user }: { user: AccountIdentity | null }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  async function logout() {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    const result = await postLogout();
    if (!result.ok) { setError(result.error); submitting.current = false; setBusy(false); return; }
    finishAuthNavigation("/");
  }
  if (!user) return <div className="flex items-center gap-1">
    <Link href="/login" aria-label="Giriş" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-[#24413D] transition hover:bg-[#EFF4F1] sm:px-3"><UserRound size={18}/><span className="hidden lg:inline">Giriş</span></Link>
    <Link href="/register" className="hidden min-h-11 items-center rounded-full border border-[#D9E3DD] px-4 text-sm font-semibold text-[#42645C] transition hover:bg-[#EFF4F1] xl:inline-flex">Qeydiyyat</Link>
  </div>;
  const roleLabel = user.role === "VENDOR" ? "Satıcı hesabı" : user.role === "ADMIN" ? "İdarəçi hesabı" : "Müştəri hesabı";
  const initials = user.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("az-AZ")).join("") || "B";
  const links = user.role === "VENDOR" ? [["/vendor", "Satıcı kabineti"]]
    : user.role === "ADMIN" ? [["/admin", "İdarəetmə paneli"]]
    : [["/account", "Hesab icmalı"], ["/orders", "Sifarişlərim"], ["/account/returns", "Qaytarılma sorğuları"], ["/account/addresses", "Ünvanlarım"], ["/favorites", "Sevimlilər"], ["/account/notifications", "Bildirişlər"], ["/account/security", "Təhlükəsizlik"]];
  return <details className="group relative">
    <summary aria-label={`${user.displayName}, ${roleLabel}`} className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-2 text-sm font-semibold text-[#24413D] transition hover:bg-[#EFF4F1] sm:px-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#E5EEE8] text-xs font-bold text-[#42645C]" aria-hidden="true">{initials}</span><span className="hidden max-w-36 truncate lg:inline">{user.displayName}</span></summary>
    <div className="absolute right-0 z-50 mt-2 w-64 rounded-2xl border border-[#E1E9E4] bg-white p-2 shadow-[0_18px_45px_rgba(23,58,58,.15)]">
      <p className="truncate px-3 pt-2 text-sm font-semibold text-[#24413D]">{user.displayName}</p><p className="truncate px-3 pb-2 text-xs text-[#75817F]">{user.email}</p><p className="px-3 pb-2 text-[11px] font-medium uppercase tracking-wide text-[#638078]">{roleLabel}</p>
      {links.map(([href, label]) => <Link key={href} href={href} className="block rounded-xl px-3 py-2.5 text-sm text-[#405451] transition hover:bg-[#F2F6F3]">{label}</Link>)}
      {error && <p role="alert" className="px-3 py-2 text-xs text-red-700">{error}</p>}
      <button type="button" disabled={busy} onClick={() => void logout()} className="mt-1 flex min-h-11 w-full items-center gap-2 border-t border-[#E9EEEA] px-3 pt-2 text-left text-sm font-medium text-[#42645C] disabled:opacity-60"><LogOut size={16}/>{busy ? "Çıxış edilir…" : "Hesabdan çıx"}</button>
    </div>
  </details>;
}
