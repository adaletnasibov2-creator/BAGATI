"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, MapPin } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { resolveActiveCity } from "@/lib/city-resolution";

type City = { id: string; name: string; slug: string };
type MenuPosition = { top: number; left: number; width: number; maxHeight: number };

export function CitySelector({ cities, selected, compact = false }: { cities: City[]; selected?: string; compact?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const menuId = `city-menu-${useId().replace(/:/g, "")}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedFromQuery = params.get("city");
  const defaultCity = resolveActiveCity(cities)?.slug ?? "";
  const queryCity = cities.find((city) => city.slug === selectedFromQuery)?.slug;
  const propCity = cities.find((city) => city.slug === selected)?.slug;
  const [preferredCity, setPreferredCity] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const activeSlug = preferredCity ?? propCity ?? queryCity ?? defaultCity;
  const activeCity = cities.find((city) => city.slug === activeSlug);

  useEffect(() => {
    if (!cities.length) return;

    let savedCity: string | null = null;
    try {
      savedCity = localStorage.getItem("bagati_city");
    } catch {
      savedCity = null;
    }
    const storedCity = cities.find((city) => city.slug === savedCity)?.slug;
    const nextCity = queryCity ?? propCity ?? storedCity ?? defaultCity;
    if (!nextCity) return;

    setPreferredCity(nextCity);
    try {
      localStorage.setItem("bagati_city", nextCity);
    } catch {
      // The URL remains the source of truth if browser storage is unavailable.
    }

    if (!queryCity && !propCity) {
      const next = new URLSearchParams(params.toString());
      next.set("city", nextCity);
      router.replace(`${pathname}?${next.toString()}`);
    }
  }, [cities, defaultCity, pathname, params, propCity, queryCity, router]);

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewportPadding = 12;
      const width = Math.min(Math.max(rect.width, 220), window.innerWidth - viewportPadding * 2);
      const maxHeight = Math.min(320, window.innerHeight - viewportPadding * 2);
      const left = Math.min(
        Math.max(viewportPadding, rect.right - width),
        window.innerWidth - width - viewportPadding,
      );
      const below = rect.bottom + 8;
      const top = below + maxHeight <= window.innerHeight - viewportPadding
        ? below
        : Math.max(viewportPadding, rect.top - maxHeight - 8);
      setPosition({ top, left, width, maxHeight });
    };

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function chooseCity(city: City) {
    setPreferredCity(city.slug);
    try {
      localStorage.setItem("bagati_city", city.slug);
    } catch {
      // The URL remains the source of truth if browser storage is unavailable.
    }
    setOpen(false);
    const next = new URLSearchParams(params.toString());
    next.set("city", city.slug);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={activeCity ? `Şəhər: ${activeCity.name}` : "Şəhər seçin"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        className={`${compact ? "w-[118px] px-2.5 text-xs" : "w-[160px]"} inline-flex h-11 min-w-0 items-center gap-2 rounded-full border border-[#E3EAE5] bg-white px-3 text-left text-sm font-semibold text-[#36534D] shadow-[0_2px_8px_rgba(23,58,58,.04)] transition hover:border-[#B8CDC1] hover:bg-[#FBFCFA] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4F8175] disabled:cursor-not-allowed disabled:text-[#697875] sm:w-[176px] sm:px-3.5`}
      >
        <MapPin aria-hidden="true" size={16} className="shrink-0 text-[#638078]" />
        <span className="min-w-0 flex-1 truncate">
          {activeCity?.name ?? "Şəhər seçin"}
        </span>
        <ChevronDown aria-hidden="true" size={15} className={`shrink-0 text-[#75817F] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && position && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Şəhər seçin"
          style={{ position: "fixed", top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight, zIndex: 10000 }}
          className="overflow-y-auto rounded-2xl border border-[#DDE7E1] bg-white p-1.5 shadow-[0_18px_48px_rgba(23,58,58,.2)]"
        >
          {cities.length === 0 ? (
            <p role="menuitem" aria-disabled="true" className="px-3 py-3 text-sm text-[#697875]">
              Aktiv şəhər tapılmadı.
            </p>
          ) : cities.map((city) => {
            const isSelected = city.slug === activeCity?.slug;
            return (
              <button
                key={city.id}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                onClick={() => chooseCity(city)}
                className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#4F8175] ${isSelected ? "bg-[#EFF5F1] text-[#24413D]" : "text-[#405451] hover:bg-[#F5F8F5]"}`}
              >
                <span className="min-w-0 flex-1">{city.name}</span>
                {isSelected && <Check aria-hidden="true" size={16} className="shrink-0 text-[#2F6F68]" />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
