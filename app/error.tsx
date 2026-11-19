"use client";

import { ErrorRecovery } from "@/components/error-recovery";

/**
 * Error boundary for errors that the customer boundary cannot catch, such as a failure in the customer layout itself
 * (header data under load), and for the other route groups (SCALE-FIX-1 A4). Same friendly page, without the header.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorRecovery digest={error.digest} reset={reset} />;
}
