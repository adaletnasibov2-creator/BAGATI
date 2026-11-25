import type { ReactNode } from "react";
import { EmptyState } from "@/components/admin-ui/empty-state";

export type DataColumn<Row> = {
  label: string;
  cell: (row: Row) => ReactNode;
  /** Right-align (numbers, money). */
  numeric?: boolean;
};

/**
 * Responsive table. One DOM for both layouts (no duplicated forms or ids): a normal table from 768 px; below that,
 * each row becomes a stacked card and every cell shows its column label (data-label) before the value.
 */
export function DataTable<Row>({ columns, rows, rowKey, empty = "Qeyd yoxdur.", emptyDescription, caption }: {
  columns: DataColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
  empty?: ReactNode;
  emptyDescription?: ReactNode;
  caption?: string;
}) {
  if (!rows.length) return <EmptyState title={empty} description={emptyDescription} />;
  // ADMIN-DESIGN-1: seller-panel table look (line borders, 20 px card, soft header, row hover). From 768 px a wide
  // table scrolls inside its own box, so the page itself never scrolls sideways.
  return <div className="md:overflow-x-auto md:rounded-card md:border md:border-line md:bg-white md:shadow-subtle">
    <table className="w-full text-left text-sm text-fg-body max-md:block md:min-w-[720px]">
      {caption && <caption className="sr-only">{caption}</caption>}
      <thead className="border-b border-line bg-surface-page text-xs uppercase tracking-wide text-fg-secondary max-md:hidden">
        <tr>{columns.map((column) => <th key={column.label} scope="col" className={`whitespace-nowrap px-4 py-3 font-semibold${column.numeric ? " text-right" : ""}`}>{column.label}</th>)}</tr>
      </thead>
      <tbody className="max-md:block max-md:space-y-3 md:divide-y md:divide-line">
        {rows.map((row, index) => <tr key={rowKey(row, index)} className="align-top transition-colors md:hover:bg-surface-page max-md:block max-md:rounded-card max-md:border max-md:border-line max-md:bg-white max-md:p-4 max-md:shadow-subtle motion-reduce:transition-none">
          {columns.map((column) => <td key={column.label} data-label={column.label} className={`px-4 py-3.5 max-md:flex max-md:min-w-0 max-md:items-start max-md:justify-between max-md:gap-4 max-md:border-b max-md:border-line max-md:px-0 max-md:py-2 max-md:text-right max-md:last:border-b-0 max-md:before:shrink-0 max-md:before:text-left max-md:before:text-xs max-md:before:font-medium max-md:before:uppercase max-md:before:tracking-wide max-md:before:text-fg-secondary max-md:before:content-[attr(data-label)]${column.numeric ? " md:text-right md:tabular-nums" : ""}`}><div className="min-w-0 max-md:break-words">{column.cell(row)}</div></td>)}
        </tr>)}
      </tbody>
    </table>
  </div>;
}
