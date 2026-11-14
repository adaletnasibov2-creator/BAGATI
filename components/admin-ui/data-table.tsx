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
  return <div className="md:overflow-x-auto md:rounded-2xl md:border md:border-[#e7e3d9] md:bg-white">
    <table className="w-full text-left text-sm max-md:block md:min-w-[720px]">
      {caption && <caption className="sr-only">{caption}</caption>}
      <thead className="bg-[#f8f7f4] text-xs uppercase tracking-wide text-slate-500 max-md:hidden">
        <tr>{columns.map((column) => <th key={column.label} scope="col" className={`px-4 py-3 font-medium${column.numeric ? " text-right" : ""}`}>{column.label}</th>)}</tr>
      </thead>
      <tbody className="max-md:block max-md:space-y-3 md:divide-y md:divide-[#eeeae2]">
        {rows.map((row, index) => <tr key={rowKey(row, index)} className="align-top max-md:block max-md:rounded-2xl max-md:border max-md:border-[#e7e3d9] max-md:bg-white max-md:p-4">
          {columns.map((column) => <td key={column.label} data-label={column.label} className={`px-4 py-3.5 max-md:flex max-md:min-w-0 max-md:items-start max-md:justify-between max-md:gap-4 max-md:px-0 max-md:py-1.5 max-md:text-right max-md:before:shrink-0 max-md:before:text-left max-md:before:text-xs max-md:before:font-medium max-md:before:uppercase max-md:before:tracking-wide max-md:before:text-slate-500 max-md:before:content-[attr(data-label)]${column.numeric ? " md:text-right" : ""}`}><div className="min-w-0 max-md:break-words">{column.cell(row)}</div></td>)}
        </tr>)}
      </tbody>
    </table>
  </div>;
}
