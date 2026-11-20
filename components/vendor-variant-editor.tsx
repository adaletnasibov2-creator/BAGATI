"use client";

import { useMemo, useState, type ReactNode } from "react";
import VendorImageUploader from "@/components/vendor-image-uploader";
import { presentStockQuantity } from "@/lib/stock-quantity";
import { suggestedVariantAttributes, suggestedVariantValues } from "@/lib/vendor-variant-suggestions";
import { VendorFormSection, vendorCheckbox, vendorHint, vendorInput, vendorLabel } from "@/components/vendor-form";
import { buttonClass } from "@/components/ui/button";

type Axis = { id: string; name: string; values: string[]; customValue: string };
type Row = { id?: string; name: string; sku: string; options: Record<string, string>; isActive: boolean; price: string; discountPrice: string; images: string[]; quantity: string; threshold: string };
const input = vendorInput;
const normalize = (value: string) => value.trim().normalize("NFKC").toLocaleLowerCase("az-AZ");
const combination = (options: Record<string, string>) => JSON.stringify(Object.entries(options).map(([key, value]) => [normalize(key), normalize(value)]).sort(([a], [b]) => String(a).localeCompare(String(b), "az-AZ")));
const blankRow = (options: Record<string, string>): Row => ({ name: Object.values(options).join(" / "), sku: "", options, isActive: true, price: "", discountPrice: "", images: [], quantity: "0", threshold: "5" });

function objectOptions(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item ?? "").trim()]).filter(([key, item]) => key && item));
}

/** `error`: an inline message from the form (for example "create the combinations first"), shown inside this block. */
export default function VendorVariantEditor({ initial, storeId, name = "variants", categoryName = "", error }: { initial: any[]; storeId: string; name?: string; categoryName?: string; error?: ReactNode }) {
  const initialRows = useMemo<Row[]>(() => initial.map(variant => ({
    id: variant.id, name: variant.name, sku: variant.sku || "", options: objectOptions(variant.options), isActive: variant.isActive !== false,
    price: variant.price == null ? "" : String(variant.price), discountPrice: variant.discountPrice == null ? "" : String(variant.discountPrice), images: variant.images || [],
    quantity: String(variant.inventory?.[0]?.quantity ?? 0), threshold: String(variant.inventory?.[0]?.lowStockThreshold ?? 5),
  })), [initial]);
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [axes, setAxes] = useState<Axis[]>(() => {
    const values = new Map<string, Set<string>>();
    for (const row of initialRows) for (const [key, value] of Object.entries(row.options)) { if (!values.has(key)) values.set(key, new Set()); values.get(key)!.add(value); }
    if (!values.size && initialRows.length) values.set("Seçim", new Set(initialRows.map(row => row.name)));
    return [...values].map(([axis, options]) => ({ id: crypto.randomUUID(), name: axis, values: [...options], customValue: "" }));
  });
  const [enabled, setEnabled] = useState(initialRows.length > 0);
  const [message, setMessage] = useState("");
  const suggestedAttributeNames = suggestedVariantAttributes(categoryName);
  const payload = enabled ? rows.map(row => ({ ...(row.id ? { id: row.id } : {}), name: row.name.trim(), sku: row.sku.trim() || null, options: row.options, isActive: row.isActive, price: row.price ? Number(row.price) : null, discountPrice: row.discountPrice ? Number(row.discountPrice) : null, images: row.images, quantity: presentStockQuantity(row.quantity), lowStockThreshold: presentStockQuantity(row.threshold) })) : [];
  const patch = (index: number, values: Partial<Row>) => setRows(current => current.map((row, i) => i === index ? { ...row, ...values } : row));

  function updateAxis(index: number, values: Partial<Axis>) {
    setAxes(current => current.map((axis, i) => i === index ? { ...axis, ...values } : axis));
  }

  function addValue(index: number, candidate: string) {
    const value = candidate.trim();
    if (!value) return;
    setAxes(current => current.map((axis, i) => {
      if (i !== index || axis.values.some(existing => normalize(existing) === normalize(value))) return i === index ? { ...axis, customValue: "" } : axis;
      return { ...axis, values: [...axis.values, value], customValue: "" };
    }));
  }

  function toggleSuggestion(index: number, value: string) {
    const axis = axes[index];
    if (!axis) return;
    const selected = axis.values.some(item => normalize(item) === normalize(value));
    updateAxis(index, { values: selected ? axis.values.filter(item => normalize(item) !== normalize(value)) : [...axis.values, value] });
  }

  function generateMatrix() {
    setMessage("");
    const parsedAxes = axes.map(axis => ({ name: axis.name.trim(), values: [...new Map(axis.values.map(value => [normalize(value), value])).values()] }));
    if (!parsedAxes.length || parsedAxes.some(axis => !axis.name || !axis.values.length)) { setMessage("Ən azı bir xüsusiyyət və onun seçimlərini daxil edin."); return; }
    const axisKeys = parsedAxes.map(axis => normalize(axis.name));
    if (new Set(axisKeys).size !== axisKeys.length) { setMessage("Xüsusiyyət adları təkrarlana bilməz."); return; }
    const matrix: Record<string, string>[] = [];
    const walk = (index: number, current: Record<string, string>) => {
      if (index === parsedAxes.length) { matrix.push(current); return; }
      const axis = parsedAxes[index];
      for (const value of axis.values) walk(index + 1, { ...current, [axis.name]: value });
    };
    walk(0, {});
    if (matrix.length > 100) { setMessage("Bir məhsul üçün ən çox 100 variant kombinasiyası yaradıla bilər."); return; }
    const existing = new Map<string, Row>();
    for (const row of rows) {
      const key = combination(row.options);
      if (Object.keys(row.options).length) existing.set(key, row);
      else existing.set(combination({ Seçim: row.name }), row);
    }
    const next = matrix.map(options => {
      const old = existing.get(combination(options));
      if (old) existing.delete(combination(options));
      return old ? { ...old, options, name: old.name || Object.values(options).join(" / ") } : blankRow(options);
    });
    // Keep older saved combinations in the payload. Vendors can explicitly deactivate them below.
    next.push(...[...existing.values()].filter(row => Boolean(row.id)));
    setRows(next); setMessage(`${matrix.length} kombinasiya yaradıldı. Əvvəlki saxlanmış variantlar qorunub; lazım deyilsə, onları ayrıca deaktiv edin.`);
  }

  return <VendorFormSection title="Məhsul seçimləri" description="Rəng, ölçü, yaddaş və başqa seçimlərdən uyğun kombinasiyalar yaradın. Əsas qiymətdən istifadə edə və ya hər seçim üçün ayrıca qiymət göstərə bilərsiniz." bodyClassName="gap-4">
    <input type="hidden" name={name} value={JSON.stringify(payload)}/>
    <input type="hidden" name={`${name}Enabled`} value={String(enabled)}/>
    <label className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-control border px-4 py-3 text-sm font-medium text-fg transition-colors ${enabled ? "border-primary bg-primary-subtle" : "border-line-strong bg-white hover:border-primary"}`}><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} className={vendorCheckbox}/> Məhsulun ölçü, rəng və ya başqa seçimləri var</label>
    {enabled ? <>
    <div className="grid gap-3">{axes.map((axis, index) => {
      const suggestions = suggestedVariantValues(axis.name);
      const attributeListId = `variant-attributes-${axis.id}`;
      return <div key={axis.id} className="grid gap-4 rounded-control border border-line bg-surface-page p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <label className={vendorLabel}>Xüsusiyyət
            <input className={input} list={attributeListId} value={axis.name} placeholder="Məsələn, Rəng" onChange={event => updateAxis(index, { name: event.target.value })}/>
            <datalist id={attributeListId}>{suggestedAttributeNames.map(option => <option key={option} value={option}/>)}</datalist>
          </label>
          <button type="button" onClick={() => setAxes(current => current.filter((_, i) => i !== index))} className="inline-flex min-h-12 items-center justify-center self-end rounded-full border border-[#f1b9b9] bg-white px-4 text-sm font-medium text-danger hover:bg-danger-subtle">Xüsusiyyəti sil</button>
        </div>
        {suggestions.length > 0 && <div><p className="mb-2 text-xs font-medium text-fg-secondary">Təklif olunan seçimlər</p><div className="flex flex-wrap gap-2">{suggestions.map(value => {
          const selected = axis.values.some(item => normalize(item) === normalize(value));
          return <button key={value} type="button" aria-pressed={selected} onClick={() => toggleSuggestion(index, value)} className={`min-h-9 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${selected ? "border-primary bg-primary text-white" : "border-line-strong bg-white text-fg hover:border-primary"}`}>{value}</button>;
        })}</div></div>}
        <div><p className="mb-2 text-sm font-medium text-fg">Seçimlər</p><div className="flex flex-wrap gap-2">{axis.values.map(value => <span key={normalize(value)} className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-primary-tint px-3 py-1.5 text-sm font-medium text-primary">{value}<button type="button" aria-label={`${value} seçimini sil`} onClick={() => updateAxis(index, { values: axis.values.filter(item => normalize(item) !== normalize(value)) })} className="ml-1 rounded-full px-1 font-semibold hover:bg-white">×</button></span>)}{!axis.values.length && <span className="text-sm text-fg-muted">Hələ seçim əlavə edilməyib.</span>}</div></div>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]"><input className={input} value={axis.customValue} onChange={event => updateAxis(index, { customValue: event.target.value })} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addValue(index, axis.customValue); } }} placeholder="Yeni seçim əlavə et" aria-label={`${axis.name || "Xüsusiyyət"} üçün xüsusi seçim`}/><button type="button" onClick={() => addValue(index, axis.customValue)} className="inline-flex min-h-11 items-center justify-center rounded-full border border-line-strong bg-white px-4 text-sm font-medium text-fg transition-colors hover:border-primary hover:text-primary">+ Seçim əlavə et</button></div>
      </div>;
    })}</div>
    <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setAxes(current => [...current, { id: crypto.randomUUID(), name: "", values: [], customValue: "" }])} className="inline-flex min-h-11 items-center justify-center rounded-full border border-line-strong bg-white px-4 text-sm font-medium text-fg transition-colors hover:border-primary hover:text-primary">+ Xüsusiyyət əlavə et</button><button type="button" onClick={generateMatrix} className={buttonClass({ size: "sm" })}>Variant kombinasiyalarını yarat</button></div>
    {message && <p role="status" className="rounded-control bg-primary-subtle px-3 py-2 text-sm text-primary">{message}</p>}
    {!rows.length && <p className="rounded-control border border-dashed border-line-strong p-4 text-sm text-fg-muted">Məhsul seçimləri yaradılmayıb.</p>}
    {rows.map((row, index) => <article key={row.id || combination(row.options)} className="grid min-w-0 gap-4 rounded-control border border-line bg-surface-page p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="min-w-0 break-words font-semibold text-fg">{Object.entries(row.options).map(([key, value]) => `${key}: ${value}`).join(" / ") || row.name}</h3><label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-fg"><input type="checkbox" checked={row.isActive} onChange={event => patch(index, { isActive: event.target.checked })} className={vendorCheckbox}/> Satışda aktiv</label></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><label className={vendorLabel}>Seçim adı<input className={input} value={row.name} onChange={event => patch(index, { name: event.target.value })}/></label><label className={vendorLabel}>Məhsul kodu (istəyə bağlı)<input className={input} value={row.sku} onChange={event => patch(index, { sku: event.target.value })}/><span className={vendorHint}>Hər seçim üçün ayrıca kod yaza bilərsiniz.</span></label><label className={vendorLabel}>Seçimin qiyməti (boş saxlayın: əsas qiymət istifadə olunur)<input className={input} type="number" min="0.01" step="0.01" value={row.price} onChange={event => patch(index, { price: event.target.value })}/></label><label className={vendorLabel}>Endirimli qiymət<input className={input} type="number" min="0.01" step="0.01" value={row.discountPrice} onChange={event => patch(index, { discountPrice: event.target.value })}/></label><label className={vendorLabel}>Stok<input className={input} type="number" min="0" value={row.quantity} onChange={event => patch(index, { quantity: event.target.value })}/></label><label className={vendorLabel}>Az stok həddi<input className={input} type="number" min="0" value={row.threshold} onChange={event => patch(index, { threshold: event.target.value })}/></label></div>
      <VendorImageUploader storeId={storeId} name={null} label="Bu seçimin şəkilləri" initialUrls={row.images} onChange={images => patch(index, { images })}/>
    </article>)}
    </> : <p className="text-sm text-fg-muted">Seçimləri söndürdükdə əvvəlkilər deaktiv ediləcək. Seçim yoxdursa, əsas məhsulun stoku istifadə olunur.</p>}
    {error}
  </VendorFormSection>;
}
