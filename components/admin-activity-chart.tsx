import type { DailyActivity } from "@/lib/admin-power-1";
import { ADMIN_POWER_1_TEXT as T, shortBakuDate } from "@/lib/admin-power-1";

/**
 * ADMIN-POWER-1: "Son 30 gün" — orders and new stores per Baku day, as two small bar rows (different scales, so two
 * rows with their own zero baseline, never one shared axis). Inline SVG, no package. Accessible: the SVG has a
 * <title> and <desc>, every day has a hover tooltip (<title> on a full-height hit area), and the same numbers are in a
 * table for screen readers. Text is HTML (does not scale with the SVG).
 */
const ROW = 76; // bar area height (px)
const ROWS = [
  { key: "orders" as const, label: T.chartOrders, top: 24, fill: "var(--bagati-primary)" },
  { key: "stores" as const, label: T.chartStores, top: 140, fill: "var(--bagati-gold-600)" },
];
const HEIGHT = 224;

export function AdminActivityChart({ days }: { days: DailyActivity[] }) {
  const slot = 300 / Math.max(days.length, 1);
  const totals = { orders: days.reduce((sum, d) => sum + d.orders, 0), stores: days.reduce((sum, d) => sum + d.stores, 0) };
  const max = { orders: Math.max(1, ...days.map((d) => d.orders)), stores: Math.max(1, ...days.map((d) => d.stores)) };
  const middle = days[Math.floor(days.length / 2)];
  return <section aria-labelledby="admin-activity-title" className="rounded-card border border-line bg-white p-5 shadow-subtle">
    <h2 id="admin-activity-title" className="text-h3 text-fg">{T.chartTitle}</h2>
    <div className="relative mt-4" style={{ height: HEIGHT }}>
      <svg viewBox={`0 0 300 ${HEIGHT}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" role="img" aria-labelledby="admin-activity-svg-title admin-activity-svg-desc">
        <title id="admin-activity-svg-title">{T.chartSvgTitle}</title>
        <desc id="admin-activity-svg-desc">{T.chartSvgDesc}</desc>
        {ROWS.map((row) => <g key={row.key}>
          <line x1="0" x2="300" y1={row.top} y2={row.top} stroke="var(--bagati-border)" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray="3 3" />
          <line x1="0" x2="300" y1={row.top + ROW} y2={row.top + ROW} stroke="var(--bagati-border-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {days.map((day, index) => {
            const value = day[row.key];
            const height = value ? Math.max(2, (value / max[row.key]) * ROW) : 0;
            return <g key={day.day}>
              {height > 0 && <rect x={index * slot + slot * 0.18} width={slot * 0.64} y={row.top + ROW - height} height={height} fill={row.fill} />}
              <rect x={index * slot} width={slot} y={row.top} height={ROW} fill="transparent"><title>{`${shortBakuDate(day.day)} · ${row.label}: ${value}`}</title></rect>
            </g>;
          })}
        </g>)}
      </svg>
      {ROWS.map((row) => <div key={row.key} aria-hidden="true" className="pointer-events-none absolute inset-x-0 flex items-baseline justify-between text-xs" style={{ top: row.top - 22 }}>
        <span className="font-semibold text-fg">{row.label} <span className="font-normal tabular-nums text-fg-secondary">· {totals[row.key]}</span></span>
        <span className="tabular-nums text-fg-muted">{max[row.key]}</span>
      </div>)}
    </div>
    {days.length > 0 && <div aria-hidden="true" className="mt-1 flex justify-between text-xs tabular-nums text-fg-muted">
      <span>{shortBakuDate(days[0].day)}</span><span>{shortBakuDate(middle.day)}</span><span>{shortBakuDate(days[days.length - 1].day)}</span>
    </div>}
    <table className="sr-only">
      <caption>{T.chartTitle}</caption>
      <thead><tr><th scope="col">{T.chartDate}</th><th scope="col">{T.chartOrders}</th><th scope="col">{T.chartStores}</th></tr></thead>
      <tbody>{days.map((day) => <tr key={day.day}><th scope="row">{shortBakuDate(day.day)}</th><td>{day.orders}</td><td>{day.stores}</td></tr>)}</tbody>
    </table>
  </section>;
}
