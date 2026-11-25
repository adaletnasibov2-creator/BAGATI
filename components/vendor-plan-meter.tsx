"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { planLimitMeter, type PlanLimitMeter } from "@/lib/seller-panel-3";

/**
 * SELLER-PANEL-3: "Aktiv məhsullar: N / limit" from the existing subscription API (real counts and the plan limit).
 * Renders nothing without a plan limit or when the request fails: no number is ever invented.
 */
export function VendorPlanMeter({ storeId, className = "" }: { storeId: string; className?: string }) {
  const [meter, setMeter] = useState<PlanLimitMeter | null>(null);
  useEffect(() => {
    let alive = true;
    void fetch(`/api/vendor/${encodeURIComponent(storeId)}/subscription`).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { usage?: { products?: number }; entitlement?: { plan?: "BASIC" | "PRO" | null; limits?: { activeProducts?: number } | null } };
      if (alive) setMeter(planLimitMeter({ active: data.usage?.products ?? -1, limit: data.entitlement?.limits?.activeProducts, plan: data.entitlement?.plan }));
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [storeId]);
  if (!meter) return null;
  return <div data-vendor-plan-meter="" className={`rounded-card border px-4 py-3 ${meter.atLimit ? "border-gold-200 bg-[#faf5ec]" : "border-line bg-white"} ${className}`}>
    <div className="flex items-center justify-between gap-3 text-sm">
      <Link href={`/vendor/${storeId}/subscription`} className="font-medium text-fg-secondary hover:text-primary">{meter.label}</Link>
      <b className={meter.atLimit ? "text-gold-700" : "text-fg"}>{meter.value}</b>
    </div>
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-sunken" role="progressbar" aria-label={meter.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={meter.percent}>
      <div className={`h-full rounded-full ${meter.atLimit ? "bg-gold-600" : "bg-primary"}`} style={{ width: `${meter.percent}%` }}/>
    </div>
    {meter.message && <p className="mt-2 text-xs leading-5 text-gold-700">{meter.message}</p>}
  </div>;
}
