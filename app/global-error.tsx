"use client";

import { ErrorRecovery } from "@/components/error-recovery";

/**
 * Last-resort boundary for a failure in the root layout (SCALE-FIX-1 A4). It replaces the whole document, so it
 * renders its own <html> and <body>.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="az">
    <body>
      <ErrorRecovery digest={error.digest} reset={reset} />
    </body>
  </html>;
}
