"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";
import { CENTER_TEXT } from "@/lib/security-center-status";

/*
 * SECURITY-CENTER-DESIGN-2: incident actions on the overview. Every change goes through the EXISTING endpoint
 * PATCH /api/admin/security/incidents/[id] (same-origin CSRF check, ADMIN + security.manage, the expectedStatus
 * conflict check, the SECURITY_INCIDENT_STATUS audit row): nothing new on the server. The result message lives in the
 * provider above the list, so it stays visible after the page refresh removes a resolved incident.
 */

type OpenStatus = "OPEN" | "ACKNOWLEDGED";
type Next = "ACKNOWLEDGED" | "RESOLVED";
// Existing labels (components/admin-security-monitoring.tsx STATUS_ACTIONS / STATUS_LABELS).
const ACTION_LABELS: Record<Next, string> = { ACKNOWLEDGED: "Qəbul et", RESOLVED: "Həll edildi" };
const STATUS_LABELS: Record<Next, string> = { ACKNOWLEDGED: "Qəbul edilib", RESOLVED: "Həll edilib" };

type Message = { ok: boolean; text: string } | null;
const MessageContext = createContext<(message: Message) => void>(() => undefined);

export async function patchIncident(id: string, expectedStatus: OpenStatus, status: Next): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch(`/api/admin/security/incidents/${encodeURIComponent(id)}`, {
      method: "PATCH", cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ expectedStatus, status, comment: null }),
    });
    if (response.ok) return { ok: true };
    const body = await response.json().catch(() => ({})) as { error?: unknown };
    return { ok: false, error: typeof body.error === "string" ? body.error : "Sorğu alınmadı." };
  } catch {
    return { ok: false, error: "Sorğu alınmadı." };
  }
}

export function IncidentMessages({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<Message>(null);
  return <MessageContext.Provider value={setMessage}>
    <div role="status" aria-live="polite" data-incident-message="">
      {message && <p className={`mb-3 flex items-start gap-2 rounded-xl border p-3 text-sm ${message.ok ? "border-green-200 bg-green-50 text-green-900" : "border-red-200 bg-red-50 text-red-800"}`}>
        {message.ok ? <CheckCircle2 size={16} aria-hidden="true" className="mt-0.5 shrink-0"/> : <XCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0"/>}{message.text}
      </p>}
    </div>
    {children}
  </MessageContext.Provider>;
}

const button = "inline-flex min-h-11 items-center justify-center rounded-xl border px-3 text-sm font-semibold disabled:cursor-wait disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#173c40]";

/** "Qəbul et" (only while OPEN) and "Həll edildi" for one incident. */
export function IncidentQuickActions({ id, status }: { id: string; status: OpenStatus }) {
  const router = useRouter();
  const say = useContext(MessageContext);
  const [busy, setBusy] = useState(false);
  const run = async (next: Next) => {
    setBusy(true);
    say(null);
    const result = await patchIncident(id, status, next);
    setBusy(false);
    say(result.ok ? { ok: true, text: CENTER_TEXT.statusChanged(STATUS_LABELS[next]) } : { ok: false, text: result.error });
    if (result.ok) router.refresh();
  };
  return <div className="flex flex-wrap gap-2">
    {status === "OPEN" && <button type="button" disabled={busy} onClick={() => void run("ACKNOWLEDGED")} className={`${button} border-[#c7ad78] bg-white text-[#85621d]`}>{ACTION_LABELS.ACKNOWLEDGED}</button>}
    <button type="button" disabled={busy} onClick={() => void run("RESOLVED")} className={`${button} border-[#173c40] bg-[#173c40] text-white`}>{ACTION_LABELS.RESOLVED}</button>
  </div>;
}

/**
 * Bulk "resolve" for open scan-noise incidents (at most the 25 the page passes). It only repeats the existing PATCH,
 * one incident after another, so each one gets the same audit row as a single click. Asks for confirmation first.
 */
export function ScanBulkResolve({ incidents }: { incidents: ReadonlyArray<{ id: string; status: OpenStatus }> }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [done, setDone] = useState<{ ok: number; failed: number } | null>(null);
  if (!incidents.length) return done ? <p role="status" className="mt-3 text-sm text-green-900">{CENTER_TEXT.bulkDone(done.ok, done.failed)}</p> : null;
  const run = async () => {
    setConfirming(false);
    let ok = 0, failed = 0;
    setProgress(0);
    for (const [index, incident] of incidents.entries()) {
      const result = await patchIncident(incident.id, incident.status, "RESOLVED");
      if (result.ok) ok += 1; else failed += 1;
      setProgress(index + 1);
    }
    setProgress(null);
    setDone({ ok, failed });
    router.refresh();
  };
  return <div className="mt-3" data-scan-bulk="">
    {progress !== null ? <p role="status" className="text-sm text-slate-600">{CENTER_TEXT.bulkBusy(progress, incidents.length)}</p>
      : confirming ? <div className="rounded-xl border border-[#e7e3d9] bg-[#f8f7f4] p-3 text-sm">
          <p>{CENTER_TEXT.bulkConfirm(incidents.length)}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => void run()} className={`${button} border-[#173c40] bg-[#173c40] text-white`}>{CENTER_TEXT.bulkYes}</button>
            <button type="button" onClick={() => setConfirming(false)} className={`${button} border-[#e7e3d9] bg-white text-slate-700`}>{CENTER_TEXT.bulkCancel}</button>
          </div>
        </div>
        : <button type="button" onClick={() => { setDone(null); setConfirming(true); }} className={`${button} border-[#e7e3d9] bg-white text-slate-700`}>{CENTER_TEXT.bulkClose(incidents.length)}</button>}
    {done && progress === null && <p role="status" className="mt-2 text-sm text-slate-700">{CENTER_TEXT.bulkDone(done.ok, done.failed)}</p>}
  </div>;
}
