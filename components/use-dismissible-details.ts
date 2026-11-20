"use client";

import { useEffect, useRef, useState, type MouseEvent, type SyntheticEvent } from "react";
import { usePathname } from "next/navigation";

/**
 * Closing rules for a header menu built on <details> (DESIGN-T6 bug fix). The header lives in the layout and is not
 * re-mounted on client navigation, so a native <details> stayed open on the next page. This closes it:
 *  - on a route change (pathname change, and browser Back/Forward, which also covers query-only changes such as
 *    /products?category=a -> b);
 *  - on a click on any link inside it (category links often keep the same pathname and change only the query);
 *  - on a pointer press outside it;
 *  - on Escape, and then focus returns to its <summary> button.
 * Spread the returned props on the <details> element and attach the ref.
 */

/** The part of a <details> element the rules need (a real element in the browser, a stand-in in unit tests). */
export type DetailsLike = {
  open: boolean;
  contains(node: unknown): boolean;
  querySelector(selector: string): { focus(): void } | null;
};

/** Pointer press: close when it lands outside the menu. Returns true when it closed the menu. */
export function closeOnOutsidePress(details: DetailsLike, target: unknown): boolean {
  if (!details.open || details.contains(target)) return false;
  details.open = false;
  return true;
}

/** Key press: Escape closes the open menu and puts focus back on its button. Returns true when it handled the key. */
export function closeOnEscape(details: DetailsLike, key: string): boolean {
  if (key !== "Escape" || !details.open) return false;
  details.open = false;
  details.querySelector("summary")?.focus();
  return true;
}

/** Click inside the menu: a link was activated, so close (the navigation itself goes on). */
export function closeOnLinkActivation(details: DetailsLike, target: { closest(selector: string): unknown } | null): boolean {
  if (!details.open || !target?.closest("a[href]")) return false;
  details.open = false;
  return true;
}

/** Route change or Back/Forward: close without moving focus (the new page decides focus). */
export function closeOnNavigation(details: DetailsLike | null): boolean {
  if (!details?.open) return false;
  details.open = false;
  return true;
}

export function useDismissibleDetails(onClose?: () => void) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => { closeOnNavigation(ref.current); }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const details = ref.current;
    if (!details) return;
    const onPointerDown = (event: PointerEvent) => { closeOnOutsidePress(details, event.target); };
    const onKeyDown = (event: KeyboardEvent) => { if (closeOnEscape(details, event.key)) event.preventDefault(); };
    const onPopState = () => { closeOnNavigation(details); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("popstate", onPopState);
    };
  }, [open]);

  return {
    ref,
    open,
    onToggle(event: SyntheticEvent<HTMLDetailsElement>) {
      const isOpen = event.currentTarget.open;
      setOpen(isOpen);
      if (!isOpen) closeRef.current?.();
    },
    onClick(event: MouseEvent<HTMLDetailsElement>) {
      closeOnLinkActivation(event.currentTarget, event.target as Element | null);
    },
  };
}
