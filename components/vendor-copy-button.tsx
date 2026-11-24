"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { copyToClipboard } from "@/lib/clipboard";

/**
 * Seller "copy" button (SELLER-CUSTOMER-CARD-1): copies `value`, then says so for 4 s in a polite live region.
 * If the browser refuses, the value is shown in a read-only box with the existing manual-copy wording.
 */
export function VendorCopyButton({ value, label, done, className }: { value: string; label: string; done: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state !== "copied") return;
    const timer = window.setTimeout(() => setState("idle"), 4000);
    return () => window.clearTimeout(timer);
  }, [state]);
  return <div className={cx("min-w-0", className)}>
    <button type="button" onClick={() => void copyToClipboard(value).then((ok) => setState(ok ? "copied" : "failed"))} className={cx(buttonClass({ variant: "secondary", size: "sm" }), "w-full sm:w-auto")}>
      {state === "copied" ? <Check aria-hidden="true" size={16} strokeWidth={2}/> : <Copy aria-hidden="true" size={16} strokeWidth={2}/>}{label}
    </button>
    <p role="status" className="mt-1 text-xs font-medium text-primary">{state === "copied" ? done : ""}</p>
    {state === "failed" && <div className="mt-1 text-xs text-gold-700">Avtomatik kopyalamaq alınmadı. Mətni seçib kopyalayın:<textarea readOnly value={value} rows={2} className="mt-1 w-full rounded-control border border-line p-2 text-xs text-fg-body"/></div>}
  </div>;
}
