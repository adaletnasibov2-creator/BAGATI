"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * Friendly error panel for the error boundaries (SCALE-FIX-1 A4). Replaces Next's bare "Application error" page, for
 * example when the database pool is busy under load (P2024 / P2028). Shows no internal detail: only the error digest,
 * a short code that matches the server log line written by instrumentation.ts (onRequestError), so support can find it.
 * "Yenidən cəhd et" asks the server for the page again (router.refresh) and re-renders the failed segment (reset).
 */
export function ErrorRecovery({ digest, reset }: { digest?: string; reset: () => void }) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();
  const retry = () => startRetry(() => {
    router.refresh();
    reset();
  });
  return <main className="grid min-h-[60vh] place-items-center bg-[#f7f8f6] px-4 py-16 text-center" role="alert" aria-live="assertive">
    <div className="max-w-md">
      <p className="text-sm font-semibold uppercase tracking-[.18em] text-[#2f6f68]">Xəta</p>
      <h1 className="mt-3 text-3xl font-semibold text-[#173a3a]">Səhifə yüklənmədi</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        Sayt hazırda çox yüklüdür və ya müvəqqəti xəta baş verdi. Bir neçə saniyədən sonra yenidən cəhd edin.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={retry} disabled={retrying} className="min-h-11 rounded-full bg-[#173a3a] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">
          {retrying ? "Yüklənir…" : "Yenidən cəhd et"}
        </button>
        <Link href="/" className="min-h-11 rounded-full border border-[#d7ddd8] px-5 py-3 text-sm font-semibold text-[#173a3a]">Ana səhifəyə qayıt</Link>
      </div>
      {digest && <p className="mt-6 text-xs text-slate-500">Xəta kodu: <span className="font-mono">{digest}</span></p>}
    </div>
  </main>;
}
