"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Heart, MapPin, MessageCircle, Package, RotateCcw, ShieldCheck, Store, UserRound } from "lucide-react";
const links = [
  { label: "\u0130cmal", href: "/account", Icon: UserRound },
  { label: "Sifari\u015Fl\u0259rim", href: "/orders", Icon: Package },
  { label: "Qaytarılma sorğuları", href: "/account/returns", Icon: RotateCcw },
  { label: "\u00DCnvanlar\u0131m", href: "/account/addresses", Icon: MapPin },
  { label: "Sevimlil\u0259r", href: "/favorites", Icon: Heart },
  { label: "Bildiri\u015Fl\u0259r", href: "/account/notifications", Icon: Bell },
  { label: "Satıcı müraciəti", href: "/vendor/apply", Icon: Store },
  { label: "Profil", href: "/account/profile", Icon: UserRound },
  { label: "T\u0259hl\u00FCk\u0259sizlik", href: "/account/security", Icon: ShieldCheck },
];
/** Shown after "Sifarişlərim" only while messaging is ON (messagesUnread is a number); null or undefined hides it. */
const messagesLink = { label: "Mesajlarım", href: "/account/messages", Icon: MessageCircle };
export function AccountNavigation({ messagesUnread = null }: { messagesUnread?: number | null } = {}) {
  const path = usePathname();
  const items = messagesUnread === null ? links : [...links.slice(0, 2), messagesLink, ...links.slice(2)];
  return <nav aria-label={"Hesab b\u00F6lm\u0259l\u0259ri"} className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 lg:mx-0 lg:block lg:space-y-1 lg:overflow-visible lg:px-0">
    {items.map(({ label, href, Icon }) => {
      const active = path === href || (href !== "/account" && path.startsWith(href + "/"));
      return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`flex min-h-11 shrink-0 items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm transition lg:w-full ${active ? "bg-[#0b1726] font-semibold text-white shadow-sm" : "text-[#526273] hover:bg-white hover:text-[#0b1726]"}`}><Icon size={16} aria-hidden="true"/><span>{label}</span>{href === messagesLink.href && messagesUnread ? <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${active ? "bg-white text-[#0b1726]" : "bg-[#c9973a] text-white"}`} aria-label={`${messagesUnread} oxunmamış söhbət`}>{messagesUnread > 99 ? "99+" : messagesUnread}</span> : null}</Link>;
    })}
  </nav>;
}
