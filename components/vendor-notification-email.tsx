"use client";

import { FormEvent, useEffect, useState } from "react";
import { VendorFormSection, vendorFieldError, vendorInput, vendorLabel } from "@/components/vendor-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Status = { email: string | null; verified: boolean };

/**
 * "Əlavə bildiriş e-poçtu" card in the seller panel (SELLER-ALERTS, part B). Save -> stored unverified and a link is
 * sent; only a verified address receives order emails. Resend and remove. The account email always receives orders.
 * The card keeps its height while loading (the input is rendered at once), so the page does not shift.
 */
export function VendorNotificationEmail({ storeId }: { storeId: string }) {
  const url = `/api/vendor/${encodeURIComponent(storeId)}/notification-email`;
  const [status, setStatus] = useState<Status | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<"save" | "resend" | "remove" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch(url, { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((data: Status | null) => {
      if (!active || !data) return;
      setStatus(data);
      setEmail(data.email ?? "");
    }).catch(() => undefined);
    return () => { active = false; };
  }, [url]);

  async function call(kind: "save" | "resend" | "remove", init: RequestInit) {
    setBusy(kind); setError("");
    try {
      const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Əməliyyatı indi tamamlamaq mümkün olmadı. Bir az sonra yenidən cəhd edin.");
      setStatus({ email: data.email ?? null, verified: Boolean(data.verified) });
      setEmail(data.email ?? "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Əməliyyatı indi tamamlamaq mümkün olmadı. Bir az sonra yenidən cəhd edin.");
    } finally {
      setBusy(null);
    }
  }
  const save = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void call("save", { method: "PUT", body: JSON.stringify({ email }) }); };

  const badge = status?.email ? <Badge tone={status.verified ? "primary" : "gold"} size="md">{status.verified ? "Təsdiqlənib" : "Təsdiq gözləyir"}</Badge> : null;
  return <VendorFormSection title="Əlavə bildiriş e-poçtu" description="Yeni sifarişlər həm hesab e-poçtunuza, həm də bu ünvana göndərilir." aside={badge}>
    <form onSubmit={save} data-vendor-notification-email="" className="grid gap-4">
      <label className={vendorLabel}>E-poçt
        <input type="email" inputMode="email" autoComplete="email" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} aria-invalid={error ? true : undefined} className={vendorInput}/>
      </label>
      {error && <p role="alert" className={vendorFieldError}>{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={busy === "save"} disabled={busy !== null}>Yadda saxla</Button>
        {status?.email && !status.verified && <Button variant="secondary" size="sm" loading={busy === "resend"} disabled={busy !== null} onClick={() => void call("resend", { method: "POST" })}>Təsdiq e-poçtunu yenidən göndər</Button>}
        {status?.email && <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-subtle" loading={busy === "remove"} disabled={busy !== null} onClick={() => void call("remove", { method: "DELETE" })}>Sil</Button>}
      </div>
    </form>
  </VendorFormSection>;
}
