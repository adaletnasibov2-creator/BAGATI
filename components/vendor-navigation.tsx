"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BarChart3, Bell, Boxes, ChevronRight, CircleDollarSign, ClipboardList, FileSpreadsheet, LayoutDashboard, Menu, Package, Plus, RotateCcw, Settings2, ShieldCheck, Star, Store, Tags, Upload, X } from "lucide-react";

const links = [
  { path: "", label: "\u0130cmal", Icon: LayoutDashboard },
  { path: "orders", label: "Sifari\u015Fl\u0259r", Icon: ClipboardList },
  { path: "returns", label: "Qaytarılmalar", Icon: RotateCcw },
  { path: "products", label: "M\u0259hsullar", Icon: Package },
  { path: "products/new", label: "M\u0259hsul \u0259lav\u0259 et", Icon: Plus },
  { path: "inventory", label: "Anbar", Icon: Boxes },
  { path: "imports", label: "Toplu idxal", Icon: FileSpreadsheet },
  { path: "campaigns", label: "Kampaniyalar", Icon: Tags },
  { path: "sales", label: "Sat\u0131\u015F analitikalar\u0131", Icon: BarChart3 },
  { path: "reviews", label: "R\u0259yl\u0259r", Icon: Star },
  { path: "notifications", label: "Bildiri\u015Fl\u0259r", Icon: Bell },
  { path: "profile", label: "Ma\u011Faza profili", Icon: Store },
  { path: "subscription", label: "Abun\u0259lik", Icon: CircleDollarSign },
  { path: "security", label: "Təhlükəsizlik", Icon: ShieldCheck },
  { path: "settings", label: "Parametrl\u0259r", Icon: Settings2 },
];

export function VendorNavigation({ storeId, canUseBulkImport = false }: { storeId: string; canUseBulkImport?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (path: string) => path ? pathname === `/vendor/${storeId}/${path}` || pathname.startsWith(`/vendor/${storeId}/${path}/`) : pathname === `/vendor/${storeId}`;
  const visibleLinks = links.filter(({ path }) => path !== "imports" || canUseBulkImport);
  const nav = (mobile = false) => <nav aria-label={"Sat\u0131c\u0131 paneli"} className="space-y-1">{visibleLinks.map(({ path, label, Icon }) => <Link key={path} href={`/vendor/${storeId}${path ? `/${path}` : ""}`} onClick={() => mobile && setOpen(false)} aria-current={isActive(path) ? "page" : undefined} className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${isActive(path) ? "bg-[#142d38] font-semibold text-white shadow-sm" : "text-[#536273] hover:bg-[#f2f0e9] hover:text-[#142d38]"}`}><Icon size={17} aria-hidden="true"/><span className="min-w-0 flex-1">{label}</span>{isActive(path) && <ChevronRight size={14} aria-hidden="true"/>}</Link>)}</nav>;
  return <>
    <aside className="fixed inset-y-[73px] left-0 z-20 hidden w-[248px] flex-col border-r border-[#e4e8e4] bg-white px-4 py-5 lg:flex"><p className="mb-3 px-3 text-[.65rem] font-semibold uppercase tracking-[.18em] text-[#8A6A37]">İdarəetmə</p><div className="min-h-0 flex-1 overflow-y-auto">{nav()}</div><div className="mt-4 rounded-xl bg-[#f7f5ef] p-3 text-xs leading-5 text-[#667085]">Mağaza və məhsul məlumatlarını buradan idarə edin.</div></aside>
    <div className="sticky top-0 z-30 border-b border-[#e8e4da] bg-[#f7f5ef]/95 px-4 py-2 backdrop-blur lg:hidden"><button type="button" aria-expanded={open} aria-controls="vendor-mobile-navigation" onClick={() => setOpen((value) => !value)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#ded9cf] bg-white px-4 text-sm font-medium text-[#142d38]">{open ? <X size={17}/> : <Menu size={17}/>} {open ? "Menyunu ba\u011Fla" : "Panel menyusu"}</button></div>
    {open && <div id="vendor-mobile-navigation" className="fixed inset-0 z-50 flex flex-col bg-white p-4 text-[#16202c] lg:hidden"><div className="mb-5 flex items-center justify-between border-b border-[#e8e4da] pb-4"><div><p className="text-xs uppercase tracking-[.16em] text-[#967844]">BAGATI satıcı paneli</p><p className="mt-1 font-semibold">Menyu</p></div><button type="button" aria-label={"Menyunu ba\u011Fla"} onClick={() => setOpen(false)} className="grid h-11 w-11 place-items-center rounded-xl border"><X size={19}/></button></div><div className="min-h-0 flex-1 overflow-y-auto">{nav(true)}</div></div>}
  </>;
}
