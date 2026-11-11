"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BarChart3, Bell, Boxes, ChevronRight, CircleDollarSign, ClipboardList, FileSpreadsheet, LayoutDashboard, Menu, Package, Plus, RotateCcw, Settings2, ShieldCheck, Star, Store, Tags, X } from "lucide-react";

type NavLink = { path: string; label: string; Icon: typeof Store; badge?: "unread" };
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

export function VendorNavigation({ storeId, canUseBulkImport = false, unread = 0 }: { storeId: string; canUseBulkImport?: boolean; unread?: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const base = `/vendor/${storeId}`;
  const isActive = (path: string) => {
    if (!path) return pathname === base;
    // "Məhsullarım" stays active on product detail pages but not on the separate "add product" page.
    if (path === "products" && pathname.startsWith(`${base}/products/new`)) return false;
    return pathname === `${base}/${path}` || pathname.startsWith(`${base}/${path}/`);
  };
  const nav = (mobile = false) => <nav aria-label="Satıcı paneli" className="space-y-5">
    {groups.map((group) => <div key={group.title}>
      <p className="mb-1.5 px-3 text-[.62rem] font-semibold uppercase tracking-[.16em] text-[#8A6A37]">{group.title}</p>
      <ul className="space-y-1">{group.links.filter(({ path }) => path !== "imports" || canUseBulkImport).map(({ path, label, Icon, badge }) => {
        const active = isActive(path);
        return <li key={path}><Link href={`${base}${path ? `/${path}` : ""}`} onClick={() => mobile && setOpen(false)} aria-current={active ? "page" : undefined} className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9973a] ${active ? "bg-[#142d38] font-semibold text-white shadow-sm" : "text-[#536273] hover:bg-[#f2f0e9] hover:text-[#142d38]"}`}>
          <Icon size={17} aria-hidden="true"/><span className="min-w-0 flex-1">{label}</span>
          {badge === "unread" && unread > 0 && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${active ? "bg-white text-[#142d38]" : "bg-[#c9973a] text-white"}`} aria-label={`${unread} oxunmamış`}>{unread > 99 ? "99+" : unread}</span>}
          {active && <ChevronRight size={14} aria-hidden="true"/>}
        </Link></li>;
      })}</ul>
    </div>)}
  </nav>;
  return <>
    <aside className="fixed inset-y-[73px] left-0 z-20 hidden w-[248px] flex-col border-r border-[#e4e8e4] bg-white px-4 py-5 lg:flex"><div className="min-h-0 flex-1 overflow-y-auto">{nav()}</div></aside>
    <div className="sticky top-[72px] z-30 border-b border-[#e8e4da] bg-[#f7f5ef]/95 px-4 py-2 backdrop-blur lg:hidden"><button type="button" aria-expanded={open} aria-controls="vendor-mobile-navigation" onClick={() => setOpen((value) => !value)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#ded9cf] bg-white px-4 text-sm font-medium text-[#142d38]">{open ? <X size={17}/> : <Menu size={17}/>} {open ? "Menyunu bağla" : "Panel menyusu"}</button></div>
    {open && <div id="vendor-mobile-navigation" role="dialog" aria-modal="true" aria-label="Satıcı paneli menyusu" className="fixed inset-0 z-50 flex flex-col bg-white p-4 text-[#16202c] lg:hidden"><div className="mb-5 flex items-center justify-between border-b border-[#e8e4da] pb-4"><div><p className="text-xs uppercase tracking-[.16em] text-[#967844]">BAGATI satıcı paneli</p><p className="mt-1 font-semibold">Menyu</p></div><button type="button" aria-label="Menyunu bağla" onClick={() => setOpen(false)} className="grid h-11 w-11 place-items-center rounded-xl border"><X size={19}/></button></div><div className="min-h-0 flex-1 overflow-y-auto">{nav(true)}</div></div>}
  </>;
}
