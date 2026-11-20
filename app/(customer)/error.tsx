"use client";

import { ErrorRecovery } from "@/components/error-recovery";

/**
 * Error boundary for the customer pages (SCALE-FIX-1 A4): a friendly Azerbaijani page inside the site's header and
 * footer instead of Next's bare "Application error". The server logs the error with its digest (instrumentation.ts).
 */
export default function CustomerError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorRecovery digest={error.digest} reset={reset} inLayout />;
}
