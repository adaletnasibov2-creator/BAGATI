"use client";

import { useState } from "react";
import { buttonClass } from "@/components/admin-ui/styles";

type Revealed = { latitude: number; longitude: number; googleMaps: string; openStreetMap: string };

/** Masked delivery coordinates; "Koordinatları göstər" fetches them from the server, which records the view in the audit log. */
export function AdminCoordinatesReveal({ orderId, masked }: { orderId: string; masked: string }) {
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function reveal() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/admin/order-coordinates/${encodeURIComponent(orderId)}`, { method: "POST" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || "Koordinatları göstərmək alınmadı.");
      setRevealed(json as Revealed);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Koordinatları göstərmək alınmadı.");
    } finally {
      setBusy(false);
    }
  }

  if (revealed) {
    return <p className="mt-2 text-sm">
      <span className="font-mono">{revealed.latitude.toFixed(6)}, {revealed.longitude.toFixed(6)}</span>
      {" · "}<a href={revealed.googleMaps} target="_blank" rel="noopener noreferrer" className="underline">Google Maps</a>
      {" · "}<a href={revealed.openStreetMap} target="_blank" rel="noopener noreferrer" className="underline">OpenStreetMap</a>
    </p>;
  }
  return <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
    <span className="font-mono text-slate-500" aria-label="Koordinatlar gizlədilib">{masked}</span>
    <button type="button" onClick={() => void reveal()} disabled={busy} className={buttonClass("secondary")}>{busy ? "Gözləyin…" : "Koordinatları göstər"}</button>
    <span className="text-xs text-slate-500">Baxış audit jurnalına yazılır.</span>
    {error && <span role="alert" className="w-full text-xs text-red-700">{error}</span>}
  </div>;
}
