"use client";

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { ANNOUNCEMENT_DISMISS_KEY, ANNOUNCEMENT_TONE_CLASSES, type AnnouncementView } from "@/lib/announcement";

/**
 * The visible bar with its dismiss button. Text is plain text (React escapes it). The dismissal is remembered for this
 * browser session and this signature only; storage errors (private mode, blocked storage) are ignored.
 */
export default function AnnouncementBarClient({ bar, signature }: { bar: AnnouncementView; signature: string }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  function dismiss() {
    try { sessionStorage.setItem(ANNOUNCEMENT_DISMISS_KEY, signature); } catch { /* storage unavailable: hide for this page view only */ }
    setDismissed(true);
  }
  const external = bar.href?.startsWith("https://");
  const text = bar.href
    ? external
      ? <a href={bar.href} className="underline underline-offset-2" rel="noopener noreferrer">{bar.text}</a>
      : <Link href={bar.href} className="underline underline-offset-2">{bar.text}</Link>
    : bar.text;
  return <div className={`${ANNOUNCEMENT_TONE_CLASSES[bar.tone]} text-sm`}>
    <div className="container flex min-h-10 items-center gap-3 py-2">
      <p className="min-w-0 flex-1 break-words text-center font-medium leading-5">{text}</p>
      <button type="button" onClick={dismiss} aria-label="Elanı bağla" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-black/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-current">
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  </div>;
}
