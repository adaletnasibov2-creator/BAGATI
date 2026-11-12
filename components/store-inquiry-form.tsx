"use client";

import { useState } from "react";
import { CheckCircle2, Send } from "lucide-react";

const LIMITS = { name: 80, email: 254, phone: 20, message: 2000, messageMin: 10 } as const;
const field = "mt-1 w-full rounded-xl border border-line bg-white px-3.5 py-3 text-sm text-ink outline-none transition focus:border-[#93ADA0] focus:ring-2 focus:ring-[#DCE8DF]";

/**
 * Buyer → store message form. Posts to the same-origin API; the store's email address is never
 * part of this component or of the API response.
 */
export default function StoreInquiryForm({ storeId, storeName }: { storeId: string; storeName: string }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const contactEmail = String(form.get("contactEmail") ?? "").trim();
    const contactPhone = String(form.get("contactPhone") ?? "").trim();
    if (!contactEmail && !contactPhone) { setError("Sizə cavab verə bilməyimiz üçün e-poçt və ya telefon nömrəsi yazın."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/stores/${encodeURIComponent(storeId)}/inquiries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(form.get("name") ?? ""),
          contactEmail,
          contactPhone,
          message,
          website: String(form.get("website") ?? ""),
          consent: form.get("consent") === "on",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Mesaj göndərilmədi. Yenidən cəhd edin.");
      setSent(typeof data.message === "string" ? data.message : "Mesajınız göndərildi.");
      setMessage("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Mesaj göndərilmədi. Yenidən cəhd edin.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return <div role="status" className="rounded-2xl border border-[#CFE3D6] bg-[#F1F8F3] p-5 text-sm leading-6 text-[#1F5A3E]">
      <p className="flex items-center gap-2 font-semibold"><CheckCircle2 size={18} aria-hidden="true"/>Mesaj göndərildi</p>
      <p className="mt-1">{sent}</p>
      <button type="button" onClick={() => setSent("")} className="mt-3 min-h-11 font-medium underline">Yeni mesaj yaz</button>
    </div>;
  }

  return <form onSubmit={submit} className="relative grid gap-4" aria-label={`${storeName} mağazasına mesaj`}>
    <label className="text-sm font-medium text-ink">Adınız
      <input name="name" required minLength={2} maxLength={LIMITS.name} autoComplete="name" className={field}/>
    </label>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-medium text-ink">E-poçtunuz <span className="font-normal text-muted">(cavab üçün)</span>
        <input name="contactEmail" type="email" maxLength={LIMITS.email} autoComplete="email" className={field}/>
      </label>
      <label className="text-sm font-medium text-ink">Telefonunuz <span className="font-normal text-muted">(istəyə bağlı)</span>
        <input name="contactPhone" type="tel" inputMode="tel" maxLength={LIMITS.phone} autoComplete="tel" placeholder="055 123 45 67" className={field}/>
      </label>
    </div>
    <p className="-mt-2 text-xs text-muted">E-poçt və ya telefondan ən azı birini yazın.</p>
    <label className="text-sm font-medium text-ink">Mesajınız
      <textarea name="message" required minLength={LIMITS.messageMin} maxLength={LIMITS.message} rows={5} value={message} onChange={(event) => setMessage(event.target.value)} className={`${field} resize-y`}/>
      <span className="mt-1 block text-right text-xs font-normal text-muted">{message.length} / {LIMITS.message}</span>
    </label>
    {/* Honeypot: hidden from people and assistive technology; bots that fill it are silently ignored. */}
    <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
      <label>Vebsayt<input name="website" type="text" tabIndex={-1} autoComplete="off"/></label>
    </div>
    <label className="flex items-start gap-3 text-sm leading-6 text-muted">
      <input name="consent" type="checkbox" required className="mt-1 h-5 w-5 shrink-0 accent-[#173A3A]"/>
      <span>Adımın, əlaqə məlumatlarımın və mesajımın cavab almaq üçün bu mağazaya göndərilməsinə razıyam.</span>
    </label>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <button disabled={busy} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-ink px-5 text-sm font-semibold text-white transition hover:bg-emerald focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C79A52] disabled:opacity-60 sm:w-fit">
      <Send size={16} aria-hidden="true"/>{busy ? "Göndərilir…" : "Mesajı göndər"}
    </button>
  </form>;
}
