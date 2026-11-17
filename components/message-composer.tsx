"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { MESSAGE_LIMITS, validateMessageBody } from "@/lib/messaging";

/**
 * Text box with a character counter. The same rules as the server run first in the browser (length, control
 * characters, phone / e-mail unless allowed), so most mistakes are shown before sending; the server decides.
 */
export function MessageComposer({
  allowContactDetails,
  disabled = false,
  disabledText,
  placeholder = "Mesajınızı yazın…",
  submitLabel = "Göndər",
  onSend,
}: {
  allowContactDetails: boolean;
  disabled?: boolean;
  disabledText?: string;
  placeholder?: string;
  submitLabel?: string;
  /** Resolves to an error text, or null when sent. */
  onSend: (body: string) => Promise<string | null>;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const length = text.length;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || disabled) return;
    const checked = validateMessageBody(text, { allowContactDetails });
    if (!checked.ok) { setError(checked.message); return; }
    setBusy(true); setError("");
    const failure = await onSend(checked.body).catch(() => "Mesaj göndərilmədi. İnternet bağlantısını yoxlayın.");
    setBusy(false);
    if (failure) { setError(failure); return; }
    setText("");
  }

  if (disabled) {
    return <p role="status" className="rounded-xl border border-[#E5E1D7] bg-[#F7F5EF] p-3 text-sm text-[#5B6672]">{disabledText}</p>;
  }
  return <form onSubmit={submit} className="grid gap-2" noValidate>
    <label htmlFor="message-body" className="sr-only">Mesaj</label>
    <textarea
      id="message-body"
      value={text}
      onChange={(event) => { setText(event.target.value); if (error) setError(""); }}
      maxLength={MESSAGE_LIMITS.bodyMax}
      rows={3}
      placeholder={placeholder}
      aria-invalid={error ? true : undefined}
      aria-describedby="message-body-help"
      className="min-h-24 w-full resize-y rounded-xl border border-[#D9E0DC] bg-white px-3 py-2.5 text-base text-[#16202C] outline-none transition focus:border-[#2F6F68] focus:ring-2 focus:ring-[#2F6F68]/20 sm:text-sm"
    />
    <div id="message-body-help" className="flex items-start justify-between gap-3 text-xs">
      <p className={error ? "text-red-700" : "text-[#6B7680]"} role={error ? "alert" : undefined}>
        {error || "Telefon nömrəsi və e-poçt paylaşmayın; bütün yazışma burada qalır."}
      </p>
      <span className={`shrink-0 tabular-nums ${length > MESSAGE_LIMITS.bodyMax * 0.9 ? "text-amber-700" : "text-[#6B7680]"}`}>{length}/{MESSAGE_LIMITS.bodyMax}</span>
    </div>
    <button type="submit" disabled={busy || !text.trim()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#173A3A] px-5 text-sm font-semibold text-white transition hover:bg-[#2F6F68] disabled:opacity-50 sm:justify-self-end">
      <Send size={16} aria-hidden="true"/>{busy ? "Göndərilir…" : submitLabel}
    </button>
  </form>;
}

/** POST JSON to a same-origin messaging endpoint; resolves to the response (never throws for HTTP errors). */
export async function postMessagingJson(url: string, body: unknown, method: "POST" | "DELETE" = "POST") {
  return fetch(url, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** The error text of a failed messaging response. */
export async function messagingErrorText(response: Response): Promise<string> {
  const data = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof data?.error === "string" ? data.error : "Əməliyyat alınmadı. Bir az sonra yenidən cəhd edin.";
}
