"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { AUTO_REFRESH, autoRefreshStep, bakuClock, CENTER_TEXT, refreshOutcome } from "@/lib/security-center-status";

/**
 * SECURITY-CENTER-DESIGN-2: "Yenilə" really reloads the server data (router.refresh re-renders the force-dynamic page)
 * and proves it: the server sends its render time (`renderedAt`), shown as "Son yenilənmə: HH:MM:SS" (Asia/Baku). When
 * the time did not change after a refresh, the refresh failed and the admin is told so.
 *
 * The optional auto-refresh is OFF by default; while on it refreshes every 60 s, only while the browser tab is visible,
 * never while a refresh is still running, stops itself after a failed refresh, and turns itself off after 60 runs.
 * A chain of single timeouts (no repeating timer); the timer is cleared when the switch goes off or the page is left.
 * While full IPs are shown (`fullIp`, ?ip=full) the switch is off and disabled: every render of such a page writes a
 * SECURITY_FULL_IP_VIEW audit row, so it must never repeat by itself (owner decision, DESIGN-2).
 */
export default function SecurityRefresh({ renderedAt, fullIp = false }: { renderedAt: string; fullIp?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<"ok" | "failed" | "stopped" | null>(null);
  const [auto, setAuto] = useState(false);
  const requestedAt = useRef<string | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const latest = useRef(renderedAt);
  latest.current = renderedAt;

  const refresh = useCallback(() => {
    requestedAt.current = latest.current;
    setResult(null);
    startTransition(() => router.refresh());
  }, [router]);

  // When the refresh finished: compare the server render time before and after.
  useEffect(() => {
    if (pending || requestedAt.current === null) return;
    const outcome = refreshOutcome(requestedAt.current, renderedAt);
    requestedAt.current = null;
    setResult(outcome);
    if (outcome === "failed") setAuto(false);
  }, [pending, renderedAt]);

  // Full IPs on screen: the switch turns itself off (also when the page changes to ?ip=full without a reload).
  useEffect(() => { if (fullIp) setAuto(false); }, [fullIp]);

  useEffect(() => {
    if (!auto || fullIp) return;
    let runs = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const step = autoRefreshStep({ visible: document.visibilityState === "visible", pending: pendingRef.current, runs, fullIp });
      if (step === "stop") { setAuto(false); setResult("stopped"); return; }
      if (step === "refresh") { runs += 1; refresh(); }
      timer = setTimeout(tick, AUTO_REFRESH.seconds * 1000);
    };
    timer = setTimeout(tick, AUTO_REFRESH.seconds * 1000);
    return () => { if (timer) clearTimeout(timer); };
  }, [auto, fullIp, refresh]);

  const message = pending ? CENTER_TEXT.refreshing : result === "ok" ? CENTER_TEXT.refreshed : result === "failed" ? CENTER_TEXT.refreshFailed : result === "stopped" ? CENTER_TEXT.autoStopped : "";
  return <div className="flex flex-col items-start gap-1.5 sm:items-end" data-security-refresh="">
    <div className="flex flex-wrap items-center gap-3">
      <label className={`inline-flex min-h-11 items-center gap-2 text-sm ${fullIp ? "cursor-not-allowed text-slate-400" : "cursor-pointer text-slate-600"}`}>
        <input type="checkbox" className="h-4 w-4 accent-[#173c40]" checked={auto && !fullIp} disabled={fullIp} aria-describedby={fullIp ? "auto-refresh-full-ip" : undefined}
          onChange={(event) => { setAuto(event.target.checked && !fullIp); setResult(null); }} data-auto-refresh="" />
        {CENTER_TEXT.autoRefresh}
      </label>
      <button type="button" onClick={refresh} disabled={pending} aria-busy={pending}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#173c40] px-4 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#173c40]">
        <RefreshCw size={16} aria-hidden="true" className={pending ? "animate-spin" : ""}/>Yenilə
      </button>
    </div>
    {fullIp && <p id="auto-refresh-full-ip" className="text-xs text-slate-500" data-auto-off-full-ip="">{CENTER_TEXT.autoOffFullIp}</p>}
    <p className="text-xs text-slate-500" data-rendered-at={renderedAt}>{CENTER_TEXT.lastRefresh(bakuClock(renderedAt))}</p>
    <p role="status" aria-live="polite" className={`min-h-4 text-xs ${result === "failed" ? "text-red-700" : "text-slate-600"}`}>{message}</p>
  </div>;
}
