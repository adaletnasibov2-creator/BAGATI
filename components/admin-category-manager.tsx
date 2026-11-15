"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, FolderInput, Pencil, Plus, Trash2 } from "lucide-react";
import { CategoryGlyph, CategoryIcon } from "@/components/category-icon";
import { AdminCategoryIconPicker } from "@/components/admin-category-icon-picker";
import { useConfirmDialog } from "@/components/admin-ui/confirm-dialog";
import { ResultMessage } from "@/components/admin-ui/result-message";
import { buttonClass, cardClass, inputClass } from "@/components/admin-ui/styles";
import { categorySlug } from "@/lib/category-tree";

export type AdminCategoryRow = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  isActive: boolean;
  sortOrder: number;
  iconKey: string | null;
  imageUrl: string | null;
  /** Products directly in this category (all statuses). */
  productCount: number;
  /** Products in this category's scope (a top-level includes its subcategories), all statuses. */
  totalCount: number;
  /** Products visible on the storefront in this category's scope (rolled up for a top-level). */
  visibleCount: number;
  childCount: number;
};
export type AdminCategoryNode = AdminCategoryRow & { children: AdminCategoryRow[] };

type Editor = { mode: "create"; parentId: string | null } | { mode: "edit"; category: AdminCategoryRow };
type Feedback = { tone: "success" | "error"; text: string } | null;

const API = "/api/admin/category-tree";

async function send(url: string, method: string, body?: unknown): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  return response.ok ? { ok: true } : { ok: false, error: result.error || "Əməliyyat uğursuz oldu." };
}

export default function AdminCategoryManager({ tree }: { tree: AdminCategoryNode[] }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirmDialog();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setBusy(true);
    setFeedback(null);
    const result = await action();
    setBusy(false);
    setFeedback(result.ok ? { tone: "success", text: success } : { tone: "error", text: result.error ?? "Əməliyyat uğursuz oldu." });
    if (result.ok) { setEditor(null); router.refresh(); }
    return result.ok;
  }

  async function toggleActive(category: AdminCategoryRow) {
    if (category.isActive) {
      const ok = await confirm({
        title: "Kateqoriyanı deaktiv et",
        message: `“${category.name}” mağazada və menyularda görünməyəcək${category.childCount ? ", alt kateqoriyaları da" : ""}. Məhsullar silinmir və kateqoriyaları dəyişmir. Satıcılar onu yeni məhsul üçün seçə bilməz.`,
        confirmLabel: "Deaktiv et",
        danger: true,
      });
      if (!ok) return;
    }
    await run(() => send(`${API}/${category.id}`, "PATCH", { isActive: !category.isActive }), category.isActive ? "Kateqoriya deaktiv edildi." : "Kateqoriya aktiv edildi.");
  }

  async function remove(category: AdminCategoryRow) {
    if (category.productCount || category.childCount) {
      setFeedback({
        tone: "error",
        text: `“${category.name}” silinə bilməz: ${[category.productCount ? `${category.productCount} məhsul bu kateqoriyadadır` : "", category.childCount ? `${category.childCount} alt kateqoriyası var` : ""].filter(Boolean).join(", ")}. Məhsulları köçürün və ya kateqoriyanı deaktiv edin.`,
      });
      return;
    }
    const ok = await confirm({ title: "Kateqoriyanı sil", message: `“${category.name}” birdəfəlik silinsin? Bu geri qaytarılmır.`, confirmLabel: "Sil", danger: true });
    if (ok) await run(() => send(`${API}/${category.id}`, "DELETE"), "Kateqoriya silindi.");
  }

  const reorder = (category: AdminCategoryRow, direction: "up" | "down") =>
    run(() => send(`${API}/${category.id}/reorder`, "POST", { direction }), "Sıra yeniləndi.");

  const tops: AdminCategoryRow[] = tree;
  const rowActions: RowActions = {
    busy,
    reorder,
    edit: (category) => { setFeedback(null); setEditor({ mode: "edit", category }); },
    addChild: (category) => { setFeedback(null); setEditor({ mode: "create", parentId: category.id }); },
    toggleActive,
    remove,
  };


  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">{tree.length} üst kateqoriya · {tree.reduce((sum, top) => sum + top.children.length, 0)} alt kateqoriya</p>
        <button type="button" className={buttonClass("primary")} disabled={busy} onClick={() => { setFeedback(null); setEditor({ mode: "create", parentId: null }); }}><Plus aria-hidden="true" size={16} />Üst kateqoriya əlavə et</button>
      </div>
      {feedback && <ResultMessage tone={feedback.tone}>{feedback.text}</ResultMessage>}
      {editor && <CategoryEditor key={editor.mode === "edit" ? editor.category.id : `new-${editor.parentId ?? "top"}`} editor={editor} tops={tops} busy={busy} onCancel={() => setEditor(null)} onSubmit={(url, method, body, success) => run(() => send(url, method, body), success)} />}
      <ol className="grid gap-3">
        {tree.map((top, index) => (
          <li key={top.id} className={cardClass}>
            <CategoryRow category={top} siblings={tops} index={index} parent={null} actions={rowActions} />
            {top.children.length > 0 && (
              <ol className="mt-4 grid gap-3 border-t border-[#eeeae2] pt-4 sm:ml-6">
                {top.children.map((child, childIndex) => (
                  <li key={child.id}><CategoryRow category={child} siblings={top.children} index={childIndex} parent={top} actions={rowActions} /></li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ol>
      {dialog}
    </div>
  );
}

type RowActions = {
  busy: boolean;
  reorder: (category: AdminCategoryRow, direction: "up" | "down") => unknown;
  edit: (category: AdminCategoryRow) => void;
  addChild: (category: AdminCategoryRow) => void;
  toggleActive: (category: AdminCategoryRow) => unknown;
  remove: (category: AdminCategoryRow) => unknown;
};

const iconButton = "grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-[#e7e3d9] bg-white text-[#173c40] hover:bg-[#f8f7f4] disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#173c40]";

function CategoryRow({ category, siblings, index, parent, actions }: { category: AdminCategoryRow; siblings: AdminCategoryRow[]; index: number; parent: AdminCategoryRow | null; actions: RowActions }) {
const { busy, reorder, edit, addChild, toggleActive, remove } = actions;
  const isOther = category.name.trim().toLocaleLowerCase("az-AZ") === "digər";
  const lastMovable = siblings.filter((row) => row.name.trim().toLocaleLowerCase("az-AZ") !== "digər").length - 1;
  const directOnTopWithChildren = !parent && category.childCount > 0 ? category.productCount : 0;
  return (
    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {parent ? (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#f1f6f3] text-[#1f5a4f]"><CategoryGlyph category={{ ...category, parentIconKey: parent.iconKey }} size={18} /></span>
        ) : (
          <CategoryIcon category={category} size="small" />
        )}
        <div className="min-w-0">
          <p className="flex min-w-0 flex-wrap items-center gap-2 font-semibold text-[#0d1b2a]">
            <span className="min-w-0 truncate">{category.name}</span>
            {!category.isActive && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Deaktiv</span>}
          </p>
          <p className="truncate text-xs text-slate-500">/{category.slug} · {category.totalCount} məhsul · mağazada {category.visibleCount}</p>
          {directOnTopWithChildren > 0 && (
            <Link href={`/admin/categories/move?from=${encodeURIComponent(category.id)}`} className="mt-1 inline-flex min-h-8 items-center rounded-full bg-amber-50 px-2.5 text-xs font-medium text-amber-900 hover:bg-amber-100">
              Alt kateqoriyasız: {directOnTopWithChildren} məhsul → köçür
            </Link>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={iconButton} disabled={busy || isOther || index === 0} aria-label={`${category.name}: yuxarı`} onClick={() => reorder(category, "up")}><ArrowUp aria-hidden="true" size={16} /></button>
        <button type="button" className={iconButton} disabled={busy || isOther || index >= lastMovable} aria-label={`${category.name}: aşağı`} onClick={() => reorder(category, "down")}><ArrowDown aria-hidden="true" size={16} /></button>
        <button type="button" className={iconButton} disabled={busy} aria-label={`${category.name}: redaktə et`} onClick={() => edit(category)}><Pencil aria-hidden="true" size={16} /></button>
        {!parent && <button type="button" className={buttonClass("ghost", "min-h-10 px-2.5")} disabled={busy} onClick={() => addChild(category)}><Plus aria-hidden="true" size={16} />Alt</button>}
        {category.productCount > 0 && <Link href={`/admin/categories/move?from=${encodeURIComponent(category.id)}`} className={buttonClass("ghost", "min-h-10 px-2.5")} aria-label={`${category.name}: məhsulları köçür`}><FolderInput aria-hidden="true" size={16} />Köçür</Link>}
        <button type="button" className={buttonClass("ghost", "min-h-10 px-2.5")} disabled={busy} onClick={() => toggleActive(category)}>{category.isActive ? "Deaktiv et" : "Aktiv et"}</button>
        <button type="button" className={iconButton} disabled={busy} aria-label={`${category.name}: sil`} title={category.productCount || category.childCount ? "Məhsulu və ya alt kateqoriyası olan kateqoriya silinmir" : "Sil"} onClick={() => remove(category)}><Trash2 aria-hidden="true" size={16} className={category.productCount || category.childCount ? "text-slate-400" : "text-red-700"} /></button>
      </div>
    </div>
  );
}

function CategoryEditor({
  editor,
  tops,
  busy,
  onCancel,
  onSubmit,
}: {
  editor: Editor;
  tops: AdminCategoryRow[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (url: string, method: string, body: unknown, success: string) => Promise<boolean>;
}) {
  const current = editor.mode === "edit" ? editor.category : null;
  const [name, setName] = useState(current?.name ?? "");
  const [slug, setSlug] = useState(current?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(current));
  const [parentId, setParentId] = useState<string | null>(current ? current.parentId : editor.mode === "create" ? editor.parentId : null);
  const [iconKey, setIconKey] = useState<string | null>(current?.iconKey ?? null);
  const [imageUrl, setImageUrl] = useState(current?.imageUrl ?? "");
  const [isActive, setIsActive] = useState(current?.isActive ?? true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const effectiveSlug = slugTouched ? slug : categorySlug(name);
  const parent = tops.find((top) => top.id === parentId) ?? null;
  const cannotMove = Boolean(current && current.parentId === null && current.childCount > 0);
  const title = current ? `Redaktə: ${current.name}` : parentId ? `Yeni alt kateqoriya: ${parent?.name ?? ""}` : "Yeni üst kateqoriya";

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setUploadError("");
    const form = new FormData();
    form.set("file", file);
    const response = await fetch("/api/admin/homepage/assets", { method: "POST", body: form });
    const result = await response.json().catch(() => ({}));
    setUploading(false);
    if (response.ok && result.asset?.url) setImageUrl(result.asset.url);
    else setUploadError(result.error || "Şəkil yüklənmədi.");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = { name: name.trim(), slug: effectiveSlug, parentId, iconKey, imageUrl: imageUrl.trim() || null, isActive };
    if (current) {
      const changes: Record<string, unknown> = {};
      if (body.name !== current.name) changes.name = body.name;
      if (body.slug !== current.slug) changes.slug = body.slug;
      if (body.parentId !== current.parentId) changes.parentId = body.parentId;
      if (body.iconKey !== current.iconKey) changes.iconKey = body.iconKey;
      if (body.imageUrl !== current.imageUrl) changes.imageUrl = body.imageUrl;
      if (body.isActive !== current.isActive) changes.isActive = body.isActive;
      await onSubmit(`${API}/${current.id}`, "PATCH", changes, changes.parentId !== undefined ? "Kateqoriya köçürüldü." : "Kateqoriya yeniləndi.");
    } else {
      await onSubmit(API, "POST", body, "Kateqoriya əlavə edildi.");
    }
  }

  const preview = { name: name || "Önbaxış", slug: effectiveSlug, parentId, iconKey, imageUrl: imageUrl.trim() || null, parentIconKey: parent?.iconKey ?? null };
  return (
    <form onSubmit={submit} className={`${cardClass} grid gap-4 border-[#173c40]`} aria-label={title}>
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1 text-sm">Ad<input required minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} className={inputClass} /></label>
        <label className="grid gap-1 text-sm">Slug (URL)
          <input required minLength={2} maxLength={120} value={effectiveSlug} onChange={(event) => { setSlugTouched(true); setSlug(event.target.value); }} className={inputClass} />
          <span className="text-xs text-slate-500">Kiçik latın hərfləri və tire; addan avtomatik. Dəyişsə köhnə link işləməz.</span>
        </label>
        <label className="grid gap-1 text-sm">Üst kateqoriya
          <select value={parentId ?? ""} disabled={cannotMove} onChange={(event) => setParentId(event.target.value || null)} className={inputClass}>
            <option value="">Yoxdur (üst səviyyə)</option>
            {tops.filter((top) => top.id !== current?.id).map((top) => <option key={top.id} value={top.id}>{top.name}</option>)}
          </select>
          {cannotMove && <span className="text-xs text-slate-500">Alt kateqoriyaları olan kateqoriya başqasının altına köçürülə bilməz (yalnız iki səviyyə).</span>}
        </label>
        <label className="flex min-h-11 items-center gap-2 self-end text-sm"><input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} className="h-4 w-4" />Aktiv (mağazada görünə bilər)</label>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
        <AdminCategoryIconPicker value={iconKey} onChange={setIconKey} />
        <div className="grid content-start gap-3 rounded-xl border border-[#e7e3d9] p-3">
          <p className="text-sm font-medium">Önbaxış</p>
          <div className="flex items-center gap-3">
            <CategoryIcon category={preview} size="large" />
            <span className="inline-flex min-w-0 items-center gap-2 text-sm"><CategoryGlyph category={preview} size={18} className="text-[#1f5a4f]" /><span className="truncate">{preview.name}</span></span>
          </div>
          <label className="grid gap-1 text-sm">Şəkil (istəyə bağlı)
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => void upload(event.target.files?.[0])} className="text-xs" />
          </label>
          <input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="və ya şəkil ünvanı (https)" className={inputClass} aria-label="Şəkil ünvanı" />
          {imageUrl && <button type="button" onClick={() => setImageUrl("")} className={buttonClass("ghost", "min-h-9 justify-start px-2")}>Şəkli sil</button>}
          {uploading && <p className="text-xs text-slate-500">Yüklənir…</p>}
          {uploadError && <p role="alert" className="text-xs text-red-700">{uploadError}</p>}
          <p className="text-xs text-slate-500">Şəkil yoxdursa ikon göstərilir. Alt kateqoriya ikonsuzdursa üst kateqoriyanın ikonu istifadə olunur.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || uploading} className={buttonClass("primary")}>{busy ? "Saxlanılır…" : current ? "Yadda saxla" : "Əlavə et"}</button>
        <button type="button" onClick={onCancel} className={buttonClass("secondary")}>Ləğv et</button>
      </div>
    </form>
  );
}
