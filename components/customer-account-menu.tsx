"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { LogOut, UserRound } from "lucide-react";
import { finishAuthNavigation, postLogout } from "@/lib/auth-client";
import { useDismissibleDetails } from "@/components/use-dismissible-details";

type AccountIdentity = { email: string; displayName: string; role: "CUSTOMER" | "VENDOR" | "ADMIN" };

/** messagesUnread: null while messaging is OFF (no "Mesajlarım" entry); otherwise the unread conversation count. */
export function CustomerAccountMenu({ user, messagesUnread = null }: { user: AccountIdentity | null; messagesUnread?: number | null }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  // Same closing rules as the category menu: route change, link click, outside click, Escape (DESIGN-T6).
  const menu = useDismissibleDetails();
  async function logout() {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    const result = await postLogout();
    if (!result.ok) { setError(result.error); submitting.current = false; setBusy(false); return; }
    finishAuthNavigation("/");
  }
  if (!user) return <div className="flex items-center gap-1">
    <Link href="/login" aria-label="Giriş" className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-2 text-sm font-semibold text-fg transition-colors hover:bg-primary-subtle hover:text-primary active:bg-primary-tint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:px-3"><UserRound aria-hidden="true" size={24} strokeWidth={2} className="text-icon"/><span className="hidden lg:inline">Giriş</span></Link>
    <Link href="/register" className="hidden min-h-11 items-center rounded-full border border-primary bg-white px-4 text-sm font-semibold text-primary transition-colors hover:bg-primary-subtle active:bg-primary-tint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus xl:inline-flex">Qeydiyyat</Link>
  </div>;
  const roleLabel = user.role === "VENDOR" ? "Satıcı hesabı" : user.role === "ADMIN" ? "İdarəçi hesabı" : "Müştəri hesabı";
  const initials = user.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("az-AZ")).join("") || "B";
  const links = user.role === "VENDOR" ? [["/vendor", "Satıcı kabineti"]]
    : user.role === "ADMIN" ? [["/admin", "İdarəetmə paneli"]]
    : [["/account", "Hesab icmalı"], ["/orders", "Sifarişlərim"], ...(messagesUnread === null ? [] : [["/account/messages", "Mesajlarım"]]), ["/account/returns", "Qaytarılma sorğuları"], ["/account/addresses", "Ünvanlarım"], ["/favorites", "Sevimlilər"], ["/account/notifications", "Bildirişlər"], ["/account/security", "Təhlükəsizlik"]];
  return <details ref={menu.ref} className="group relative" onToggle={menu.onToggle} onClick={menu.onClick}>
    <summary aria-label={`${user.displayName}, ${roleLabel}`} className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full border border-transparent px-1.5 text-sm font-semibold text-fg transition-colors hover:border-line hover:bg-primary-subtle active:bg-primary-tint group-open:border-line group-open:bg-primary-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none sm:pl-1.5 sm:pr-3 [&::-webkit-details-marker]:hidden"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold tracking-wide text-white ring-2 ring-white" aria-hidden="true">{initials}</span><span className="hidden max-w-36 truncate lg:inline">{user.displayName}</span>{messagesUnread ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-gold-700 px-1 text-[11px] font-bold text-white" aria-label={`${messagesUnread} oxunmamış söhbət`}>{messagesUnread > 9 ? "9+" : messagesUnread}</span> : null}</summary>
    <div className="absolute right-0 z-50 mt-2 w-64 rounded-card border border-line bg-white p-2 shadow-overlay">
      <p className="truncate px-3 pt-2 text-sm font-semibold text-fg">{user.displayName}</p><p className="truncate px-3 pb-2 text-xs text-fg-muted">{user.email}</p><p className="px-3 pb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">{roleLabel}</p>
      {links.map(([href, label]) => <Link key={href} href={href} className="flex min-h-11 items-center justify-between gap-2 rounded-control px-3 py-2.5 text-sm text-fg-body transition-colors hover:bg-primary-subtle hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus">{label}{href === "/account/messages" && messagesUnread ? <span className="rounded-full bg-gold-700 px-1.5 py-0.5 text-[11px] font-bold text-white">{messagesUnread > 99 ? "99+" : messagesUnread}</span> : null}</Link>)}
      {error && <p role="alert" className="px-3 py-2 text-xs text-danger">{error}</p>}
      <button type="button" disabled={busy} onClick={() => void logout()} className="mt-1 flex min-h-11 w-full items-center gap-2 rounded-control border-t border-line px-3 pt-2 text-left text-sm font-medium text-fg-body transition-colors hover:bg-primary-subtle hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus disabled:opacity-60"><LogOut size={16}/>{busy ? "Çıxış edilir…" : "Hesabdan çıx"}</button>
    </div>
  </details>;
}
