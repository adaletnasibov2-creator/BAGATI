"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ContentBody } from "@/lib/content-markup";
import { useConfirmDialog } from "@/components/admin-ui/confirm-dialog";
import { Section } from "@/components/admin-ui/section";
import { ResultMessage } from "@/components/admin-ui/result-message";
import { buttonClass, inputClass } from "@/components/admin-ui/styles";

type Revision = { id: string; title: string; note: string | null; createdAt: string; createdAtLabel: string; createdBy: string | null; bodyLength: number; current: boolean };
type EditorData = { slug: string; title: string; body: string; updatedAt: string | null; updatedAtLabel: string | null; updatedBy: string | null; fromDatabase: boolean; revisions: Revision[] };

// Dates arrive formatted by the server (Baku time): formatting them here could differ from the server and break hydration.
const BODY_MAX = 50_000;

/**
 * Content page editor: title, body (safe format), live preview with the same renderer as the public page, note,
 * save (409 when another admin saved meanwhile) and history with "Bu versiyaya qayıt" (creates a new version).
 */
export default function AdminContentPageEditor({ data }: { data: EditorData }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirmDialog();
  const [title, setTitle] = useState(data.title);
  const [body, setBody] = useState(data.body);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const changed = title !== data.title || body !== data.body || !data.fromDatabase;
  const issue = !title.trim() ? "Başlıq boş ola bilməz." : title.trim().length > 160 ? "Başlıq ən çox 160 simvol ola bilər." : !body.trim() ? "Mətn boş ola bilməz." : body.length > BODY_MAX ? `Mətn ən çox ${BODY_MAX} simvol ola bilər.` : "";

  async function send(url: string, payload: Record<string, unknown>) {
    setBusy(true); setResult(null);
    try {
      const response = await fetch(url, { method: url.endsWith("/restore") ? "POST" : "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, expectedUpdatedAt: data.updatedAt }) });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || "Əməliyyat alınmadı.");
      setResult({ tone: "success", text: json.message || "Yadda saxlanıldı." });
      setNote("");
      router.refresh();
    } catch (error) {
      setResult({ tone: "error", text: error instanceof Error ? error.message : "Əməliyyat alınmadı." });
    } finally {
      setBusy(false);
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (issue || busy) return;
    await send(`/api/admin/pages/${data.slug}`, { title, body, note });
  }

  async function restore(revision: Revision) {
    if (busy) return;
    if (!(await confirm({ title: "Bu versiyaya qayıt", message: `${revision.createdAtLabel} versiyası ("${revision.title}") yeni versiya kimi bərpa ediləcək. Heç bir versiya silinmir.`, confirmLabel: "Bərpa et" }))) return;
    await send(`/api/admin/pages/${data.slug}/restore`, { revisionId: revision.id });
  }

  return <div className="grid gap-5 xl:grid-cols-2">
    <Section title="Redaktə" description={data.updatedAtLabel ? `Son yenilənmə: ${data.updatedAtLabel}${data.updatedBy ? ` · ${data.updatedBy}` : ""}` : "Hələ yadda saxlanmayıb."}>
      <form onSubmit={save} className="grid gap-4">
        <label className="grid gap-1 text-sm font-medium text-slate-700">Başlıq
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required className={inputClass} />
        </label>
        <label className="grid gap-1 text-sm font-medium text-slate-700">Mətn
          <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={18} className={`${inputClass} font-mono leading-6`} aria-describedby="content-format-help" />
          <span className="text-xs font-normal text-slate-500">{body.length} / {BODY_MAX} simvol</span>
        </label>
        <details id="content-format-help" className="rounded-xl bg-[#f8f7f4] p-3 text-xs text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-700">Format qaydaları</summary>
          <ul className="mt-2 grid gap-1">
            <li><code>## Başlıq</code>, <code>### Alt başlıq</code></li>
            <li>Boş sətir yeni abzas başladır</li>
            <li><code>- bənd</code> və ya <code>1. bənd</code> siyahı yaradır</li>
            <li><code>**qalın mətn**</code></li>
            <li><code>[keçid mətni](/terms)</code> və ya <code>[mətn](https://…)</code> — yalnız daxili yol və ya HTTPS</li>
            <li>HTML qəbul edilmir; mətn olduğu kimi göstərilir.</li>
          </ul>
        </details>
        <label className="grid gap-1 text-sm font-medium text-slate-700">Qısa qeyd (istəyə bağlı)
          <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} placeholder="Məsələn: çatdırılma bəndi yeniləndi" className={inputClass} />
        </label>
        {issue && <p className="text-sm text-red-700" aria-live="polite">{issue}</p>}
        {result && <ResultMessage tone={result.tone}>{result.text}</ResultMessage>}
        <button type="submit" disabled={busy || Boolean(issue) || !changed} className={buttonClass("primary", "w-fit")}>{busy ? "Gözləyin…" : "Yadda saxla"}</button>
      </form>
    </Section>
    <Section title="Önizləmə" description="Saytda belə görünəcək (eyni təhlükəsiz göstərici).">
      <article className="rounded-xl border border-[#eeeae2] p-4">
        <h1 className="mb-3 text-2xl font-semibold text-[#173A3A]">{title || "Başlıq"}</h1>
        <ContentBody body={body} />
      </article>
    </Section>
    <Section className="xl:col-span-2" title="Tarixçə" description={`Son ${data.revisions.length} versiya (ən çox 20 saxlanılır). Bərpa yeni versiya yaradır, heç nə silinmir.`}>
      {data.revisions.length
        ? <ol className="divide-y divide-[#eeeae2]">
          {data.revisions.map((revision) => <li key={revision.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <span className="min-w-0">
              <b>{revision.createdAtLabel}</b> · {revision.createdBy ?? "İlkin mətn"}
              <span className="block text-slate-600">{revision.title} · {revision.bodyLength} simvol{revision.note ? ` · ${revision.note}` : ""}</span>
            </span>
            {revision.current
              ? <span className="text-xs font-medium text-emerald-800">Hazırkı versiya</span>
              : <button type="button" disabled={busy} onClick={() => void restore(revision)} className={buttonClass("secondary")}>Bu versiyaya qayıt</button>}
          </li>)}
        </ol>
        : <p className="text-sm text-slate-500">Hələ versiya yoxdur.</p>}
    </Section>
    {dialog}
  </div>;
}
