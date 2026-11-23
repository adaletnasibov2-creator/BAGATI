import { barPercent } from "@/lib/vendor-sales-analytics";

/**
 * SELLER-ANALYTICS-1: small hand-built charts (inline SVG / CSS, no chart package). Accessible: every bar has a text
 * label; the column chart also has a screen-reader table with every value, so nothing relies on colour alone.
 */

export type ColumnDatum = { key: string; value: number; label: string };

/** Vertical columns over time. `label` is the full text of one column (period, count, money). */
export function ColumnChart({ data, title, axisLabel }: { data: readonly ColumnDatum[]; title: string; axisLabel: (value: number) => string }) {
  const max = Math.max(0, ...data.map((d) => d.value));
  const width = Math.max(data.length * 12, 240);
  const height = 160;
  const gap = data.length > 60 ? 1 : 3;
  const step = width / Math.max(data.length, 1);
  const ticks = data.length > 1 ? [data[0], data[Math.floor((data.length - 1) / 2)], data[data.length - 1]] : data;
  return <figure className="m-0">
    <div className="flex items-stretch gap-3">
      <div className="flex w-20 shrink-0 flex-col justify-between py-0.5 text-right text-xs text-fg-muted" aria-hidden="true">
        <span>{axisLabel(max)}</span><span>{axisLabel(0)}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-40 w-full min-w-0 overflow-visible" role="img" aria-label={title} focusable="false">
        <line x1="0" y1={height - 0.5} x2={width} y2={height - 0.5} stroke="#d8d2c6" strokeWidth="1" vectorEffect="non-scaling-stroke"/>
        <line x1="0" y1="0.5" x2={width} y2="0.5" stroke="#eeeae2" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke"/>
        {data.map((d, index) => {
          const h = max > 0 ? (d.value / max) * (height - 4) : 0;
          return <rect key={d.key} x={index * step + gap / 2} y={height - h} width={Math.max(step - gap, 1)} height={h} rx={step > 8 ? 2 : 0} className="fill-[#1f5d55]">
            <title>{d.label}</title>
          </rect>;
        })}
      </svg>
    </div>
    <div className="ml-[5.75rem] mt-2 flex justify-between gap-2 text-xs text-fg-muted" aria-hidden="true">
      {ticks.map((d, index) => <span key={`${d.key}-${index}`} className="min-w-0 truncate">{d.key}</span>)}
    </div>
    <table className="sr-only"><caption>{title}</caption><tbody>{data.map((d) => <tr key={d.key}><td>{d.label}</td></tr>)}</tbody></table>
  </figure>;
}

export type BarDatum = { key: string; label: string; value: number; valueText: string; detail?: string };

/** Horizontal bars with the label and the value written out (the bar only repeats the number visually). */
export function BarList({ data }: { data: readonly BarDatum[] }) {
  const max = Math.max(0, ...data.map((d) => d.value));
  return <ul className="mt-3 space-y-3">
    {data.map((d) => <li key={d.key}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 break-words text-fg">{d.label}{d.detail && <span className="text-fg-muted"> · {d.detail}</span>}</span>
        <b className="shrink-0 font-semibold text-fg">{d.valueText}</b>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-[#f1ede5]" aria-hidden="true">
        <div className="h-2 rounded-full bg-[#1f5d55]" style={{ width: `${barPercent(d.value, max)}%` }}/>
      </div>
    </li>)}
  </ul>;
}
