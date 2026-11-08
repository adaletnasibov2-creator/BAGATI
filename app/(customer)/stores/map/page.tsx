import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getPublicStoreMapMarkers } from "@/lib/public-store-map";
import { InteractiveMap, type MapStoreMarker } from "@/components/interactive-map";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mağazalar xəritədə" };

export default async function StoreMapPage() {
  const markers: MapStoreMarker[] = await getPublicStoreMapMarkers((args:any) => prisma.store.findMany(args) as any);
  return <main className="container py-8 md:py-12"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-emerald">BAGATI mağazaları</p><h1 className="mt-2 text-3xl font-semibold text-ink md:text-4xl">Mağazalar xəritədə</h1><p className="mt-2 text-sm text-muted">Xəritədə yalnız koordinatı olan və müştərilər üçün aktiv mağazalar göstərilir.</p></div><Link href="/stores" className="rounded-full border border-line bg-white px-4 py-2.5 text-sm font-medium">Siyahı görünüşü</Link></div><div className="mt-6 overflow-hidden rounded-2xl border border-line bg-white p-2 sm:p-3"><InteractiveMap markers={markers} className="h-[65vh] min-h-80 max-h-[760px]" zoom={6}/></div>{markers.length?<p className="mt-3 text-sm text-muted">{markers.length} mağaza göstərilir.</p>:<p className="mt-3 text-sm text-muted">Xəritədə göstərilə bilən aktiv mağaza hələ yoxdur.</p>}</main>;
}
