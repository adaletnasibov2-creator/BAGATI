"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useConfirmDialog } from "@/components/admin-ui/confirm-dialog";
import { ResultMessage } from "@/components/admin-ui/result-message";
import { buttonClass, inputClass } from "@/components/admin-ui/styles";

type MoveProduct = { id: string; name: string; sku: string | null; status: string; store: string; version: string };
type TargetGroup = { id: string; name: string; options: { id: string; name: string }[] };

/** Select products (this page = max 100) and move them to one subcategory, with confirmation. */
export default function AdminCategoryProductMove({ fromCategoryId, groups, products }: { fromCategoryId: string; groups: TargetGroup[]; products: MoveProduct[] }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirmDialog();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState(groups[0]?.options[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const targetId = useId();
  const all = products.length > 0 && selected.size === products.length;
  const targetName = groups.flatMap((group) => group.options.map((option) => ({ ...option, parent: group.name }))).find((option) => option.id === target);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function move() {
    if (!selected.size || !target || !targetName) return;
    const ok = await confirm({ title: "Məhsulları köçür", message: `${selected.size} məhsul “${targetName.parent} › ${targetName.name}” alt kateqoriyasına köçürülsün? Məhsulların başqa heç bir məlumatı dəyişmir.`, confirmLabel: "Köçür" });
    if (!ok) return;
    setBusy(true);
    setFeedback(null);
    const items = products.filter((product) => selected.has(product.id)).map((product) => ({ id: product.id, version: product.version }));
    const response = await fetch("/api/admin/category-tree/move-products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fromCategoryId, toCategoryId: target, items }) });
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    if (response.ok) {
      setFeedback({ tone: "success", text: `${result.item?.moved ?? items.length} məhsul köçürüldü.` });
      setSelected(new Set());
      router.refresh();
    } else {
      setFeedback({ tone: "error", text: result.error || "Köçürmə alınmadı." });
      if (response.status === 409) router.refresh();
    }
  }

  if (!groups.length) return <ResultMessage tone="info">Köçürmək üçün aktiv alt kateqoriya yoxdur. Əvvəlcə alt kateqoriya yaradın.</ResultMessage>;
  return (
    <div className="grid gap-4">
      <div className="sticky top-0 z-10 flex flex-wrap items-end gap-3 rounded-2xl border border-[#e7e3d9] bg-white p-4">
        <label htmlFor={targetId} className="grid min-w-0 flex-1 gap-1 text-sm">Hədəf alt kateqoriya
          <select id={targetId} value={target} onChange={(event) => setTarget(event.target.value)} className={inputClass}>
            {groups.map((group) => <optgroup key={group.id} label={group.name}>{group.options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</optgroup>)}
          </select>
        </label>
        <button type="button" disabled={busy || !selected.size || !target} onClick={() => void move()} className={buttonClass("primary")}>{busy ? "Köçürülür…" : `Köçür (${selected.size})`}</button>
      </div>
      {feedback && <ResultMessage tone={feedback.tone}>{feedback.text}</ResultMessage>}
      <div className="overflow-x-auto rounded-2xl border border-[#e7e3d9] bg-white">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-[#f8f7f4] text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-12 px-4 py-3"><input type="checkbox" aria-label="Hamısını seç" checked={all} onChange={() => setSelected(all ? new Set() : new Set(products.map((product) => product.id)))} className="h-4 w-4" /></th>
              <th className="px-4 py-3 font-medium">Məhsul</th>
              <th className="px-4 py-3 font-medium">Mağaza</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#eeeae2]">
            {products.map((product) => (
              <tr key={product.id} className={selected.has(product.id) ? "bg-[#f6faf7]" : undefined}>
                <td className="px-4 py-3"><input type="checkbox" aria-label={`${product.name} seç`} checked={selected.has(product.id)} onChange={() => toggle(product.id)} className="h-4 w-4" /></td>
                <td className="px-4 py-3"><span className="font-medium text-[#0d1b2a]">{product.name}</span>{product.sku && <span className="block text-xs text-slate-500">{product.sku}</span>}</td>
                <td className="px-4 py-3">{product.store}</td>
                <td className="px-4 py-3">{product.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dialog}
    </div>
  );
}
