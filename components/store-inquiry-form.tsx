"use client";

import { useState } from "react";
import { CheckCircle2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cx, focusRing } from "@/components/ui/cx";
import { Input, Textarea } from "@/components/ui/field";
import { textLinkClass } from "@/components/ui/text-link";

const LIMITS = { name: 80, email: 254, phone: 20, message: 2000, messageMin: 10 } as const;

/**
 * Buyer → store message form. Posts to the same-origin API; the store's email address is never
 * part of this component or of the API response. DESIGN-T10: shared fields and button (visible focus ring, busy
 * spinner); texts, field names, limits and the request are unchanged.
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
      <button type="button" onClick={() => setSent("")} className={cx("mt-3 inline-flex min-h-11 items-center", textLinkClass())}>Yeni mesaj yaz</button>
    </div>;
  }

  return <form onSubmit={submit} className="relative grid gap-4" aria-label={`${storeName} mağazasına mesaj`}>
    <Input id="store-inquiry-name" label="Adınız" name="name" required minLength={2} maxLength={LIMITS.name} autoComplete="name"/>
    <div className="grid gap-4 sm:grid-cols-2">
      <Input id="store-inquiry-email" label={<>E-poçtunuz <span className="font-normal text-fg-muted">(cavab üçün)</span></>} name="contactEmail" type="email" maxLength={LIMITS.email} autoComplete="email" aria-describedby="store-inquiry-contact-note"/>
      <Input id="store-inquiry-phone" label={<>Telefonunuz <span className="font-normal text-fg-muted">(istəyə bağlı)</span></>} name="contactPhone" type="tel" inputMode="tel" maxLength={LIMITS.phone} autoComplete="tel" placeholder="055 123 45 67" aria-describedby="store-inquiry-contact-note"/>
    </div>
    <p id="store-inquiry-contact-note" className="-mt-2 text-xs text-fg-muted">E-poçt və ya telefondan ən azı birini yazın.</p>
    <Textarea id="store-inquiry-message" label="Mesajınız" hint={<span className="block text-right">{message.length} / {LIMITS.message}</span>} name="message" required minLength={LIMITS.messageMin} maxLength={LIMITS.message} rows={5} value={message} onChange={(event) => setMessage(event.target.value)}/>
    {/* Honeypot: hidden from people and assistive technology; bots that fill it are silently ignored. */}
    <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
      <label>Vebsayt<input name="website" type="text" tabIndex={-1} autoComplete="off"/></label>
    </div>
    <label className="flex items-start gap-3 text-sm leading-6 text-fg-secondary">
      <input name="consent" type="checkbox" required className={cx("mt-1 h-5 w-5 shrink-0 cursor-pointer rounded-sm accent-[#173A3A]", focusRing)}/>
      <span>Adımın, əlaqə məlumatlarımın və mesajımın cavab almaq üçün bu mağazaya göndərilməsinə razıyam.</span>
    </label>
    {error && <p role="alert" className="rounded-control bg-danger-subtle px-4 py-3 text-sm font-medium text-danger">{error}</p>}
    <Button type="submit" loading={busy} loadingLabel="Göndərilir…" pill={false} className="w-full sm:w-fit">
      {!busy && <Send size={16} aria-hidden="true"/>}Mesajı göndər
    </Button>
  </form>;
}
