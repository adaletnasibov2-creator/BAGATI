"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

/**
 * Verifies a store's extra notification email (SELLER-ALERTS, part B). The token is read from the URL fragment
 * (#token=...), removed from the address bar at once, and posted to /api/store-notification-email/verify.
 */
export const NOTIFICATION_EMAIL_LINK_INVALID = "Təsdiq keçidi etibarsızdır və ya vaxtı bitib.";

export function NotificationEmailVerify() {
  const [state, setState] = useState<"checking" | "ok" | "failed">("checking");
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    // Keep the token out of history, bookmarks and screenshots.
    window.history.replaceState(null, "", window.location.pathname);
    if (!token) { setState("failed"); return; }
    let active = true;
    fetch("/api/store-notification-email/verify", { method: "POST", headers: { "Content-Type": "application/json" }, referrerPolicy: "no-referrer", body: JSON.stringify({ token }) })
      .then((response) => response.json().catch(() => ({})))
      .then((data: { ok?: boolean }) => { if (active) setState(data.ok ? "ok" : "failed"); })
      .catch(() => { if (active) setState("failed"); });
    return () => { active = false; };
  }, []);
  return <div role="status" aria-live="polite" className="mt-6 flex min-h-12 items-center gap-3 rounded-control bg-surface-page px-4 py-3 text-sm font-medium">
    {state === "checking" && <span className="text-fg-secondary">Yoxlanılır…</span>}
    {state === "ok" && <><CheckCircle2 aria-hidden="true" size={20} className="shrink-0 text-primary"/><span className="text-primary">Təsdiqlənib</span></>}
    {state === "failed" && <><XCircle aria-hidden="true" size={20} className="shrink-0 text-danger"/><span className="text-danger">{NOTIFICATION_EMAIL_LINK_INVALID}</span></>}
  </div>;
}
