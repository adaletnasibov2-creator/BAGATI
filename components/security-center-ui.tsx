import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Clock, ShieldAlert, XCircle } from "lucide-react";
import SecurityRefresh from "@/components/security-refresh";
import { formatBakuDateTime } from "@/lib/admin-audit-log";
import { INCIDENT_STATUS_LABELS, SEVERITY_LABELS } from "@/lib/security-center-view";
import { CENTER_TEXT, SECURITY_TABS, type SecurityTab } from "@/lib/security-center-status";

/**
 * SECURITY-CENTER-DESIGN-2: the shared look of the security center tabs (existing admin card style). Server
 * components only; the refresh button is the one client piece.
 */

export const card = "rounded-2xl border border-[#e7e3d9] bg-white p-5";
export const linkClass = "text-sm font-medium text-[#85621d] underline";
export const unavailable = <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">Məlumat əlçatan deyil.</p>;
export const empty = (text: string) => <p className="rounded-xl bg-[#f8f7f4] p-3 text-sm text-slate-500">{text}</p>;
/** A calm "nothing to report" state (icon + text, not colour only). */
export const allClear = (text: string) => <p className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900"><CheckCircle2 size={18} aria-hidden="true" className="shrink-0"/>{text}</p>;
export const date = (value: Date | null | undefined) => value ? formatBakuDateTime(value) : "—";
export const Ip = ({ value }: { value: string | null }) => <span className="font-mono text-xs">{value ?? "—"}</span>;

export type Tone = "good" | "warn" | "bad" | "neutral";

/** Status badge: icon + text, never colour alone. */
export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const style = tone === "good" ? "bg-green-50 text-green-900 ring-green-200" : tone === "warn" ? "bg-amber-50 text-amber-900 ring-amber-200" : tone === "bad" ? "bg-red-50 text-red-800 ring-red-200" : "bg-[#f3f1ec] text-slate-600 ring-[#e7e3d9]";
  const Icon = tone === "good" ? CheckCircle2 : tone === "warn" ? AlertTriangle : tone === "bad" ? XCircle : Clock;
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style}`}><Icon size={12} aria-hidden="true"/>{children}</span>;
}

const SEVERITY_TONE: Record<string, Tone> = { CRITICAL: "bad", HIGH: "bad", MEDIUM: "warn", LOW: "neutral" };
const STATUS_TONE: Record<string, Tone> = { OPEN: "warn", ACKNOWLEDGED: "neutral", RESOLVED: "good", FALSE_POSITIVE: "neutral" };
/** Severity and incident status with the existing Azerbaijani labels (never the raw code). */
export const SeverityBadge = ({ severity }: { severity: string }) => <Badge tone={SEVERITY_TONE[severity] ?? "neutral"}>{SEVERITY_LABELS[severity] ?? severity}</Badge>;
export const StatusBadge = ({ status }: { status: string }) => <Badge tone={STATUS_TONE[status] ?? "neutral"}>{INCIDENT_STATUS_LABELS[status] ?? status}</Badge>;

export function Block({ title, note, children, id }: { title: string; note?: string; children: ReactNode; id?: string }) {
  return <section className={`${card} min-w-0`} id={id}>
    <h2 className="font-semibold text-[#0d1b2a]">{title}</h2>
    {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    <div className="mt-3">{children}</div>
  </section>;
}

/**
 * A compact table that turns into small cards below 640 px (each cell shows its column name from data-label), so no
 * page scrolls sideways on a phone. Keys are given by the caller and must never contain an IP (they end up in the
 * page's embedded data).
 */
export function RowTable({ head, rows }: { head: readonly string[]; rows: ReadonlyArray<{ key: string; cells: ReactNode[] }> }) {
  return <div className="sm:overflow-x-auto" data-row-table="">
    <table className="w-full text-left text-sm max-sm:block sm:min-w-[480px]">
      <thead className="bg-[#f8f7f4] text-xs text-slate-500 max-sm:hidden"><tr>{head.map((title) => <th key={title} className="px-3 py-2 font-medium">{title}</th>)}</tr></thead>
      <tbody className="divide-y divide-[#eeeae2] max-sm:block max-sm:space-y-2 max-sm:divide-y-0">
        {rows.map((row) => <tr key={row.key} className="max-sm:block max-sm:rounded-xl max-sm:border max-sm:border-[#eeeae2] max-sm:px-3 max-sm:py-2">
          {row.cells.map((cell, index) => <td key={head[index] ?? index} data-label={head[index]}
            className="px-3 py-2 align-top max-sm:flex max-sm:min-w-0 max-sm:items-start max-sm:justify-between max-sm:gap-3 max-sm:break-words max-sm:px-0 max-sm:py-1 max-sm:text-right max-sm:before:shrink-0 max-sm:before:text-left max-sm:before:text-xs max-sm:before:text-slate-500 max-sm:before:content-[attr(data-label)]">{cell}</td>)}
        </tr>)}
      </tbody>
    </table>
  </div>;
}

/** Shows the first `limit` rows; the rest open below "Daha çox göstər (n)" (no script). */
export function LimitedRows({ head, rows, limit, more }: { head: readonly string[]; rows: ReadonlyArray<{ key: string; cells: ReactNode[] }>; limit: number; more: (n: number) => string }) {
  return <>
    <RowTable head={head} rows={rows.slice(0, limit)}/>
    {rows.length > limit && <details className="mt-3"><summary className={`cursor-pointer ${linkClass}`}>{more(rows.length - limit)}</summary>
      <div className="mt-3"><RowTable head={head} rows={rows.slice(limit)}/></div>
    </details>}
  </>;
}

/** Title, tabs and the refresh controls, the same on every tab. `actions` holds the page's own buttons (full-IP reveal). */
export function SecurityCenterHeader({ active, renderedAt, actions, fullIp = false }: { active: SecurityTab; renderedAt: string; actions?: ReactNode; fullIp?: boolean }) {
  return <div className="mb-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-[#9b7840]">BAGATI · ADMIN</p>
        <h1 className="mt-2 flex items-center gap-2 text-3xl font-semibold text-[#0d1b2a]"><ShieldAlert size={26} aria-hidden="true" className="shrink-0 text-[#85621d]"/>Təhlükəsizlik mərkəzi</h1>
        <p className="mt-2 text-sm text-slate-500">{CENTER_TEXT.subtitle}</p>
      </div>
      <div className="flex flex-wrap items-start gap-3">{actions}<SecurityRefresh renderedAt={renderedAt} fullIp={fullIp}/></div>
    </div>
    <nav aria-label="Təhlükəsizlik mərkəzi bölmələri" className="mt-4 overflow-x-auto border-b border-[#e7e3d9]" data-security-tabs="">
      <ul className="flex min-w-max gap-1">
        {SECURITY_TABS.map((tab) => <li key={tab.id}>
          <Link href={tab.href} prefetch={false} aria-current={active === tab.id ? "page" : undefined}
            className={`-mb-px flex min-h-11 items-center border-b-2 px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#173c40] ${active === tab.id ? "border-[#173c40] font-semibold text-[#0d1b2a]" : "border-transparent text-slate-500 hover:text-[#0d1b2a]"}`}>{tab.label}</Link>
        </li>)}
      </ul>
    </nav>
  </div>;
}

/** The audited full-IP reveal: a GET form (never prefetched), as on the SECURITY-PAGE-1 summary. */
export function FullIpToggle({ action, full }: { action: string; full: boolean }) {
  return full
    ? <Link href={action} prefetch={false} className="inline-flex min-h-11 items-center rounded-xl border border-[#c7ad78] bg-white px-4 text-sm font-semibold text-[#85621d]">IP-ləri gizlət</Link>
    : <form method="get" action={action}><input type="hidden" name="ip" value="full" /><button className="min-h-11 rounded-xl border border-[#c7ad78] bg-white px-4 text-sm font-semibold text-[#85621d]">Tam IP-ləri göstər</button></form>;
}

/** The messages around the reveal (existing texts). */
export function FullIpNotice({ wanted, full }: { wanted: boolean; full: boolean }) {
  if (wanted && !full) return <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">Tam IP-lərə baxış audit jurnalına yazıla bilmədi; IP-lər maskalı qalır.</p>;
  if (full) return <p role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Tam IP-lər göstərilir. Bu baxış audit jurnalına yazıldı. Tam IP 30 gün saxlanılır, sonra yalnız maskalı forma qalır.</p>;
  return null;
}
