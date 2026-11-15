"use client";

import { useMemo, useState } from "react";
import { Check, ChevronLeft } from "lucide-react";
import { CategoryGlyph, CategoryIcon } from "@/components/category-icon";
import { buildCategoryTree, type CategoryRow } from "@/lib/category-tree";

export type PickerCategory = Pick<CategoryRow, "id" | "name" | "slug" | "parentId" | "sortOrder"> & Partial<Pick<CategoryRow, "iconKey" | "imageUrl" | "isActive">>;

/**
 * Two-step category picker for the seller and admin product forms (üst -> alt), with icons, mobile friendly.
 * - A top-level without subcategories is selected directly.
 * - A top-level with subcategories needs a subcategory for new products, or when the category is changed.
 * - An existing product saved on such a top-level keeps it (`initialId`) until the seller picks something else.
 * Renders hidden inputs `categoryId` and `categoryParentId` when `name` is given (FormData forms).
 */
export function CategoryPicker({
  categories,
  initialId = null,
  onChange,
  name,
  label = "Kateqoriya",
}: {
  categories: PickerCategory[];
  initialId?: string | null;
  onChange?: (value: { categoryId: string | null; parentId: string | null; name: string }) => void;
  name?: boolean;
  label?: string;
}) {
  const rows = useMemo(() => categories.map((category) => ({ isActive: true, iconKey: null, imageUrl: null, ...category })), [categories]);
  const tree = useMemo(() => buildCategoryTree(rows), [rows]);
  const initial = rows.find((row) => row.id === initialId) ?? null;
  const [topId, setTopId] = useState<string | null>(initial ? initial.parentId ?? initial.id : null);
  const [valueId, setValueId] = useState<string | null>(initial?.id ?? null);
  const top = tree.find((node) => node.id === topId) ?? null;
  const value = rows.find((row) => row.id === valueId) ?? null;
  const keptLegacyTop = Boolean(value && value.id === initialId && value.parentId === null && top?.children.length);

  function choose(categoryId: string | null, parentId: string | null) {
    setValueId(categoryId);
    const chosen = rows.find((row) => row.id === categoryId);
    onChange?.({ categoryId, parentId, name: chosen?.name ?? "" });
  }

  function pickTop(id: string) {
    const node = tree.find((item) => item.id === id);
    setTopId(id);
    if (!node) return;
    if (!node.children.length) choose(node.id, null);
    else if (initial && initial.id === node.id) choose(node.id, null); // the old product's own top-level stays selectable
    else choose(null, node.id);
  }

  const button = "flex min-h-12 min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#173c40]";
  return (
    <fieldset className="grid min-w-0 gap-2 text-sm sm:col-span-2">
      <legend className="mb-1">{label}</legend>
      {name && <><input type="hidden" name="categoryId" value={valueId ?? ""} /><input type="hidden" name="categoryParentId" value={value?.parentId ?? ""} /></>}
      {!top || !top.children.length ? (
        <div role="group" aria-label="Üst kateqoriya" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {tree.map((node) => {
            const selected = node.id === topId;
            return (
              <button key={node.id} type="button" aria-pressed={selected} onClick={() => pickTop(node.id)} className={`${button} ${selected ? "border-[#173c40] bg-[#f1f6f3] font-semibold" : "border-[#ded9cf] bg-white hover:bg-[#f8f7f4]"}`}>
                <CategoryIcon category={node} size="small" className="!h-8 !w-8 !rounded-lg" />
                <span className="min-w-0 flex-1 truncate">{node.name}</span>
                {node.children.length > 0 && <span className="shrink-0 text-xs text-slate-500">{node.children.length}</span>}
                {selected && <Check aria-hidden="true" size={16} className="shrink-0 text-[#173c40]" />}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-2 rounded-2xl border border-[#e7e3d9] bg-[#fbfaf7] p-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <button type="button" onClick={() => { setTopId(null); if (!keptLegacyTop) choose(null, null); }} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm text-[#173c40] hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#173c40]">
              <ChevronLeft aria-hidden="true" size={16} />Üst kateqoriyalar
            </button>
            <span className="inline-flex min-w-0 items-center gap-2 font-semibold"><CategoryIcon category={top} size="small" className="!h-7 !w-7 !rounded-lg" /><span className="truncate">{top.name}</span></span>
          </div>
          <div role="group" aria-label={`${top.name}: alt kateqoriya`} className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 lg:grid-cols-3">
            {top.children.map((child) => {
              const selected = child.id === valueId;
              return (
                <button key={child.id} type="button" aria-pressed={selected} onClick={() => choose(child.id, top.id)} className={`${button} ${selected ? "border-[#173c40] bg-white font-semibold" : "border-[#ded9cf] bg-white hover:bg-[#f8f7f4]"}`}>
                  <CategoryGlyph category={{ ...child, parentIconKey: top.iconKey }} size={18} className="text-[#1f5a4f]" />
                  <span className="min-w-0 flex-1 truncate">{child.name}</span>
                  {selected && <Check aria-hidden="true" size={16} className="shrink-0 text-[#173c40]" />}
                </button>
              );
            })}
          </div>
          {keptLegacyTop ? (
            <p className="rounded-xl bg-amber-50 p-2.5 text-xs leading-5 text-amber-900">Bu məhsul alt kateqoriyasız saxlanılıb və belə qala bilər. Alıcıların tapması üçün alt kateqoriya seçmək tövsiyə olunur.</p>
          ) : !value ? (
            <p role="status" className="text-xs text-amber-800">Alt kateqoriya seçin.</p>
          ) : null}
        </div>
      )}
      <p className="text-xs text-slate-500" aria-live="polite">Seçilib: {value ? (value.parentId ? `${rows.find((row) => row.id === value.parentId)?.name ?? ""} › ${value.name}` : value.name) : "—"}</p>
    </fieldset>
  );
}
