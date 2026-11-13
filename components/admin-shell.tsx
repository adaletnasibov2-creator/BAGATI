"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { finishAuthNavigation, postLogout } from "@/lib/auth-client";
import {
  LayoutDashboard,
  Store,
  Users,
  UserRound,
  Package,
  Tags,
  Map,
  ShoppingBag,
  CreditCard,
  BadgePercent,
  Star,
  LifeBuoy,
  Upload,
  Bell,
  FileClock,
  ChartNoAxesCombined,
  ShieldCheck,
  Menu,
  Search,
  X,
  Settings,
  Images,
  Activity,
  MonitorSmartphone,
  ClipboardCheck,
} from "lucide-react";

const items = [
  ["/admin/security-center", "Təhlükəsizlik mərkəzi", ShieldCheck],
  ["/admin/security", "Hesab təhlükəsizliyi", ShieldCheck],
  ["/admin/security/sessions", "Aktiv sessiyalar", MonitorSmartphone],
  ["/admin", "İcmal", LayoutDashboard],
  ["/admin/settings", "Sayt parametrləri", Settings],
  ["/admin/homepage", "Ana səhifə və bannerlər", Images],
  ["/admin/promotions", "Kampaniyalar", BadgePercent],
  ["/admin/stores", "Mağazalar", Store],
  ["/admin/vendors", "Satıcılar", Users],
  ["/admin/seller-applications", "Satıcı müraciətləri", ClipboardCheck],
  ["/admin/customers", "Müştərilər", UserRound],
  ["/admin/products", "Məhsullar", Package],
  ["/admin/categories", "Kateqoriyalar", Tags],
  ["/admin/brands", "Brendlər", BadgePercent],
  ["/admin/cities", "Şəhərlər", Map],
  ["/admin/orders", "Sifarişlər", ShoppingBag],
  ["/admin/subscriptions", "Abunəliklər", CreditCard],
  ["/admin/commissions", "Komissiyalar", BadgePercent],
  ["/admin/payments", "Ödənişlər", CreditCard],
  ["/admin/returns", "Qaytarılma sorğuları", CreditCard],
  ["/admin/refunds", "Geri ödənişlər", CreditCard],
  ["/admin/reviews", "Rəylər", Star],
  ["/admin/support", "Dəstək", LifeBuoy],
  ["/admin/imports", "İdxallar", Upload],
  ["/admin/reports", "Hesabatlar", ChartNoAxesCombined],
  ["/admin/notifications", "Bildirişlər", Bell],
  ["/admin/email", "E-poçt çatdırılması", Bell],
  ["/admin/system", "Sistem vəziyyəti", Activity],
  ["/admin/audit-log", "Audit jurnalı", FileClock],
] as const;

type AdminShellProps = { children: ReactNode; email: string };

export default function AdminShell({ children, email }: AdminShellProps) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [logoutError, setLogoutError] = useState("");
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
    const visibleItems = items.filter(([, label]) =>
      label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    // Only the most specific matching item is active (e.g. /admin/security/sessions, not also /admin/security).
    const activeHref = items
      .map(([href]) => href as string)
      .filter((href) => path === href || (href !== "/admin" && path.startsWith(`${href}/`)))
      .sort((a, b) => b.length - a.length)[0];

    return <nav aria-label="Admin naviqasiyası" className="space-y-1">
      <label className="mb-3 flex min-h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-slate-400">
        <Search size={15} aria-hidden="true" />
        <span className="sr-only">Bölmələr üzrə axtarış</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Bölmə axtarışı"
          className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
        />
      </label>
      {visibleItems.map(([href, label, Icon]) => <Link
        key={href}
        href={href}
        onClick={() => mobile && setOpen(false)}
        aria-current={href === activeHref ? "page" : undefined}
        className={`flex min-h-10 items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
          href === activeHref
            ? "bg-[#25374a] text-white"
            : "text-slate-300 hover:bg-white/10 hover:text-white"
        }`}
      >
        <Icon size={17} aria-hidden="true" />
        <span>{label}</span>
      </Link>)}
    </nav>;
  }

  return <div className="min-h-screen bg-[#f5f3ee] text-[#172333]">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col bg-[#122E2E] p-4 text-white lg:flex">
      <Link href="/admin" className="flex items-center gap-3 border-b border-white/10 px-3 pb-5 pt-2">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#C79A52] font-serif text-xl font-bold text-[#122E2E]">B</span>
        <span><b className="block tracking-[.16em]">BAGATI</b><small className="text-xs text-slate-400">İdarəetmə paneli</small></span>
      </Link>
      <div className="mt-5 min-h-0 flex-1 overflow-y-auto">{navigation()}</div>
      <div className="mt-4 border-t border-white/10 pt-4">
        <p className="truncate px-3 text-xs text-slate-400">{email}</p>
        {logoutError && <p role="alert" className="px-3 pt-2 text-xs text-red-300">{logoutError}</p>}
        <button disabled={busy} onClick={() => void logout()} className="mt-2 w-full rounded-xl px-3 py-2 text-left text-sm text-slate-300 hover:bg-white/10 disabled:opacity-60">
          {busy ? "Çıxış edilir…" : "Çıxış"}
        </button>
      </div>
    </aside>
    <div className="lg:pl-[264px]">
      <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-[#e6e2d8] bg-white/95 px-4 backdrop-blur sm:px-7">
        <div className="flex items-center gap-3">
          <button
            ref={mobileMenuButton}
            aria-label="Naviqasiyanı aç"
            aria-expanded={open}
            aria-controls="admin-mobile-navigation"
            className="rounded-lg border p-2 lg:hidden"
            onClick={() => setOpen(true)}
          ><Menu size={20} aria-hidden="true" /></button>
          <p className="text-sm font-semibold text-[#26384b]">Bazar yeri idarəetməsi</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden max-w-60 truncate text-sm text-slate-500 sm:inline">{email}</span>
          <span aria-label="İdarəçi hesabı" className="grid h-9 w-9 place-items-center rounded-full bg-[#f3eee1] text-sm font-semibold text-[#85621d]">
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
      className="fixed inset-0 z-50 bg-[#122E2E] p-4 text-white lg:hidden"
    >
      <div className="mb-5 flex items-center justify-between">
        <b className="tracking-[.16em]">BAGATI ADMIN</b>
        <button aria-label="Naviqasiyanı bağla" onClick={() => setOpen(false)} className="rounded-lg p-2"><X aria-hidden="true" /></button>
      </div>
      <div className="max-h-[calc(100vh-90px)] overflow-y-auto">{navigation(true)}</div>
      {logoutError && <p role="alert" className="pt-3 text-xs text-red-300">{logoutError}</p>}
      <button disabled={busy} onClick={() => void logout()} className="mt-5 rounded-xl border border-white/20 px-4 py-2 text-sm disabled:opacity-60">
        {busy ? "Çıxış edilir…" : "Çıxış"}
      </button>
    </div>}
  </div>;
}
