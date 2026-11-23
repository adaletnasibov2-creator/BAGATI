"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { headerActionCircle, headerActionCircleBase, headerActionItem, headerActionLabel } from "@/components/header-actions";
import { UserIcon } from "@/components/header-icons";
import { cx } from "@/components/ui/cx";
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
    <Link href="/login" data-header-action="" className={headerActionItem}><span data-header-circle="" className={headerActionCircle}><UserIcon size={30} /></span><span data-header-label="" className={headerActionLabel}>Giriş</span></Link>
    <Link href="/register" className="hidden min-h-11 items-center rounded-full border border-primary bg-white px-4 text-sm font-semibold text-primary transition-colors hover:bg-primary-subtle active:bg-primary-tint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus xl:inline-flex">Qeydiyyat</Link>
  </div>;
  const roleLabel = user.role === "VENDOR" ? "Satıcı hesabı" : user.role === "ADMIN" ? "İdarəçi hesabı" : "Müştəri hesabı";
  const initials = user.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("az-AZ")).join("") || "B";
  const links = user.role === "VENDOR" ? [["/vendor", "Satıcı kabineti"]]
    : user.role === "ADMIN" ? [["/admin", "İdarəetmə paneli"]]
    : [["/account", "Hesab icmalı"], ["/orders", "Sifarişlərim"], ...(messagesUnread === null ? [] : [["/account/messages", "Mesajlarım"]]), ["/account/returns", "Qaytarılma sorğuları"], ["/account/addresses", "Ünvanlarım"], ["/favorites", "Sevimlilər"], ["/account/notifications", "Bildirişlər"], ["/account/security", "Təhlükəsizlik"]];
  return <details ref={menu.ref} className="group relative" onToggle={menu.onToggle} onClick={menu.onClick}>
    {/* DESIGN-POLISH-2: the avatar (36 px, solid primary, white initials, 2 px #e1ece8 ring) above "Hesabım". The name starts with the
        visible label (WCAG 2.5.3) and keeps the name and role for screen readers. */}
    <summary aria-label={`Hesabım, ${user.displayName}, ${roleLabel}`} data-header-action="" className={cx(headerActionItem, "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}><span data-header-circle="" className={cx(headerActionCircleBase, "group-hover/action:bg-brand-100 group-active/action:bg-brand-100 group-open:bg-brand-100")}><span className="grid h-9 w-9 place-items-center rounded-full bg-primary text-xs font-bold tracking-wide text-white ring-2 ring-brand-100" aria-hidden="true">{initials}</span>{messagesUnread ? <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full border-2 border-white bg-gold-700 px-1 text-[12px] font-medium leading-none text-white" aria-label={`${messagesUnread} oxunmamış söhbət`}>{messagesUnread > 9 ? "9+" : messagesUnread}</span> : null}</span><span data-header-label="" className={headerActionLabel}>Hesabım</span></summary>
    <div className="absolute right-0 z-50 mt-2 w-64 rounded-card border border-line bg-white p-2 shadow-overlay">
      <p className="truncate px-3 pt-2 text-sm font-semibold text-fg">{user.displayName}</p><p className="truncate px-3 pb-2 text-xs text-fg-muted">{user.email}</p><p className="px-3 pb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">{roleLabel}</p>
      {links.map(([href, label]) => <Link key={href} href={href} className="flex min-h-11 items-center justify-between gap-2 rounded-control px-3 py-2.5 text-sm text-fg-body transition-colors hover:bg-primary-subtle hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus">{label}{href === "/account/messages" && messagesUnread ? <span className="rounded-full bg-gold-700 px-1.5 py-0.5 text-[11px] font-bold text-white">{messagesUnread > 99 ? "99+" : messagesUnread}</span> : null}</Link>)}
      {error && <p role="alert" className="px-3 py-2 text-xs text-danger">{error}</p>}
      <button type="button" disabled={busy} onClick={() => void logout()} className="mt-1 flex min-h-11 w-full items-center gap-2 rounded-control border-t border-line px-3 pt-2 text-left text-sm font-medium text-fg-body transition-colors hover:bg-primary-subtle hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus disabled:opacity-60"><LogOut size={16}/>{busy ? "Çıxış edilir…" : "Hesabdan çıx"}</button>
    </div>
  </details>;
}
