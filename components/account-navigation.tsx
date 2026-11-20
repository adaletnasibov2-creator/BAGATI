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
  // Calm side navigation from 1024 px (active: green tint, bar on the left, bold, aria-current); below that a row of pills
  // that scrolls sideways (DESIGN-T7). Same links, same order, same texts.
  return <nav aria-label={"Hesab bölmələri"} data-account-nav="" className="-mx-[14px] flex gap-2 overflow-x-auto px-[14px] pb-1 min-[641px]:-mx-7 min-[641px]:px-7 [scrollbar-width:thin] lg:mx-0 lg:block lg:space-y-0.5 lg:overflow-visible lg:rounded-card lg:border lg:border-line lg:bg-white lg:p-2 lg:pb-2">
    {items.map(({ label, href, Icon }) => {
      const active = path === href || (href !== "/account" && path.startsWith(href + "/"));
      return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`relative flex min-h-11 shrink-0 items-center gap-2.5 rounded-full border px-4 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus lg:w-full lg:rounded-control lg:border-0 lg:px-3 ${active ? "border-primary bg-primary text-white lg:bg-primary-tint lg:font-semibold lg:text-primary lg:before:absolute lg:before:inset-y-2 lg:before:left-0 lg:before:w-[3px] lg:before:rounded-full lg:before:bg-primary" : "border-line-strong bg-white text-fg-secondary hover:border-primary hover:text-primary lg:bg-transparent lg:hover:bg-primary-subtle"}`}><span aria-hidden="true" className="grid h-5 w-5 shrink-0 place-items-center"><Icon size={17}/></span><span className="whitespace-nowrap">{label}</span>{href === messagesLink.href && messagesUnread ? <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${active ? "bg-white text-primary lg:bg-primary lg:text-white" : "bg-primary text-white"}`} aria-label={`${messagesUnread} oxunmamış söhbət`}>{messagesUnread > 99 ? "99+" : messagesUnread}</span> : null}</Link>;
    })}
  </nav>;
}