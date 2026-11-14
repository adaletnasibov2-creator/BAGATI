"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Copy, ExternalLink, MapPin } from "lucide-react";
import type { DispatchLinks } from "@/lib/delivery-location";

/**
 * Seller's "Ünvan əməliyyatları" menu: open the delivery point in Google Maps or OpenStreetMap, start an Uber ride to
 * it (pickup = the seller's current location), or copy the address for Bolt (no verified public deep link) or anywhere
 * else. Links are built on the server (lib/delivery-location.ts); brand names are plain text, no logos. Rendered in a
 * portal so no sticky/blurred ancestor can clip it. External links send no referrer (the order URL stays private).
 */
export function VendorDeliveryAddressMenu({ links }: { links: DispatchLinks }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const [notice, setNotice] = useState<"bolt" | "copied" | "failed" | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) window.requestAnimationFrame(() => buttonRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(300, window.innerWidth - 32);
      setPosition({ top: rect.bottom + 6, left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)), width });
    };
    place();
    window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
      const index = items.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) close(false);
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

  async function copy(kind: "bolt" | "copied") {
    let ok = false;
    try {
      await navigator.clipboard.writeText(links.copyText);
      ok = true;
    } catch {
      // Older or non-secure contexts: a hidden textarea and the legacy copy command.
      const area = document.createElement("textarea");
      area.value = links.copyText; area.setAttribute("readonly", ""); area.style.position = "fixed"; area.style.opacity = "0";
      document.body.appendChild(area); area.select();
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      area.remove();
    }
    setNotice(ok ? kind : "failed");
    close();
  }

  const item = "flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-[#243647] hover:bg-[#f3f1eb] focus-visible:bg-[#f3f1eb] focus-visible:outline-none";
  return <div>
    <button ref={buttonRef} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls="delivery-address-menu" onClick={() => (open ? close() : setOpen(true))}
      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#d9d4c9] bg-white px-4 text-sm font-semibold text-[#173c40] hover:bg-[#f8f7f4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#b99a5b]">
      <MapPin aria-hidden="true" size={16} />Ünvan əməliyyatları<ChevronDown aria-hidden="true" size={15} className={open ? "rotate-180" : ""} />
    </button>
    {notice === "bolt" && <p role="status" className="mt-2 text-sm text-[#28766f]">Ünvan kopyalandı. Bolt tətbiqini açın. <a href="https://bolt.eu/" target="_blank" rel="noopener noreferrer" className="text-xs underline">bolt.eu</a></p>}
    {notice === "copied" && <p role="status" className="mt-2 text-sm text-[#28766f]">Ünvan kopyalandı.</p>}
    {notice === "failed" && <div role="status" className="mt-2 text-sm text-amber-800">Avtomatik kopyalamaq alınmadı. Mətni seçib kopyalayın:<textarea readOnly value={links.copyText} rows={3} className="mt-1 w-full rounded-lg border border-[#ded9cf] p-2 text-xs text-slate-700" /></div>}
    {open && position && typeof document !== "undefined" && createPortal(
      <div ref={menuRef} id="delivery-address-menu" role="menu" aria-label="Ünvan əməliyyatları" data-delivery-address-menu
        style={{ position: "fixed", top: position.top, left: position.left, width: position.width, zIndex: 10000 }}
        className="rounded-2xl border border-[#e9e4da] bg-white p-2 shadow-[0_18px_45px_rgba(23,58,58,.18)]">
        <a role="menuitem" href={links.googleMaps} target="_blank" rel="noopener noreferrer" onClick={() => close(false)} className={item}><ExternalLink aria-hidden="true" size={15} />Google Maps</a>
        <a role="menuitem" href={links.openStreetMap} target="_blank" rel="noopener noreferrer" onClick={() => close(false)} className={item}><ExternalLink aria-hidden="true" size={15} />Xəritə (OpenStreetMap)</a>
        {links.uber
          ? <a role="menuitem" href={links.uber} target="_blank" rel="noopener noreferrer" onClick={() => close(false)} className={item}><ExternalLink aria-hidden="true" size={15} />Uber</a>
          : <p className="px-3 py-2 text-xs text-slate-500">Uber: xəritə nöqtəsi olmadığı üçün əlçatan deyil.</p>}
        <button role="menuitem" type="button" onClick={() => void copy("bolt")} className={item}><Copy aria-hidden="true" size={15} />Bolt (ünvanı kopyala)</button>
        <button role="menuitem" type="button" onClick={() => void copy("copied")} className={item}><Copy aria-hidden="true" size={15} />Ünvanı kopyala</button>
      </div>,
      document.body,
    )}
  </div>;
}
