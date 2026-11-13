import Link from "next/link";
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
  return <main className="grid min-h-[70vh] place-items-center bg-[#f7f8f6] px-4 py-16 text-center">
    <div className="max-w-md">
      <p className="text-sm font-semibold uppercase tracking-[.18em] text-[#2f6f68]">404</p>
      <h1 className="mt-3 text-3xl font-semibold text-[#173a3a]">Səhifə tapılmadı</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">Axtardığınız səhifə mövcud deyil və ya köçürülüb.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/" className="rounded-full bg-[#173a3a] px-5 py-3 text-sm font-semibold text-white">Ana səhifə</Link>
        <Link href="/products" className="rounded-full border border-[#d7ddd8] px-5 py-3 text-sm font-semibold text-[#173a3a]">Məhsullar</Link>
      </div>
    </div>
  </main>;
}
