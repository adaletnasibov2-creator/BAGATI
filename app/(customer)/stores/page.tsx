import { prisma } from "@/lib/prisma";
import { createPrismaPublicStoreDiscoveryClient, decodeStoreDiscoveryCursor, findPublicStoreDiscoveryCursorPage } from "@/lib/public-store-discovery";
import { StoreCard } from "@/components/store-card";
import { EmptyState } from "@/components/state-panel";
import Link from "next/link";
import { Prisma } from "@prisma/client";
import { normalizePublicSearchTerm, STORE_SEARCH_MAX_LENGTH } from "@/lib/search-term";
export const dynamic = "force-dynamic";
export default async function StoresPage({ searchParams }: { searchParams: Promise<{ q?: string; city?: string; cursor?: string }> }) {
  const { q: rawQuery, city, cursor } = await searchParams;
  const search = normalizePublicSearchTerm(rawQuery, STORE_SEARCH_MAX_LENGTH);
  const q = search.value;
  const validCursor = cursor && decodeStoreDiscoveryCursor(cursor) ? cursor : undefined;
  const invalidCursor = Boolean(cursor && !validCursor);
  const page = await prisma.$transaction(
    (tx) => findPublicStoreDiscoveryCursorPage(createPrismaPublicStoreDiscoveryClient(tx), { citySlug: city, query: q }, { cursor: validCursor }),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  const pageHref = (value: string | null) => { const params = new URLSearchParams(); if (q) params.set("q", q); if (city) params.set("city", city); if (value) params.set("cursor", value); return `/stores${params.size ? `?${params.toString()}` : ""}`; };
  const stores = page.items;
  return <div className="container py-10 md:py-14"><p className="text-xs font-semibold uppercase tracking-[.18em] text-emerald">Yerli mağazalar</p><h1 className="mt-2 text-3xl font-semibold text-ink md:text-4xl">Mağazaları kəşf et</h1>
    <div className="mt-7 flex flex-wrap items-center gap-3"><form action="/stores" className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row"><input name="q" maxLength={STORE_SEARCH_MAX_LENGTH} defaultValue={q} placeholder="Mağaza axtar" aria-label="Mağaza axtar" className="flex-1 rounded-xl border border-line bg-white px-4 py-3 text-sm outline-none focus:border-emerald"/>{city&&<input type="hidden" name="city" value={city}/>}<button className="rounded-xl bg-ink px-6 py-3 text-sm font-medium text-white hover:bg-emerald">Axtar</button></form><Link href="/stores/map" className="rounded-xl border border-line bg-white px-5 py-3 text-sm font-medium text-ink hover:border-emerald">Xəritədə bax</Link></div>
    {search.tooLong && <p role="alert" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{"Axtar\u0131\u015f s\u00f6z\u00fc " + STORE_SEARCH_MAX_LENGTH + " simvoldan uzun ola bilm\u0259z. Q\u0131sa axtar\u0131\u015f daxil edin."}</p>}
    {invalidCursor && <p role="alert" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Səhifə keçidi etibarsızdır. İlk səhifə göstərilir.</p>}
    <p className="mt-5 text-sm text-muted">{stores.length} mağaza</p>
    {stores.length ? <><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{stores.map(store => <StoreCard key={store.id} id={store.id} name={store.name} city={store.city.name} description={store.description} logoUrl={store.logoUrl} hasLocation={store.latitude!==null&&store.longitude!==null}/>)}</div>
      <nav aria-label="Mağaza səhifələri" className="mt-7 flex flex-wrap justify-between gap-3">
        {page.hasPrevious && page.previousCursor ? <Link rel="prev" href={pageHref(page.previousCursor)} className="min-h-11 rounded-xl border border-line bg-white px-4 py-3 text-sm font-medium">← Əvvəlki mağazalar</Link> : <span/>}
        {page.hasNext && page.nextCursor ? <Link rel="next" href={pageHref(page.nextCursor)} className="min-h-11 rounded-xl bg-ink px-4 py-3 text-sm font-medium text-white">Daha çox mağaza →</Link> : <span className="self-center text-xs text-muted">Bütün uyğun mağazalar göstərildi</span>}
      </nav></> : <div className="mt-4"><EmptyState title={q || city ? "Uyğun mağaza tapılmadı" : "Hazırda ictimai mağaza yoxdur"} detail={q || city ? "Axtarış sözünü və ya şəhəri dəyişərək yenidən yoxlayın." : "Mağazalar admin təsdiqi, hüquqi yoxlama və satış şərtləri tamamlandıqdan sonra burada görünür."}/>{page.hasPrevious && page.previousCursor && <Link rel="prev" href={pageHref(page.previousCursor)} className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-line bg-white px-4 py-3 text-sm font-medium">← Əvvəlki mağazalar</Link>}{page.hasNext && page.nextCursor && <Link rel="next" href={pageHref(page.nextCursor)} className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-ink px-4 py-3 text-sm font-medium text-white">{"N\u00f6vb\u0259ti n\u0259tic\u0259l\u0259ri yoxla \u2192"}</Link>}</div>}
  </div>;
}
