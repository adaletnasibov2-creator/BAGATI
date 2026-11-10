"use client";

import { useEffect, useState } from "react";

export function StickyHeader({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 12);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <header
      data-scrolled={scrolled || undefined}
      className="bagati-sticky-header border-b border-bagati-border bg-white/95 backdrop-blur-xl"
    >
      {children}
    </header>
  );
}
