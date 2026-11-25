import Link from "next/link";
import { Download } from "lucide-react";
import { ADMIN_POWER_1_TEXT as T, type AdminListExport } from "@/lib/admin-power-1";
import { buttonClass, focusRing } from "@/components/admin-ui/styles";

/**
 * ADMIN-POWER-1: quick-filter chips (existing status labels) and "CSV ixrac et" for the admin lists.
 * Chips are plain links that keep the other filters and drop the page number; the selected chip has aria-current.
 * The export link sends the list's current filters to /api/admin/list-export/<list> (a plain <a>, never prefetched).
 */
type Params = Record<string, string | undefined>;

function hrefWith(path: string, sp: Params, name: string, value: string | null) {
  const params = new URLSearchParams(Object.entries(sp).filter(([key, v]) => key !== "page" && key !== name && Boolean(v)) as [string, string][]);
  if (value) params.set(name, value);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function exportHref(list: AdminListExport, sp: Params) {
  const params = new URLSearchParams(Object.entries(sp).filter(([key, v]) => key !== "page" && Boolean(v)) as [string, string][]);
  const query = params.toString();
  return `/api/admin/list-export/${list}${query ? `?${query}` : ""}`;
}

export function AdminListToolbar({ path, sp, options, selected, name = "status", allValue = null, exportList }: {
  path: string;
  sp: Params;
  options: { id: string; name: string }[];
  /** The value the list is filtered by now ("" = all). */
  selected: string;
  name?: string;
  /** The URL value of "Hamısı" when the list has another default (seller applications: ALL). */
  allValue?: string | null;
  exportList?: AdminListExport;
}) {
  const chips = [{ id: allValue ?? "", name: T.all }, ...options];
  return <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
    <nav aria-label="Status" className="-mx-1 min-w-0 overflow-x-auto px-1 pb-1 lg:overflow-visible">
      <ul className="flex w-max gap-2 lg:w-auto lg:flex-wrap">{chips.map((chip) => {
        const active = chip.id === selected;
        return <li key={chip.id || "all"}><Link
          href={hrefWith(path, sp, name, chip.id || null)}
          aria-current={active ? "page" : undefined}
          className={`inline-flex min-h-9 items-center whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors ${focusRing} ${active ? "border-primary bg-primary text-white" : "border-line bg-white text-fg-secondary hover:border-primary hover:text-fg"}`}
        >{chip.name}</Link></li>;
      })}</ul>
    </nav>
    {exportList && <div className="flex shrink-0 items-center gap-3">
      <span className="text-xs text-fg-muted">{T.exportCap}</span>
      <a href={exportHref(exportList, sp)} className={buttonClass("secondary")}><Download size={16} aria-hidden="true" />{T.exportCsv}</a>
    </div>}
  </div>;
}
