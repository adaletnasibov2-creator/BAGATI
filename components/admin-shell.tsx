"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { finishAuthNavigation, postLogout } from "@/lib/auth-client";
import { ChevronDown, Menu, Search, X } from "lucide-react";
import { ADMIN_MESSAGING_NAV_HREF, ADMIN_NAV_GROUPS, activeAdminNavGroup, activeAdminNavHref } from "@/lib/admin-nav";

// Menu groups and items: lib/admin-nav.ts (Ödənişlər and Geri ödənişlər are hidden stubs).
// ADMIN-DESIGN-1: the seller panel's look (components/vendor-navigation.tsx): white sidebar with a hairline, gold group
// kickers, the active page as a green tint with a bar on the left, bold text and aria-current. Behaviour unchanged.
/** Visible keyboard focus ring: the green ring of the admin kit and the seller panel (components/ui/cx.ts). */
const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** messagingEnabled: the "Mesaj şikayətləri" menu item is shown only while messaging is ON (cached setting). */
type AdminShellProps = { children: ReactNode; email: string; messagingEnabled?: boolean };

export default function AdminShell({ children, email, messagingEnabled = false }: AdminShellProps) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const activeGroup = activeAdminNavGroup(path);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(activeGroup ? [activeGroup] : []));
  useEffect(() => {
    if (activeGroup) setOpenGroups((current) => (current.has(activeGroup) ? current : new Set(current).add(activeGroup)));
  }, [activeGroup]);
  const toggleGroup = (id: string) => setOpenGroups((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const mobileMenuButton = useRef<HTMLButtonElement>(null);
  const mobileDialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = mobileDialog.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    const dialog = mobileDialog.current;
    dialog?.querySelector<HTMLElement>(
      'input:not([disabled]), a[href], button:not([disabled]), select:not([disabled]), textarea:not([disabled])',
    )?.focus();
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      mobileMenuButton.current?.focus();
    };
  }, [open]);

  async function logout() {
    if (busy) return;
    setBusy(true);
    setLogoutError("");
    const result = await postLogout();
    if (!result.ok) {
      setLogoutError(result.error);
      setBusy(false);
      return;
    }
    finishAuthNavigation("/admin/login");
  }

  function navigation(mobile = false) {
    const needle = query.trim().toLocaleLowerCase();
    const activeHref = activeAdminNavHref(path);
    const prefix = mobile ? "admin-nav-m" : "admin-nav";
    return <nav aria-label="Admin naviqasiyası" className="space-y-1">
      <label className="mb-3 flex min-h-11 items-center gap-2 rounded-control border border-line bg-surface-page px-3 text-fg-muted transition-colors focus-within:border-primary focus-within:bg-white">
        <Search size={15} aria-hidden="true" />
        <span className="sr-only">Bölmələr üzrə axtarış</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Bölmə axtarışı"
          className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted"
        />
      </label>
      {ADMIN_NAV_GROUPS.map((group) => {
        const items = group.items.filter(([href, label]) => (href !== ADMIN_MESSAGING_NAV_HREF || messagingEnabled) && (!needle || label.toLocaleLowerCase().includes(needle)));
        if (!items.length) return null;
        // While searching every group with a match is shown open.
        const expanded = Boolean(needle) || openGroups.has(group.id);
        const listId = `${prefix}-${group.id}`;
        return <div key={group.id} className="pt-1">
          <button
            type="button"
            onClick={() => toggleGroup(group.id)}
            aria-expanded={expanded}
            aria-controls={listId}
            className={`flex min-h-9 w-full items-center justify-between rounded-control px-2.5 py-1.5 text-left text-kicker uppercase text-gold-700 transition-colors hover:bg-primary-subtle motion-reduce:transition-none ${focusRing}`}
          >
            <span>{group.label}{group.id === activeGroup && !expanded ? <span className="sr-only"> (cari bölmə burada)</span> : null}</span>
            <ChevronDown size={14} aria-hidden="true" className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
          {expanded && <ul id={listId} className="mt-0.5 space-y-0.5">
            {items.map(([href, label, Icon]) => <li key={href}><Link
              href={href}
              onClick={() => mobile && setOpen(false)}
              aria-current={href === activeHref ? "page" : undefined}
              className={`relative flex min-h-11 items-center gap-2.5 rounded-control px-2.5 py-2 text-sm transition-colors duration-150 motion-reduce:transition-none ${focusRing} ${
                href === activeHref
                  ? "bg-primary-tint font-semibold text-primary before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-primary"
                  : "text-fg-secondary hover:bg-primary-subtle hover:text-fg"
              }`}
            >
              <span aria-hidden="true" className="grid h-5 w-5 shrink-0 place-items-center"><Icon size={18} /></span>
              <span className="min-w-0 flex-1">{label}</span>
            </Link></li>)}
          </ul>}
        </div>;
      })}
    </nav>;
  }

  return <div className="min-h-screen bg-surface-page text-fg-body">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col border-r border-line bg-white p-4 lg:flex">
      <Link href="/admin" className={`flex items-center gap-3 border-b border-line px-2.5 pb-5 pt-2 ${focusRing}`}>
        <span className="grid h-10 w-10 place-items-center rounded-control bg-primary font-serif text-xl font-bold text-white">B</span>
        <span><b className="block tracking-[.16em] text-fg">BAGATI</b><small className="text-xs text-fg-muted">İdarəetmə paneli</small></span>
      </Link>
      <div className="mt-5 min-h-0 flex-1 overflow-y-auto">{navigation()}</div>
      <div className="mt-4 border-t border-line pt-4">
        <p className="truncate px-2.5 text-xs text-fg-muted">{email}</p>
        {logoutError && <p role="alert" className="px-2.5 pt-2 text-xs text-red-700">{logoutError}</p>}
        <button disabled={busy} onClick={() => void logout()} className={`mt-2 min-h-11 w-full rounded-control px-2.5 py-2 text-left text-sm font-medium text-fg-secondary transition-colors hover:bg-primary-subtle hover:text-fg disabled:opacity-60 ${focusRing}`}>
          {busy ? "Çıxış edilir…" : "Çıxış"}
        </button>
      </div>
    </aside>
    <div className="lg:pl-[264px]">
      <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-line bg-white/95 px-4 backdrop-blur sm:px-7">
        <div className="flex items-center gap-3">
          <button
            ref={mobileMenuButton}
            aria-label="Naviqasiyanı aç"
            aria-expanded={open}
            aria-controls="admin-mobile-navigation"
            className={`grid h-11 w-11 place-items-center rounded-full border border-line-strong text-fg transition-colors hover:border-primary lg:hidden ${focusRing}`}
            onClick={() => setOpen(true)}
          ><Menu size={20} aria-hidden="true" /></button>
          <p className="text-sm font-semibold text-fg">Bazar yeri idarəetməsi</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden max-w-60 truncate text-sm text-fg-secondary sm:inline">{email}</span>
          <span aria-label="İdarəçi hesabı" className="grid h-9 w-9 place-items-center rounded-full bg-gold-100 text-sm font-semibold text-gold-700 ring-1 ring-inset ring-gold-200">
            {email.slice(0, 1).toLocaleUpperCase("az-AZ")}
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] p-4 sm:p-7 lg:p-9">{children}</main>
    </div>
    {open && <div
      ref={mobileDialog}
      id="admin-mobile-navigation"
      role="dialog"
      aria-modal="true"
      aria-label="Admin naviqasiyası"
      className="fixed inset-0 z-50 flex flex-col bg-white p-4 text-fg-body lg:hidden"
    >
      <div className="mb-4 flex items-center justify-between border-b border-line pb-4">
        <b className="tracking-[.16em] text-fg">BAGATI ADMIN</b>
        <button aria-label="Naviqasiyanı bağla" onClick={() => setOpen(false)} className={`grid h-11 w-11 place-items-center rounded-full border border-line-strong text-fg hover:border-primary ${focusRing}`}><X size={19} aria-hidden="true" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{navigation(true)}</div>
      {logoutError && <p role="alert" className="pt-3 text-xs text-red-700">{logoutError}</p>}
      <button disabled={busy} onClick={() => void logout()} className={`mt-4 min-h-11 shrink-0 rounded-full border border-line-strong px-5 text-sm font-medium text-fg transition-colors hover:border-primary disabled:opacity-60 ${focusRing}`}>
        {busy ? "Çıxış edilir…" : "Çıxış"}
      </button>
    </div>}
  </div>;
}
