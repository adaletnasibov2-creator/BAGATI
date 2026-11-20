import { SearchX } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { StatusPage } from "@/components/status-page";
import { PublicTheme } from "@/components/public-theme";
import { headers } from "next/headers";
import { securityTelemetry } from "@/lib/security-monitoring/instance";
import { notFoundGroup } from "@/lib/security-monitoring/telemetry";

export const metadata = { title: "Səhifə tapılmadı", robots: { index: false, follow: false } };

/**
 * 404 page. Counts the request for the Security Center by path class only (php, wp, secrets, admin-probe, api,
 * other); the path itself is never stored. Telemetry never affects the page.
 */
export default async function NotFound() {
  try {
    const list = await headers();
    securityTelemetry.recordResponse(notFoundGroup(list.get("x-bagati-pathname")), 404, 0);
  } catch { /* telemetry never affects the page */ }
  // DESIGN-T9: shared status layout and buttons, public fonts; texts and links unchanged.
  return <PublicTheme><StatusPage
    icon={<SearchX size={28} />}
    kicker="404"
    title="Səhifə tapılmadı"
    actions={<>
      <ButtonLink href="/">Ana səhifə</ButtonLink>
      <ButtonLink href="/products" variant="secondary">Məhsullar</ButtonLink>
    </>}
  >
    Axtardığınız səhifə mövcud deyil və ya köçürülüb.
  </StatusPage></PublicTheme>;
}
