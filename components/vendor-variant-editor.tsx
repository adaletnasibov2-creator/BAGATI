"use client";

import { useMemo, useState } from "react";
import VendorImageUploader from "@/components/vendor-image-uploader";
import { presentStockQuantity } from "@/lib/stock-quantity";

type Axis = { id: string; name: string; values: string[]; customValue: string };
type Row = { id?: string; name: string; sku: string; options: Record<string, string>; isActive: boolean; price: string; discountPrice: string; images: string[]; quantity: string; threshold: string };
const input = "w-full rounded-xl border border-[#ded9cf] bg-white px-3 py-2.5 text-sm";
const normalize = (value: string) => value.trim().normalize("NFKC").toLocaleLowerCase("az-AZ");
const splitValues = (value: string) => [...new Set(value.split(/[\n,;]/).map(item => item.trim()).filter(Boolean))];
const combination = (options: Record<string, string>) => JSON.stringify(Object.entries(options).map(([key, value]) => [normalize(key), normalize(value)]).sort(([a], [b]) => String(a).localeCompare(String(b), "az-AZ")));
const blankRow = (options: Record<string, string>): Row => ({ name: Object.values(options).join(" / "), sku: "", options, isActive: true, price: "", discountPrice: "", images: [], quantity: "0", threshold: "5" });

const valueSuggestions: Record<string, string[]> = {
  "rəng": ["Qara", "Ağ", "Mavi", "Qırmızı", "Yaşıl", "Sarı", "Boz", "Qəhvəyi", "Bej", "Narıncı", "Bənövşəyi", "Çəhrayı"],
  "ölçü": ["XS", "S", "M", "L", "XL", "XXL", "XXXL"],
  "ayaqqabı ölçüsü": ["35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45"],
  "yaddaş": ["32 GB", "64 GB", "128 GB", "256 GB", "512 GB", "1 TB", "2 TB"],
  "ram": ["4 GB", "8 GB", "16 GB", "32 GB", "64 GB"],
  "ssd": ["256 GB", "512 GB", "1 TB", "2 TB"],
};

const allAttributeNames = ["Rəng", "Ölçü", "Ayaqqabı ölçüsü", "Yaddaş", "RAM", "SSD", "Material", "Model", "Stil", "Forma"];
const categoryAttributeNames: Record<string, string[]> = {
  clothing: ["Rəng", "Ölçü", "Material", "Stil"],
  shoes: ["Rəng", "Ölçü", "Ayaqqabı ölçüsü", "Material"],
  phones: ["Rəng", "Yaddaş", "RAM"],
  laptops: ["Rəng", "RAM", "SSD", "Yaddaş"],
};

function categorySuggestionKey(categoryName: string) {
  const category = normalize(categoryName);
  if (/ayaqqabı|footwear|shoes/.test(category)) return "shoes";
  if (/telefon|phone|smartphone|mobil/.test(category)) return "phones";
  if (/noutbuk|laptop|kompüter|computer/.test(category)) return "laptops";
  if (/geyim|clothing|apparel|paltar/.test(category)) return "clothing";
  return null;
}

function objectOptions(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item ?? "").trim()]).filter(([key, item]) => key && item));
}

export default function VendorVariantEditor({ initial, storeId, name = "variants", categoryName = "" }: { initial: any[]; storeId: string; name?: string; categoryName?: string }) {
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
  const categoryKey = categorySuggestionKey(categoryName);
  const suggestedAttributeNames = categoryKey ? categoryAttributeNames[categoryKey] : allAttributeNames;
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

  return <section className="grid gap-4 rounded-2xl border border-[#e9e4da] bg-white p-5 sm:p-7">
    <input type="hidden" name={name} value={JSON.stringify(payload)}/>
    <input type="hidden" name={`${name}Enabled`} value={String(enabled)}/>
    <div><h2 className="font-semibold">Məhsul variantları</h2><p className="mt-1 text-sm text-slate-500">Rəng, ölçü, yaddaş və başqa xüsusiyyətlərdən kombinasiya yaradın. Əsas məhsulun qiyməti və ya hər variantın ayrıca qiyməti istifadə olunur.</p></div>
    <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)}/> Bu məhsulda variantlar var</label>
    {enabled ? <>
    <div className="grid gap-3">{axes.map((axis, index) => {
      const suggestions = valueSuggestions[normalize(axis.name)] || [];
      const attributeListId = `variant-attributes-${axis.id}`;
      return <div key={axis.id} className="grid gap-3 rounded-xl bg-[#f8f7f4] p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <label className="grid gap-1 text-sm">Xüsusiyyət
            <input className={input} list={attributeListId} value={axis.name} placeholder="Məsələn, Rəng" onChange={event => updateAxis(index, { name: event.target.value })}/>
            <datalist id={attributeListId}>{suggestedAttributeNames.map(option => <option key={option} value={option}/>)}</datalist>
          </label>
          <button type="button" onClick={() => setAxes(current => current.filter((_, i) => i !== index))} className="self-end rounded-lg border px-3 py-2 text-sm text-red-700">Xüsusiyyəti sil</button>
        </div>
        {suggestions.length > 0 && <div><p className="mb-2 text-xs font-medium text-slate-600">Təklif olunan seçimlər</p><div className="flex flex-wrap gap-2">{suggestions.map(value => {
          const selected = axis.values.some(item => normalize(item) === normalize(value));
          return <button key={value} type="button" aria-pressed={selected} onClick={() => toggleSuggestion(index, value)} className={`rounded-full border px-3 py-1.5 text-xs transition ${selected ? "border-[#173c40] bg-[#173c40] text-white" : "border-[#ded9cf] bg-white text-[#263442] hover:border-[#173c40]"}`}>{value}</button>;
        })}</div></div>}
        <div><p className="mb-2 text-sm font-medium">Seçimlər</p><div className="flex flex-wrap gap-2">{axis.values.map(value => <span key={normalize(value)} className="inline-flex items-center gap-1 rounded-full border border-[#d9e5df] bg-[#f3f8f5] px-3 py-1.5 text-sm text-[#173c40]">{value}<button type="button" aria-label={`${value} seçimini sil`} onClick={() => updateAxis(index, { values: axis.values.filter(item => normalize(item) !== normalize(value)) })} className="ml-1 rounded-full px-1 font-semibold hover:bg-white">×</button></span>)}{!axis.values.length && <span className="text-sm text-slate-500">Hələ seçim əlavə edilməyib.</span>}</div></div>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]"><input className={input} value={axis.customValue} onChange={event => updateAxis(index, { customValue: event.target.value })} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addValue(index, axis.customValue); } }} placeholder="Yeni seçim əlavə et" aria-label={`${axis.name || "Xüsusiyyət"} üçün xüsusi seçim`}/><button type="button" onClick={() => addValue(index, axis.customValue)} className="min-h-10 rounded-xl border px-4 text-sm">+ Seçim əlavə et</button></div>
      </div>;
    })}</div>
    <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setAxes(current => [...current, { id: crypto.randomUUID(), name: "", values: [], customValue: "" }])} className="min-h-10 rounded-xl border px-4 text-sm">+ Xüsusiyyət əlavə et</button><button type="button" onClick={generateMatrix} className="min-h-10 rounded-xl bg-[#173c40] px-4 text-sm font-semibold text-white">Variant kombinasiyalarını yarat</button></div>
    {message && <p role="status" className="text-sm text-slate-600">{message}</p>}
    {!rows.length && <p className="rounded-xl bg-[#f8f7f4] p-4 text-sm text-slate-500">Variant kombinasiyaları yaradılmayıb.</p>}
    {rows.map((row, index) => <article key={row.id || combination(row.options)} className="grid gap-3 rounded-xl border border-[#e9e4da] bg-[#fbfaf8] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{Object.entries(row.options).map(([key, value]) => `${key}: ${value}`).join(" / ") || row.name}</h3><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={row.isActive} onChange={event => patch(index, { isActive: event.target.checked })}/> Satışda aktiv</label></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><label className="grid gap-1 text-sm">Variant adı<input className={input} value={row.name} onChange={event => patch(index, { name: event.target.value })}/></label><label className="grid gap-1 text-sm">SKU / Variant kodu<input className={input} value={row.sku} onChange={event => patch(index, { sku: event.target.value })}/><span className="text-xs leading-5 text-slate-500">Hər variant üçün ayrıca unikal kod yaza bilərsiniz.</span></label><label className="grid gap-1 text-sm">Variant qiyməti (boş saxla: məhsul qiyməti)<input className={input} type="number" min="0.01" step="0.01" value={row.price} onChange={event => patch(index, { price: event.target.value })}/></label><label className="grid gap-1 text-sm">Endirimli qiymət<input className={input} type="number" min="0.01" step="0.01" value={row.discountPrice} onChange={event => patch(index, { discountPrice: event.target.value })}/></label><label className="grid gap-1 text-sm">Stok<input className={input} type="number" min="0" value={row.quantity} onChange={event => patch(index, { quantity: event.target.value })}/></label><label className="grid gap-1 text-sm">Az stok həddi<input className={input} type="number" min="0" value={row.threshold} onChange={event => patch(index, { threshold: event.target.value })}/></label></div>
      <VendorImageUploader storeId={storeId} name={null} label="Bu variantın şəkilləri" initialUrls={row.images} onChange={images => patch(index, { images })}/>
    </article>)}
    </> : <p className="rounded-xl bg-[#f8f7f4] p-4 text-sm text-slate-500">Variantlar söndürüləndə əvvəlki kombinasiyalar deaktiv ediləcək. Variant yoxdursa, əsas məhsulun stoku istifadə olunur.</p>}
  </section>;
}
