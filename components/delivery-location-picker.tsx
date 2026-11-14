"use client";

import { useState } from "react";
import { InteractiveMap, type MapPoint } from "@/components/interactive-map";
import { formatCoordinates, normalizeDeliveryCoordinates } from "@/lib/delivery-location";

/**
 * Optional delivery pin for checkout. Never required and never blocks the order: tapping the map, dragging the pin or
 * "Mənim yerim" sets it, "Nöqtəni sil" removes it. A point outside Azerbaijan is not kept (the order then goes with
 * the address text only) and the customer is told so here, before ordering. No reverse geocoding.
 */
export function DeliveryLocationPicker({ value, onChange, title, description, mapClassName = "h-64 sm:h-72" }: {
  value: MapPoint | null;
  onChange: (point: MapPoint | null) => void;
  title: string;
  description?: string;
  mapClassName?: string;
}) {
  const [message, setMessage] = useState("");
  const [locating, setLocating] = useState(false);

  function choose(point: MapPoint, accuracy?: number) {
    const pin = normalizeDeliveryCoordinates(point.latitude, point.longitude);
    if (!pin) {
      onChange(null);
      setMessage("Seçilmiş nöqtə Azərbaycan ərazisindən kənardadır. Nöqtə saxlanmadı; sifariş ünvan mətni ilə göndəriləcək.");
      return;
    }
    onChange(pin);
    setMessage(accuracy !== undefined
      ? `Mövqeyiniz alındı (dəqiqlik təxminən ${Math.max(1, Math.round(accuracy))} m). Nöqtəni xəritədə yoxlayın, lazım olsa sürüşdürün.`
      : "");
  }

  function locate() {
    setMessage("");
    if (!navigator.geolocation) { setMessage("Bu brauzerdə cihaz mövqeyi dəstəklənmir. Nöqtəni xəritədə seçə bilərsiniz."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => { setLocating(false); choose({ latitude: position.coords.latitude, longitude: position.coords.longitude }, position.coords.accuracy); },
      (error) => {
        setLocating(false);
        setMessage(error.code === error.PERMISSION_DENIED ? "Mövqe icazəsi verilmədi. Nöqtəni xəritədə seçə bilərsiniz."
          : error.code === error.POSITION_UNAVAILABLE ? "Mövqe müəyyən edilə bilmədi."
          : error.code === error.TIMEOUT ? "Mövqenin alınması üçün vaxt bitdi."
          : "Mövqe alınmadı. Yenidən cəhd edin.");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }

  return <div data-delivery-location-picker>
    <h3 className="text-sm font-medium">{title}</h3>
    {description && <p className="mt-1 text-sm text-muted">{description}</p>}
    <p className="mt-1 text-xs text-muted">İstəyə bağlıdır: nöqtə seçmədən də sifariş verə bilərsiniz. Cihaz mövqeyi yalnız “Mənim yerim” düyməsinə basdıqda soruşulur.</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" onClick={locate} disabled={locating} className="min-h-10 rounded-xl border border-line px-4 py-2 text-sm disabled:opacity-60">{locating ? "Mövqe alınır…" : "Mənim yerim"}</button>
      {value && <button type="button" onClick={() => { onChange(null); setMessage(""); }} className="min-h-10 rounded-xl border border-line px-4 py-2 text-sm">Nöqtəni sil</button>}
    </div>
    {message && <p role="status" className="mt-2 text-xs text-muted">{message}</p>}
    <div className="mt-3"><InteractiveMap selected={value} onSelect={(point) => choose(point)} className={mapClassName} zoom={value ? 15 : 6} /></div>
    <p className="mt-2 text-xs text-muted">{value ? `Seçilmiş nöqtə: ${formatCoordinates(value)}` : "Nöqtə seçilməyib — sifariş ünvan mətni ilə göndəriləcək."}</p>
  </div>;
}
