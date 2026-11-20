"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BellRing, Volume2, VolumeX, X } from "lucide-react";
import { cx, focusRing } from "@/components/ui/cx";
import { isOrdersPath, nextOrderAlertsDelay, titleWithOrderCount } from "@/lib/vendor-order-alerts";

/**
 * New-order alerts in the seller panel header (SELLER-ALERTS, part C).
 * - Polls GET /api/vendor/<store>/order-alerts every 30 s while the tab is visible, every 120 s while hidden; errors
 *   back off; never more than one request in flight; stops on 401/404 (signed out) and when the panel unmounts.
 * - New orders: a short beep (Web Audio API, no file) if sound is on, a toast with a link to the orders page, and
 *   "(N) " in the tab title until the seller opens the orders page.
 * - "Səs bildirişi: açıq / bağlı": OFF by default (browsers block sound before a click). The choice and the "seen
 *   up to" time are kept in localStorage (try/catch). If the browser refuses sound, the toast still shows.
 * The toast is position: fixed and the button has a fixed size, so nothing in the page moves. The toast is portalled to
 * <body>: the panel header uses backdrop-filter, which would make it the containing block of a fixed child (the toast
 * then sat inside the 72 px header, found in the scratch check).
 */
const SOUND_KEY = "bagati.vendor.orderSound";
const seenKey = (storeId: string) => `bagati.vendor.orderAlerts.seen.${storeId}`;
const read = (key: string) => { try { return window.localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { window.localStorage.setItem(key, value); } catch { /* private mode: keep it in memory */ } };

type AudioCtx = AudioContext;
function beep(context: AudioCtx | null) {
  if (!context) return;
  try {
    const now = context.currentTime;
    for (const [frequency, start] of [[880, 0], [1175, 0.16]] as const) {
      const oscillator = context.createOscillator(), gain = context.createGain();
      oscillator.type = "sine"; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.25, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + 0.14);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + start); oscillator.stop(now + start + 0.15);
    }
  } catch { /* sound refused: the toast is enough */ }
}

export function VendorOrderAlerts({ storeId }: { storeId: string }) {
  const pathname = usePathname();
  const [soundOn, setSoundOn] = useState(false);
  const [count, setCount] = useState(0);
  const [toast, setToast] = useState(false);
  const audio = useRef<AudioCtx | null>(null);
  const seen = useRef<string | null>(null);
  const lastCount = useRef(0);
  const latest = useRef<string | null>(null);
  const soundRef = useRef(false);
  const onOrders = isOrdersPath(pathname ?? "", storeId);
  const onOrdersRef = useRef(onOrders);
  onOrdersRef.current = onOrders;

  const ensureAudio = useCallback(() => {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      audio.current ??= new Ctor();
      if (audio.current.state === "suspended") void audio.current.resume().catch(() => undefined);
      return audio.current;
    } catch { return null; }
  }, []);

  // Restore the sound choice; after a reload the browser still needs one click before it plays sound.
  useEffect(() => {
    const on = read(SOUND_KEY) === "on";
    setSoundOn(on); soundRef.current = on;
    if (!on) return;
    const unlock = () => { ensureAudio(); window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
    window.addEventListener("pointerdown", unlock); window.addEventListener("keydown", unlock);
    return () => { window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
  }, [ensureAudio]);

  const markSeen = useCallback((time: string | null) => {
    if (!time) return;
    seen.current = time; write(seenKey(storeId), time);
    lastCount.current = 0; setCount(0); setToast(false);
  }, [storeId]);

  // Polling: one request at a time, interval by tab visibility, back-off on errors, stop when signed out.
  useEffect(() => {
    seen.current = read(seenKey(storeId));
    let timer: ReturnType<typeof setTimeout> | undefined, stopped = false, inFlight = false, errors = 0;
    const schedule = () => { if (!stopped) timer = setTimeout(poll, nextOrderAlertsDelay({ hidden: document.hidden, errors })); };
    async function poll() {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const query = seen.current ? `?after=${encodeURIComponent(seen.current)}` : "";
        const response = await fetch(`/api/vendor/${encodeURIComponent(storeId)}/order-alerts${query}`, { cache: "no-store" });
        if (response.status === 401 || response.status === 404) { stopped = true; return; }
        if (!response.ok) throw new Error("alerts");
        const data = await response.json() as { count: number; newestAt: string | null; serverTime: string };
        errors = 0;
        latest.current = data.newestAt ?? latest.current;
        if (!seen.current || onOrdersRef.current) { markSeen(data.newestAt ?? data.serverTime); return; }
        if (data.count > lastCount.current) {
          if (soundRef.current) beep(ensureAudio());
          setToast(true);
        }
        lastCount.current = data.count; setCount(data.count);
      } catch {
        errors += 1;
      } finally {
        inFlight = false; schedule();
      }
    }
    const onVisible = () => { if (!document.hidden && !inFlight) { clearTimeout(timer); void poll(); } };
    document.addEventListener("visibilitychange", onVisible);
    void poll();
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [storeId, ensureAudio, markSeen]);

  // Opening the orders page clears the alert (up to the newest order the panel has seen).
  useEffect(() => { if (onOrders && lastCount.current > 0) markSeen(latest.current ?? new Date().toISOString()); }, [onOrders, markSeen]);

  // "(N) " in the tab title; re-applied when a page navigation sets a new title.
  useEffect(() => {
    const apply = () => { const next = titleWithOrderCount(document.title, count); if (next !== document.title) document.title = next; };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [count, pathname]);

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next); soundRef.current = next;
    write(SOUND_KEY, next ? "on" : "off");
    if (next) beep(ensureAudio()); // the click unlocks audio; the short beep confirms it works
  }

  const label = soundOn ? "Səs bildirişi: açıq" : "Səs bildirişi: bağlı";
  return <>
    <button type="button" onClick={toggleSound} aria-pressed={soundOn} aria-label={label} title={label} data-vendor-order-sound=""
      className={cx("inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-medium transition-colors hover:bg-primary-subtle", soundOn ? "text-primary" : "text-fg-secondary", focusRing)}>
      {soundOn ? <Volume2 size={18} aria-hidden="true"/> : <VolumeX size={18} aria-hidden="true"/>}
      <span className="hidden whitespace-nowrap xl:inline">{label}</span>
    </button>
    {toast && count > 0 && createPortal(<div role="status" aria-live="polite" data-vendor-order-toast=""
      className="fixed inset-x-4 bottom-4 z-50 flex items-center gap-3 rounded-card border border-line bg-white p-4 shadow-overlay sm:inset-x-auto sm:right-6 sm:w-[22rem]">
      <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-subtle text-primary"><BellRing size={18}/></span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-fg">Yeni sifariş gəldi{count > 1 ? ` (${count})` : ""}</p>
        <Link href={`/vendor/${storeId}/orders`} className={cx("mt-0.5 inline-flex min-h-8 items-center rounded-sm text-sm font-medium text-primary underline underline-offset-2 hover:text-primary-hover", focusRing)}>Sifarişlərə bax</Link>
      </div>
      <button type="button" onClick={() => setToast(false)} aria-label="Bağla" className={cx("grid h-11 w-11 shrink-0 place-items-center rounded-full text-fg-muted hover:bg-surface-sunken hover:text-fg", focusRing)}><X size={18} aria-hidden="true"/></button>
    </div>, document.body)}
  </>;
}
