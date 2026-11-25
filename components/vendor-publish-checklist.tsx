"use client";

import { CheckCircle2, CircleAlert } from "lucide-react";
import { SELLER_PANEL_3_TEXT } from "@/lib/seller-panel-3";

/**
 * SELLER-PANEL-3: live "what is missing to publish" list. Items are the server's own messages (publishChecklist runs
 * getProductPublicationBlockers); `serverBlockers` are the ones a refused publish returned. Informational only: the
 * "Yayımla" button stays as it was and the server still decides.
 */
export function VendorPublishChecklist({ blockers, serverBlockers = [] }: { blockers: string[]; serverBlockers?: string[] }) {
  const items = [...new Set([...serverBlockers, ...blockers])];
  if (!items.length) {
    return <div data-vendor-publish-checklist="ready" aria-live="polite" className="flex items-center gap-2 rounded-card border border-brand-100 bg-primary-subtle px-4 py-3 text-sm font-semibold text-primary">
      <CheckCircle2 size={18} aria-hidden="true" className="shrink-0"/>{SELLER_PANEL_3_TEXT.ready}
    </div>;
  }
  return <div data-vendor-publish-checklist="missing" aria-live="polite" className="rounded-card border border-gold-200 bg-[#faf5ec] px-4 py-3">
    <p className="flex items-center gap-2 text-sm font-semibold text-gold-700"><CircleAlert size={18} aria-hidden="true" className="shrink-0"/>{SELLER_PANEL_3_TEXT.missingHeading}</p>
    <ul className="mt-2 grid gap-1 pl-6 text-sm leading-6 text-fg-body">{items.map((item) => <li key={item} className="list-disc">{item}</li>)}</ul>
  </div>;
}
