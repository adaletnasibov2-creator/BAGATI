import { formatContentDateTime } from "@/lib/content-pages";
import type { MaintenanceCheck } from "@/lib/maintenance-state";

/**
 * "Texniki iş" tab: whether the middleware can actually read the maintenance state (if it cannot, maintenance is not
 * enforced: the check fails open). The result comes from the middleware itself (lib/maintenance-state.ts) for this
 * request; times are formatted on the server in Baku time.
 */
export function AdminMaintenanceCheck({ check }: { check: MaintenanceCheck | null }) {
  const source = check?.source === "internal" ? "daxili ünvan (BAGATI_INTERNAL_ORIGIN)" : "sorğunun ünvanı";
  if (!check) {
    return <p data-maintenance-check="unknown" className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">Yoxlama nəticəsi hələ yoxdur. Səhifəni yeniləyin.</p>;
  }
  if (check.ok) {
    return <p data-maintenance-check="ok" role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
      <b>Yoxlama işləyir.</b> Texniki iş rejimi açılanda sayt dərhal (ən çox 10 saniyəyə) bağlanacaq.
      <span className="mt-1 block text-xs text-emerald-800">Son yoxlama: {formatContentDateTime(new Date(check.at))} · mənbə: {source}</span>
    </p>;
  }
  return <div data-maintenance-check="failed" role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
    <b>Yoxlama işləmir: {check.reason}</b>
    <p className="mt-1">Texniki iş rejimi yadda saxlanılsa da sayt <b>bağlanmayacaq</b> (sayt işlək qalsın deyə yoxlama açıq buraxılır).{check.source === "request" ? " Serverdə BAGATI_INTERNAL_ORIGIN dəyişənini Node portuna (məs. http://127.0.0.1:3000) təyin edin." : " BAGATI_INTERNAL_ORIGIN ünvanını və Node prosesini yoxlayın."}</p>
    <span className="mt-1 block text-xs text-red-800">Son yoxlama: {formatContentDateTime(new Date(check.at))} · mənbə: {source}</span>
  </div>;
}
