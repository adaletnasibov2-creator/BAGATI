"use client";

import { useEffect, useState } from "react";
import { isWithinStoreHours, STORE_HOURS_TEXTS } from "@/lib/store-hours";

/**
 * STORE-HOURS: information-only dot next to a store name. Green = inside the store's hours now (Asia/Baku), grey ring =
 * outside. It never blocks anything.
 *
 * Decided in the browser, never on the server: the HTML stays the same at every minute, so it can be cached (B1 /
 * Cloudflare) without showing a stale colour. The server render and the first client render are an empty box of the
 * same size (no layout shift, no hydration mismatch); after mount the colour is computed and re-checked every 60 s while
 * the tab is visible. Without JavaScript the box stays empty and the "İş saatları" text line still shows the hours.
 * Not colour alone: green is a filled dot (bg-emerald = the design token --bagati-accent, 5.9:1 on white), grey is a hollow
 * ring (border-line-strong, 3.2:1); the title and a visually hidden text say "İndi iş saatıdır" / "İndi iş saatı deyil".
 */
export function StoreHoursDot({ openingTime, closingTime, className = "" }: { openingTime: string; closingTime: string; className?: string }) {
  const [inside, setInside] = useState<boolean | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const check = () => setInside(isWithinStoreHours(openingTime, closingTime, new Date()));
    const start = () => { if (!timer) timer = setInterval(check, 60_000); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const onVisibility = () => {
      if (document.visibilityState === "visible") { check(); start(); } else stop();
    };
    check();
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [openingTime, closingTime]);

  const text = inside === null ? null : inside ? STORE_HOURS_TEXTS.inside : STORE_HOURS_TEXTS.outside;
  return <span data-store-hours-dot={inside === null ? "pending" : inside ? "inside" : "outside"} title={text ?? undefined} className={`inline-grid h-2.5 w-2.5 shrink-0 place-items-center ${className}`}>
    {inside !== null && <>
      <span aria-hidden="true" className={inside ? "h-2.5 w-2.5 rounded-full bg-emerald" : "h-2.5 w-2.5 rounded-full border-2 border-line-strong bg-white"}/>
      <span className="sr-only">{text}</span>
    </>}
  </span>;
}
