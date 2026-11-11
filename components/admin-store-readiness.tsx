import Link from "next/link";

type ReadinessItem = { label: string; ready: boolean; detail: string };

export default function AdminStoreReadiness({ items, storeName, storeId }: {
  items: ReadinessItem[];
  storeName: string;
  storeId: string;
}) {
  const allReady = items.every((item) => item.ready);
  return <section aria-labelledby="store-readiness-title" className="mt-5 rounded-2xl border border-[#e7e3d9] bg-white p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="store-readiness-title" className="font-semibold">Mağazanın hazırlıq və təhvil yoxlaması</h2>
        <p className="mt-1 text-sm text-slate-500">{storeName} üçün cari verilənlərə əsaslanan yoxlama. Təhvil mağaza sahibini dəyişmir; satıcı mağaza yaradılarkən sahib kimi təyin olunur.</p>
      </div>
      <Link href={`/stores/${encodeURIComponent(storeId)}`} className="rounded-lg border px-3 py-2 text-sm font-medium text-[#173c40]">İctimai mağazaya bax</Link>
    </div>
    <p className={`mt-4 rounded-xl p-3 text-sm ${allReady ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-950"}`} role="status">
      {allReady ? "Göstərilən hazırlıq yoxlamaları tamamlanıb. Bu, dövlət reyestri və ya hüquqi uyğunluq təsdiqi deyil." : "Təhvilə hazırlıq tamamlanmayıb; aşağıdakı bəndləri yoxlayın. Aktivləşdirmə mövcud hüquqi, abunəlik və mağaza qaydalarına tabedir."}
    </p>
    <ul className="mt-3 grid gap-2 sm:grid-cols-2">
      {items.map((item) => <li key={item.label} className="rounded-xl border border-[#eeeae2] p-3">
        <p className={`text-sm font-medium ${item.ready ? "text-emerald-800" : "text-amber-900"}`}>{item.ready ? "Hazır" : "Tələb olunur"} · {item.label}</p>
        <p className="mt-1 text-xs leading-5 text-slate-600">{item.detail}</p>
      </li>)}
    </ul>
  </section>;
}
