"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, Flag } from "lucide-react";
import { MessageComposer, messagingErrorText, postMessagingJson } from "@/components/message-composer";
import { MESSAGE_LIMITS, MESSAGING_TEXT, REPORT_REASONS, type ReportReason } from "@/lib/messaging";
import { formatMessageTime, isStopPollStatus, nextPollDelay, pollStopMessage } from "@/lib/messaging-client";

export type ThreadMessage = { id: string; senderRole: "CUSTOMER" | "STORE"; body: string; createdAt: string };

/**
 * One conversation for the customer or the seller: the last 30 messages, "Əvvəlki mesajlar", polling for new ones,
 * the text box, and the block / report actions. Message text is rendered as plain React text (escaped, never HTML).
 */
export function ConversationThread({
  api,
  viewerRole,
  counterpart,
  initialMessages,
  initialHasOlder,
  initialUnread,
  blockedByMe: initialBlockedByMe,
  blockedByOther,
  allowContactDetails,
}: {
  api: string;
  viewerRole: "CUSTOMER" | "STORE";
  counterpart: string;
  initialMessages: ThreadMessage[];
  initialHasOlder: boolean;
  initialUnread: number;
  blockedByMe: boolean;
  blockedByOther: boolean;
  allowContactDetails: boolean;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [hasOlder, setHasOlder] = useState(initialHasOlder);
  const [olderBusy, setOlderBusy] = useState(false);
  const [olderError, setOlderError] = useState("");
  const [stopped, setStopped] = useState<string | null>(null);
  const [blockedByMe, setBlockedByMe] = useState(initialBlockedByMe);
  const lastId = useRef(initialMessages.at(-1)?.id ?? null);
  const lastNewsAt = useRef(Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const polling = useRef(false);
  const stoppedRef = useRef(false);
  // Scroll target: the text box (scroll-margin keeps it above the phone's fixed bottom navigation).
  const end = useRef<HTMLDivElement>(null);

  const markRead = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    void postMessagingJson(`${api}/read`, undefined).catch(() => undefined);
  }, [api]);

  const append = useCallback((items: ThreadMessage[]) => {
    if (!items.length) return;
    setMessages((current) => {
      const known = new Set(current.map((item) => item.id));
      return [...current, ...items.filter((item) => !known.has(item.id))];
    });
    lastId.current = items.at(-1)!.id;
  }, []);

  const stop = useCallback((status: number) => {
    stoppedRef.current = true;
    if (timer.current) clearTimeout(timer.current);
    setStopped(pollStopMessage(status));
  }, []);

  /** One check for new messages; returns true when something new arrived. */
  const poll = useCallback(async () => {
    if (polling.current || stoppedRef.current || !lastId.current) return false;
    polling.current = true;
    try {
      const response = await fetch(`${api}?after=${encodeURIComponent(lastId.current)}`, { cache: "no-store", credentials: "same-origin" });
      if (response.status === 204) return false;
      if (isStopPollStatus(response.status)) { stop(response.status); return false; }
      if (!response.ok) return false;
      const data = await response.json() as { items?: ThreadMessage[] };
      const items = Array.isArray(data.items) ? data.items : [];
      if (!items.length) return false;
      append(items);
      lastNewsAt.current = Date.now();
      if (items.some((item) => item.senderRole !== viewerRole)) markRead();
      return true;
    } catch {
      return false; // Offline for a moment: the next scheduled check tries again.
    } finally {
      polling.current = false;
    }
  }, [api, append, markRead, stop, viewerRole]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (stoppedRef.current || document.visibilityState !== "visible") return;
    timer.current = setTimeout(async () => {
      await poll();
      schedule();
    }, nextPollDelay(lastNewsAt.current, Date.now()));
  }, [poll]);

  useEffect(() => {
    if (initialUnread > 0) markRead();
    const initialScroll = setTimeout(() => end.current?.scrollIntoView({ block: "end" }), 60);
    schedule();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void poll().then(schedule);
      else if (timer.current) clearTimeout(timer.current);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimeout(initialScroll);
      if (timer.current) clearTimeout(timer.current);
    };
    // Runs once per thread; the callbacks are stable for a given api.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  async function send(body: string) {
    const response = await postMessagingJson(api, { body });
    if (!response.ok) return messagingErrorText(response);
    lastNewsAt.current = Date.now();
    await poll();
    schedule();
    requestAnimationFrame(() => end.current?.scrollIntoView({ block: "end", behavior: "smooth" }));
    return null;
  }

  async function loadOlder() {
    const first = messages[0];
    if (!first || olderBusy) return;
    setOlderBusy(true); setOlderError("");
    try {
      const response = await fetch(`${api}?before=${encodeURIComponent(first.id)}`, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) { setOlderError(await messagingErrorText(response)); return; }
      const data = await response.json() as { items: ThreadMessage[]; hasOlder: boolean };
      setMessages((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...data.items.filter((item) => !known.has(item.id)), ...current];
      });
      setHasOlder(Boolean(data.hasOlder));
    } catch {
      setOlderError("Mesajlar yüklənmədi. Yenidən cəhd edin.");
    } finally {
      setOlderBusy(false);
    }
  }

  const blocked = blockedByMe || blockedByOther;
  return <div className="grid gap-4">
    <section aria-label="Mesajlar" className="rounded-2xl border border-[#E5E1D7] bg-white p-3 sm:p-5">
      {hasOlder && <div className="mb-3 text-center">
        <button type="button" onClick={() => void loadOlder()} disabled={olderBusy} className="inline-flex min-h-11 items-center rounded-full border border-[#D9E0DC] px-4 text-sm font-medium text-[#2F5D50] hover:bg-[#F2F6F3] disabled:opacity-60">
          {olderBusy ? "Yüklənir…" : "Əvvəlki mesajlar"}
        </button>
        {olderError && <p role="alert" className="mt-2 text-xs text-red-700">{olderError}</p>}
      </div>}
      <ol className="grid gap-2.5" aria-live="polite" aria-relevant="additions">
        {messages.map((message) => {
          const mine = message.senderRole === viewerRole;
          return <li key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 sm:max-w-[70%] ${mine ? "rounded-br-md bg-[#173A3A] text-white" : "rounded-bl-md bg-[#F2F4F1] text-[#16202C]"}`}>
              <p className="sr-only">{mine ? "Siz" : counterpart}:</p>
              <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.body}</p>
              <p className={`mt-1 text-[11px] ${mine ? "text-white/70" : "text-[#6B7680]"}`}>{formatMessageTime(message.createdAt)}</p>
            </div>
          </li>;
        })}
      </ol>
      {stopped && <p role="status" className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">{stopped}</p>}
    </section>

    <div ref={end} className="scroll-mb-24 lg:scroll-mb-6"><MessageComposer
      allowContactDetails={allowContactDetails}
      disabled={blocked || Boolean(stopped)}
      disabledText={stopped ?? (blockedByMe ? (viewerRole === "CUSTOMER" ? "Bu mağazanı bloklamısınız. Yazmaq üçün bloku götürün." : "Bu müştərini bloklamısınız. Yazmaq üçün bloku götürün.") : MESSAGING_TEXT.blocked)}
      onSend={send}
    /></div>

    <ThreadActions api={api} viewerRole={viewerRole} blockedByMe={blockedByMe} onBlockedChange={setBlockedByMe}/>
  </div>;
}

function ThreadActions({ api, viewerRole, blockedByMe, onBlockedChange }: { api: string; viewerRole: "CUSTOMER" | "STORE"; blockedByMe: boolean; onBlockedChange: (blocked: boolean) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState<ReportReason | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const other = viewerRole === "CUSTOMER" ? "mağaza" : "müştəri";

  async function toggleBlock() {
    setBusy(true); setError(""); setNotice("");
    const response = await postMessagingJson(`${api}/block`, undefined, blockedByMe ? "DELETE" : "POST").catch(() => null);
    setBusy(false); setConfirming(false);
    if (!response?.ok) { setError(response ? await messagingErrorText(response) : "Əməliyyat alınmadı."); return; }
    onBlockedChange(!blockedByMe);
    setNotice(blockedByMe ? "Blok götürüldü." : `Bu ${other} artıq sizə yaza bilməz.`);
  }

  async function sendReport(event: React.FormEvent) {
    event.preventDefault();
    if (!reason) { setError("Şikayətin səbəbini seçin."); return; }
    setBusy(true); setError(""); setNotice("");
    const response = await postMessagingJson(`${api}/report`, { reason, note: note.trim() || null }).catch(() => null);
    setBusy(false);
    if (!response?.ok) { setError(response ? await messagingErrorText(response) : "Əməliyyat alınmadı."); return; }
    setReporting(false); setReason(""); setNote("");
    setNotice("Şikayətiniz qəbul edildi. BAGATI komandası yoxlayacaq.");
  }

  return <section aria-label="Söhbət əməliyyatları" className="rounded-2xl border border-[#E5E1D7] bg-white p-3 text-sm sm:p-4">
    <div className="flex flex-wrap gap-2">
      {blockedByMe
        ? <button type="button" disabled={busy} onClick={() => void toggleBlock()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#D9E0DC] px-3 font-medium text-[#2F5D50] hover:bg-[#F2F6F3] disabled:opacity-60"><Ban size={16} aria-hidden="true"/>Bloku götür</button>
        : confirming
          ? <span className="flex flex-wrap items-center gap-2">
            <span className="text-[#5B6672]">Bloklansın? Bu {other} ilə yazışma dayanacaq.</span>
            <button type="button" disabled={busy} onClick={() => void toggleBlock()} className="inline-flex min-h-11 items-center rounded-xl bg-red-700 px-3 font-semibold text-white disabled:opacity-60">Bəli, blokla</button>
            <button type="button" onClick={() => setConfirming(false)} className="inline-flex min-h-11 items-center rounded-xl px-3 text-[#5B6672]">İmtina</button>
          </span>
          : <button type="button" onClick={() => setConfirming(true)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#D9E0DC] px-3 font-medium text-[#5B6672] hover:bg-[#F7F5EF]"><Ban size={16} aria-hidden="true"/>Blokla</button>}
      {!reporting && <button type="button" onClick={() => { setReporting(true); setNotice(""); }} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#D9E0DC] px-3 font-medium text-[#5B6672] hover:bg-[#F7F5EF]"><Flag size={16} aria-hidden="true"/>Şikayət et</button>}
    </div>
    {reporting && <form onSubmit={sendReport} className="mt-3 grid gap-2 border-t border-[#EEEAE2] pt-3">
      <label className="grid gap-1">Səbəb
        <select value={reason} onChange={(event) => setReason(event.target.value as ReportReason)} className="min-h-11 rounded-xl border border-[#D9E0DC] bg-white px-3 text-base sm:text-sm">
          <option value="">Seçin</option>
          {(Object.keys(REPORT_REASONS) as ReportReason[]).map((key) => <option key={key} value={key}>{REPORT_REASONS[key]}</option>)}
        </select>
      </label>
      <label className="grid gap-1">Qeyd <span className="text-xs text-[#6B7680]">(istəyə bağlı)</span>
        <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={MESSAGE_LIMITS.reportNoteMax} rows={2} className="rounded-xl border border-[#D9E0DC] px-3 py-2 text-base sm:text-sm"/>
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="inline-flex min-h-11 items-center rounded-xl bg-[#173A3A] px-4 font-semibold text-white disabled:opacity-60">Şikayəti göndər</button>
        <button type="button" onClick={() => setReporting(false)} className="inline-flex min-h-11 items-center rounded-xl px-3 text-[#5B6672]">İmtina</button>
      </div>
    </form>}
    {notice && <p role="status" className="mt-2 text-xs text-emerald-800">{notice}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
  </section>;
}
