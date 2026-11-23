/**
 * SECURITY-CENTER-DESIGN-1: stacked columns (inline SVG, no chart package), same approach as
 * components/vendor-analytics-charts.tsx: a text title on every segment, a text legend, and a screen-reader table with
 * every value, so nothing relies on colour alone.
 */
export type StackedColumn = { key: string; label: string; segments: Array<{ series: string; value: number }> };

const SERIES_FILLS = ["#1f5d55", "#b08a45", "#5f7c99", "#8a5a83", "#7a8b5a", "#9a3b2e"];
export const seriesFill = (index: number) => SERIES_FILLS[index % SERIES_FILLS.length];

export function StackedColumnChart({ columns, series, title, totalLabel }: { columns: readonly StackedColumn[]; series: readonly string[]; title: string; totalLabel: (column: StackedColumn) => string }) {
  const totals = columns.map((column) => column.segments.reduce((sum, segment) => sum + segment.value, 0));
  const max = Math.max(0, ...totals);
  const width = Math.max(columns.length * 40, 240);
  const height = 150;
  const step = width / Math.max(columns.length, 1);
  const barWidth = Math.min(step * 0.6, 44);
  return <figure className="m-0">
    <div className="flex items-stretch gap-3">
      <div className="flex w-8 shrink-0 flex-col justify-between py-0.5 text-right text-xs text-slate-500" aria-hidden="true"><span>{max}</span><span>0</span></div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-36 w-full min-w-0" role="img" aria-label={title} focusable="false">
        <line x1="0" y1={height - 0.5} x2={width} y2={height - 0.5} stroke="#d8d2c6" strokeWidth="1" vectorEffect="non-scaling-stroke"/>
        {columns.map((column, index) => {
          let y = height;
          const x = index * step + (step - barWidth) / 2;
          return <g key={column.key}>
            {series.map((name, seriesIndex) => {
              const value = column.segments.find((segment) => segment.series === name)?.value ?? 0;
              const h = max > 0 ? (value / max) * (height - 4) : 0;
              if (h <= 0) return null;
              y -= h;
              return <rect key={name} x={x} y={y} width={barWidth} height={h} fill={seriesFill(seriesIndex)}><title>{`${column.label} · ${name}: ${value}`}</title></rect>;
            })}
          </g>;
        })}
      </svg>
    </div>
    <div className="ml-11 mt-2 flex justify-between gap-1 text-xs text-slate-500" aria-hidden="true">
      {columns.map((column) => <span key={column.key} className="min-w-0 flex-1 truncate text-center">{column.label}</span>)}
    </div>
    {series.length > 0 && <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600" aria-hidden="true">
      {series.map((name, index) => <li key={name} className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: seriesFill(index) }}/>{name}</li>)}
    </ul>}
    <table className="sr-only"><caption>{title}</caption><tbody>{columns.map((column) => <tr key={column.key}>
      <th scope="row">{column.label}</th><td>{totalLabel(column)}</td>
      {column.segments.filter((segment) => segment.value > 0).map((segment) => <td key={segment.series}>{`${segment.series}: ${segment.value}`}</td>)}
    </tr>)}</tbody></table>
  </figure>;
}
