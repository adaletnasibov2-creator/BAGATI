"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Heart, Menu, ShoppingBag, UserRound, X } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { CitySelector } from "@/components/city-selector";
import { finishAuthNavigation, postLogout } from "@/lib/auth-client";

const links = [["/categories", "Bütün kateqoriyalar"], ["/stores", "Mağazalar"], ["/deals", "Endirimlər"], ["/new-products", "Yeni məhsullar"], ["/deals", "Kampaniyalar"]];
type MenuIdentity = { email: string; displayName: string; role: "CUSTOMER" | "VENDOR" | "ADMIN" };

export function MobileMenu({ cities, user }: { cities: { id: string; name: string; slug: string }[]; user: MenuIdentity | null }) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [logoutError, setLogoutError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const submitting = useRef(false);
  function closeMenu() {
    if (menuRef.current) menuRef.current.open = false;
  }
  async function logout() {
    if (submitting.current) return;
    submitting.current = true; setLoggingOut(true); setLogoutError("");
    const result = await postLogout();
    if (!result.ok) { setLogoutError(result.error); submitting.current = false; setLoggingOut(false); return; }
    finishAuthNavigation("/");
  }
  return <div className="md:hidden">
    <details ref={menuRef} className="group">
      <summary aria-controls="mobile-market-nav" aria-label="Naviqasiya menyusunu aç və ya bağla" className="grid h-11 w-10 cursor-pointer list-none place-items-center rounded-xl text-[#24413D] transition hover:bg-[#EFF4F1] [&::-webkit-details-marker]:hidden">
        <Menu size={20} aria-hidden="true" className="group-open:hidden"/>
        <X size={20} aria-hidden="true" className="hidden group-open:block"/>
      </summary>
      <nav id="mobile-market-nav" aria-label="Mobil naviqasiya" className="absolute inset-x-0 top-full max-h-[calc(100dvh-120px)] overflow-y-auto border-t border-[#E5EBE7] bg-white px-4 pb-5 pt-2 shadow-[0_20px_40px_rgba(23,58,58,.12)] sm:px-6">
      <div className="border-b border-[#EEF2EF] py-3">
        <BrandLogo variant="compact" />
      </div>
      {links.map(([href, label]) => <Link key={label} onClick={closeMenu} href={href} className="flex min-h-12 items-center border-b border-[#EEF2EF] text-sm font-medium text-[#233432]">{label}</Link>)}
      <div className="mt-3 flex flex-wrap gap-2">
        {user ? <Link onClick={closeMenu} href={user.role === "VENDOR" ? "/vendor" : user.role === "ADMIN" ? "/admin" : "/account"} className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-xl bg-[#EFF4F1] px-3 text-sm"><UserRound size={17}/><span className="max-w-40 truncate">{user.displayName}</span></Link> : <><Link onClick={closeMenu} href="/login" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#EFF4F1] px-3 text-sm"><UserRound size={17}/>Daxil ol</Link><Link onClick={closeMenu} href="/register" className="inline-flex min-h-11 items-center rounded-xl border border-[#D9E3DD] px-3 text-sm">Qeydiyyat</Link></>}
        {user?.role === "CUSTOMER" && <Link onClick={closeMenu} href="/favorites" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#EFF4F1] px-3 text-sm"><Heart size={17}/>Sevimlilər</Link>}
        <Link onClick={closeMenu} href="/cart" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#174746] px-3 text-sm text-white"><ShoppingBag size={17}/>Səbət</Link>
      </div>
      {user && <div className="mt-3 border-t border-[#EEF2EF] pt-3"><p className="truncate px-1 text-xs text-[#697875]">{user.email}</p><button type="button" disabled={loggingOut} onClick={() => void logout()} className="mt-2 min-h-11 rounded-xl px-3 text-sm font-medium text-[#42645C] disabled:opacity-60">{loggingOut ? "Çıxış edilir…" : "Hesabdan çıx"}</button>{logoutError && <p role="alert" className="px-1 text-xs text-red-700">{logoutError}</p>}</div>}
      {cities.length > 0 && <div className="mt-4 border-t border-[#EEF2EF] pt-4"><CitySelector cities={cities}/></div>}
      </nav>
    </details>
  </div>;
}
