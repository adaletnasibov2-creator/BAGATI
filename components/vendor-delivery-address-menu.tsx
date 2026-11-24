"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Copy, ExternalLink, MapPin, MessageCircle, X } from "lucide-react";
import { boltOpenLink, detectClientPlatform, isAppleMapsPlatform, type ClientPlatform } from "@/lib/bolt-app";
import type { DispatchLinks } from "@/lib/delivery-location";
import { copyToClipboard } from "@/lib/clipboard";
import { SELLER_CUSTOMER_CARD_TEXT } from "@/lib/vendor-order-view";
import { cx, focusRing } from "@/components/ui/cx";

/**
 * Seller's "Ünvan əməliyyatları" (SELLER-CUSTOMER-CARD-1): one row per app with the destination already set —
 * Google Maps, Waze, Apple Maps (Apple devices only), Yandex Maps, Bolt, Uber — then WhatsApp share and the two copy
 * actions. Every link is built on the server from the app's documented URL format (lib/delivery-location.ts); links
 * carry only the pin or the address text and the order number, never the customer's name or phone. Bolt has no
 * documented link, so its row copies the address and opens Bolt's store page (lib/bolt-app.ts).
 * Phones (< 640 px): a bottom sheet with a backdrop. Wider screens: a popover under the button. Both are a modal
 * dialog: focus moves in, Tab stays inside, Escape or a tap outside closes it and focus returns to the button.
 * Rendered in a portal so no sticky/blurred ancestor can clip it. External links send no referrer.
 */
type Notice = "bolt" | "address" | "coordinates" | "failed" | null;

export function VendorDeliveryAddressMenu({ links }: { links: DispatchLinks }) {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [failedText, setFailedText] = useState("");
  // Platform from the browser only (after mount); the server renders the desktop set (no Apple Maps row).
  const [platform, setPlatform] = useState<ClientPlatform>("desktop");
  const [apple, setApple] = useState(false);
  useEffect(() => { setPlatform(detectClientPlatform(navigator.userAgent, navigator.maxTouchPoints)); setApple(isAppleMapsPlatform(navigator.userAgent, navigator.maxTouchPoints)); }, []);
  const bolt = boltOpenLink(platform);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) window.requestAnimationFrame(() => buttonRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const isSheet = window.innerWidth < 640;
      setSheet(isSheet);
      const rect = buttonRef.current?.getBoundingClientRect();
      if (isSheet || !rect) { setPosition(null); return; }
      const width = Math.min(340, window.innerWidth - 32);
      const below = window.innerHeight - rect.bottom - 16;
      const above = rect.top - 16;
      const upward = below < 360 && above > below;
      const maxHeight = Math.max(220, upward ? above - 6 : below - 6);
      setPosition({ top: upward ? Math.max(16, rect.top - 6 - Math.min(maxHeight, 520)) : rect.bottom + 6, left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)), width, maxHeight: Math.min(maxHeight, 520) });
    };
    place();
    window.requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>("[data-dispatch-row]")?.focus());
    const focusables = () => [...(panelRef.current?.querySelectorAll<HTMLElement>("a[href],button:not([disabled])") ?? [])];
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      const items = focusables();
      if (!items.length) return;
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (event.key === "Tab") {
        // Focus trap: Tab and Shift+Tab cycle inside the dialog.
        event.preventDefault();
        items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) close(false);
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close]);

  async function copy(kind: "bolt" | "address" | "coordinates") {
    const text = kind === "coordinates" ? links.coordinatesText ?? "" : links.addressText;
    const ok = await copyToClipboard(text);
    setFailedText(ok ? "" : text);
    setNotice(ok ? kind : "failed");
    close();
  }

  const row = cx("flex min-h-[3.25rem] w-full items-center gap-3 rounded-control px-3 text-left text-[15px] font-medium text-fg transition-colors hover:bg-primary-subtle focus-visible:bg-primary-subtle motion-reduce:transition-none", focusRing);
  const mark = (content: ReactNode, tone = "bg-primary-tint text-primary") => <span aria-hidden="true" className={cx("grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold", tone)}>{content}</span>;
  const external = <ExternalLink aria-hidden="true" size={15} strokeWidth={2} className="ml-auto shrink-0 text-fg-muted"/>;
  const appRow = (href: string, name: string, letter: string, app: string) => <a data-dispatch-row="" data-dispatch-app={app} href={href} target="_blank" rel="noopener noreferrer" onClick={() => close(false)} className={row}>{mark(letter)}<span className="min-w-0 flex-1">{name}</span>{external}</a>;

  const panel = <div ref={panelRef} id="delivery-address-menu" role="dialog" aria-modal="true" aria-labelledby="delivery-address-menu-title" data-delivery-address-menu={sheet ? "sheet" : "popover"}
    style={sheet || !position ? undefined : { position: "fixed", top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }}
    className={cx("z-[10000] flex flex-col overflow-hidden bg-white shadow-[0_18px_45px_rgba(23,58,58,.18)]",
      sheet ? "fixed inset-x-0 bottom-0 max-h-[85vh] rounded-t-[1.25rem] border-t border-line pb-[max(0.75rem,env(safe-area-inset-bottom))]" : "rounded-card border border-line")}>
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-2.5">
      {sheet && <span aria-hidden="true" className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-line-strong"/>}
      <h2 id="delivery-address-menu-title" className="pt-1 text-sm font-semibold text-fg">Ünvan əməliyyatları</h2>
      <button type="button" onClick={() => close()} aria-label="Bağla" className={cx("grid h-11 w-11 place-items-center rounded-full text-fg-secondary hover:bg-surface-page", focusRing)}><X aria-hidden="true" size={18} strokeWidth={2}/></button>
    </div>
    <div className="min-h-0 overflow-y-auto p-2">
      <ul className="grid gap-0.5">
        <li>{appRow(links.apps.googleMaps, "Google Maps", "G", "google")}</li>
        <li>{appRow(links.apps.waze, "Waze", "W", "waze")}</li>
        {apple && <li>{appRow(links.apps.appleMaps, SELLER_CUSTOMER_CARD_TEXT.appleMaps, "A", "apple")}</li>}
        <li>{appRow(links.apps.yandexMaps, SELLER_CUSTOMER_CARD_TEXT.yandexMaps, "Y", "yandex")}</li>
        {/* Copies the address first (inside the tap), then the link opens Bolt's store page for this device. */}
        <li><a data-dispatch-row="" data-dispatch-app="bolt" href={bolt.href} target="_blank" rel="noopener noreferrer" data-bolt-platform={platform} onClick={() => void copy("bolt")} className={row}>{mark("B")}<span className="min-w-0 flex-1">Bolt (ünvanı kopyala və aç)</span>{external}</a></li>
        <li>{links.apps.uber
          ? appRow(links.apps.uber, "Uber", "U", "uber")
          : <p className="flex min-h-[3.25rem] items-center gap-3 px-3 text-sm text-fg-muted">{mark("U", "bg-surface-sunken text-fg-muted")}Uber: xəritə nöqtəsi olmadığı üçün əlçatan deyil.</p>}</li>
      </ul>
      <ul className="mt-1 grid gap-0.5 border-t border-line pt-1">
        <li><a data-dispatch-row="" href={links.whatsapp} target="_blank" rel="noopener noreferrer" onClick={() => close(false)} className={row}>{mark(<MessageCircle size={17} strokeWidth={2}/>, "bg-[#e3f1e9] text-[#1f7a4d]")}<span className="min-w-0 flex-1">WhatsApp · Ünvanı göndər</span>{external}</a></li>
        <li><button data-dispatch-row="" type="button" onClick={() => void copy("address")} className={row}>{mark(<Copy size={16} strokeWidth={2}/>, "bg-surface-sunken text-fg-body")}Ünvanı kopyala</button></li>
        {links.coordinatesText && <li><button data-dispatch-row="" type="button" onClick={() => void copy("coordinates")} className={row}>{mark(<MapPin size={16} strokeWidth={2}/>, "bg-surface-sunken text-fg-body")}{SELLER_CUSTOMER_CARD_TEXT.copyCoordinates}</button></li>}
      </ul>
    </div>
  </div>;

  return <div>
    <button ref={buttonRef} type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls="delivery-address-menu" onClick={() => (open ? close() : setOpen(true))}
      className={cx("inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-white shadow-subtle transition-colors hover:bg-primary-hover sm:w-auto motion-reduce:transition-none", focusRing)}>
      <MapPin aria-hidden="true" size={16} strokeWidth={2}/>Ünvan əməliyyatları<ChevronDown aria-hidden="true" size={15} strokeWidth={2} className={open ? "rotate-180" : ""}/>
    </button>
    <div role="status" className="text-sm">
      {notice === "bolt" && <p className="mt-2 text-primary">Ünvan kopyalandı. Bolt tətbiqini açın. <a href={bolt.href} target="_blank" rel="noopener noreferrer" className="text-xs underline">{bolt.label}</a></p>}
      {notice === "address" && <p className="mt-2 text-primary">Ünvan kopyalandı.</p>}
      {notice === "coordinates" && <p className="mt-2 text-primary">{SELLER_CUSTOMER_CARD_TEXT.coordinatesCopied}</p>}
      {notice === "failed" && <div className="mt-2 text-gold-700">Avtomatik kopyalamaq alınmadı. Mətni seçib kopyalayın:<textarea readOnly value={failedText} rows={3} className="mt-1 w-full rounded-control border border-line p-2 text-xs text-fg-body" /></div>}
    </div>
    {open && typeof document !== "undefined" && createPortal(<>
      {sheet && <div aria-hidden="true" className="fixed inset-0 z-[9999] bg-[#0b1726]/40" onClick={() => close(false)}/>}
      {(sheet || position) && panel}
    </>, document.body)}
  </div>;
}
