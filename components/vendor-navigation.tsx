"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cx, focusRing } from "@/components/ui/cx";
import { BarChart3, Bell, Boxes, CircleDollarSign, ClipboardList, FileSpreadsheet, LayoutDashboard, Menu, MessageSquare, MessagesSquare, Package, Plus, RotateCcw, Settings2, ShieldCheck, Star, Store, Tags, X } from "lucide-react";

type NavLink = { path: string; label: string; Icon: typeof Store; badge?: "unread" | "inquiries" | "conversations" };
const groups: { title: string; links: NavLink[] }[] = [
  { title: "Mağaza", links: [
    { path: "", label: "İdarəetmə paneli", Icon: LayoutDashboard },
    { path: "profile", label: "Mağazam", Icon: Store },
  ] },
  { title: "Məhsullar", links: [
    { path: "products", label: "Məhsullarım", Icon: Package },
    { path: "products/new", label: "Məhsul əlavə et", Icon: Plus },
    { path: "imports", label: "Məhsulları toplu əlavə et", Icon: FileSpreadsheet },
    { path: "inventory", label: "Anbar qalığı", Icon: Boxes },
  ] },
  { title: "Satış", links: [
    { path: "orders", label: "Sifarişlər", Icon: ClipboardList },
    { path: "inquiries", label: "Mesajlar", Icon: MessageSquare, badge: "inquiries" },
    // Customer conversations (messaging); hidden while messaging.enabled is OFF (conversations = null).
    { path: "messages", label: "Söhbətlər", Icon: MessagesSquare, badge: "conversations" },
    { path: "returns", label: "Qaytarılma müraciətləri", Icon: RotateCcw },
    { path: "campaigns", label: "Kampaniyalar", Icon: Tags },
    { path: "sales", label: "Satış və gəlir", Icon: BarChart3 },
    { path: "reviews", label: "Müştəri rəyləri", Icon: Star },
  ] },
  { title: "Hesab", links: [
    { path: "notifications", label: "Bildirişlər", Icon: Bell, badge: "unread" },
    { path: "subscription", label: "Abunəliyim", Icon: CircleDollarSign },
    { path: "settings", label: "Hesab və parametrlər", Icon: Settings2 },
    { path: "security", label: "Təhlükəsizlik", Icon: ShieldCheck },
  ] },
];

export function VendorNavigation({ storeId, canUseBulkImport = false, unread = 0, newInquiries = 0, conversations = null }: { storeId: string; canUseBulkImport?: boolean; unread?: number; newInquiries?: number; conversations?: number | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const base = `/vendor/${storeId}`;
  const isActive = (path: string) => {
    if (!path) return pathname === base;
    // "Məhsullarım" stays active on product detail pages but not on the separate "add product" page.
    if (path === "products" && pathname.startsWith(`${base}/products/new`)) return false;
    return pathname === `${base}/${path}` || pathname.startsWith(`${base}/${path}/`);
  };
  // Grouped sections with a hairline between them; the active link is a green tint with a bar on the left, bold
  // text and aria-current, so it does not rely on colour alone. Icons sit in a fixed 20 px box, so labels align.
  const nav = (mobile = false) => <nav aria-label="Satıcı paneli" className="divide-y divide-line">
    {groups.map((group) => <div key={group.title} className="py-3 first:pt-0 last:pb-0">
      <p className="mb-1.5 px-3 text-kicker uppercase text-gold-700">{group.title}</p>
      <ul className="space-y-0.5">{group.links.filter(({ path }) => (path !== "imports" || canUseBulkImport) && (path !== "messages" || conversations !== null)).map(({ path, label, Icon, badge }) => {
        const active = isActive(path);
        return <li key={path}><Link href={`${base}${path ? `/${path}` : ""}`} onClick={() => mobile && setOpen(false)} aria-current={active ? "page" : undefined} className={cx(
          "relative flex min-h-11 items-center gap-3 rounded-control px-3 py-2 text-sm transition-colors duration-150 motion-reduce:transition-none",
          focusRing,
          active
            ? "bg-primary-tint font-semibold text-primary before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-primary"
            : "text-fg-secondary hover:bg-primary-subtle hover:text-fg",
        )}>
          <span aria-hidden="true" className="grid h-5 w-5 shrink-0 place-items-center"><Icon size={18}/></span><span className="min-w-0 flex-1">{label}</span>
          {(() => {
            const count = badge === "unread" ? unread : badge === "inquiries" ? newInquiries : badge === "conversations" ? conversations ?? 0 : 0;
            return count > 0 && <span className="min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-center text-[10px] font-semibold text-white" aria-label={badge === "inquiries" ? `${count} yeni mesaj` : badge === "conversations" ? `${count} oxunmamış söhbət` : `${count} oxunmamış`}>{count > 99 ? "99+" : count}</span>;
          })()}
        </Link></li>;
      })}</ul>
    </div>)}
  </nav>;
  return <>
    <aside className="fixed inset-y-[73px] left-0 z-20 hidden w-[248px] flex-col border-r border-line bg-white px-4 py-5 lg:flex"><div className="min-h-0 flex-1 overflow-y-auto">{nav()}</div></aside>
    <div className="sticky top-[72px] z-30 border-b border-line bg-[#f7f8f6]/95 px-4 py-2 backdrop-blur lg:hidden"><button type="button" aria-expanded={open} aria-controls="vendor-mobile-navigation" onClick={() => setOpen((value) => !value)} className={cx("inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong bg-white px-4 text-sm font-medium text-fg transition-colors hover:border-primary", focusRing)}>{open ? <X size={17} aria-hidden="true"/> : <Menu size={17} aria-hidden="true"/>} {open ? "Menyunu bağla" : "Panel menyusu"}</button></div>
    {open && <div id="vendor-mobile-navigation" role="dialog" aria-modal="true" aria-label="Satıcı paneli menyusu" className="fixed inset-0 z-50 flex flex-col bg-white p-4 text-fg-body lg:hidden"><div className="mb-4 flex items-center justify-between border-b border-line pb-4"><div><p className="text-kicker uppercase text-gold-700">BAGATI satıcı paneli</p><p className="mt-1 font-display text-h3 text-fg">Menyu</p></div><button type="button" aria-label="Menyunu bağla" onClick={() => setOpen(false)} className={cx("grid h-11 w-11 place-items-center rounded-full border border-line-strong text-fg hover:border-primary", focusRing)}><X size={19} aria-hidden="true"/></button></div><div className="min-h-0 flex-1 overflow-y-auto">{nav(true)}</div></div>}
  </>;
}
