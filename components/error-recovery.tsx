"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { StatusPage } from "@/components/status-page";

/**
 * Friendly error panel for the error boundaries (SCALE-FIX-1 A4). Replaces Next's bare "Application error" page, for
 * example when the database pool is busy under load (P2024 / P2028). Shows no internal detail: only the error digest,
 * a short code that matches the server log line written by instrumentation.ts (onRequestError), so support can find it.
 * "Yenidən cəhd et" asks the server for the page again (router.refresh) and re-renders the failed segment (reset).
 * DESIGN-T9: shared status layout and buttons (both at least 44 px); `inLayout` inside the site's <main>.
 */
export function ErrorRecovery({ digest, reset, inLayout = false }: { digest?: string; reset: () => void; inLayout?: boolean }) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();
  const retry = () => startRetry(() => {
    router.refresh();
    reset();
  });
  return <StatusPage
    role="alert"
    ariaLive="assertive"
    landmark={!inLayout}
    icon={<RefreshCw size={28} />}
    kicker="Xəta"
    title="Səhifə yüklənmədi"
    actions={<>
      <Button onClick={retry} loading={retrying} loadingLabel="Yüklənir…">{"Yenidən cəhd et"}</Button>
      <ButtonLink href="/" variant="secondary">Ana səhifəyə qayıt</ButtonLink>
    </>}
    footnote={digest && <p className="mt-6 text-xs text-fg-muted">Xəta kodu: <span className="font-mono">{digest}</span></p>}
  >
    Sayt hazırda çox yüklüdür və ya müvəqqəti xəta baş verdi. Bir neçə saniyədən sonra yenidən cəhd edin.
  </StatusPage>;
}
