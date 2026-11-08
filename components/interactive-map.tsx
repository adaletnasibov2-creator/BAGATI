"use client";

import dynamic from "next/dynamic";

export type MapPoint = { latitude: number; longitude: number };
export type MapStoreMarker = MapPoint & { id: string; name: string; slug: string; city: string; address: string | null; logoUrl: string | null };

const MapSurface = dynamic(() => import("@/components/interactive-map-surface"), {
  ssr: false,
  loading: () => <div className="grid h-72 place-items-center rounded-xl bg-[#eeece5] text-sm text-slate-500">Xəritə yüklənir…</div>,
});

export function InteractiveMap(props: {
  selected?: MapPoint | null;
  onSelect?: (point: MapPoint) => void;
  markers?: MapStoreMarker[];
  className?: string;
  zoom?: number;
}) {
  return <MapSurface {...props} />;
}
