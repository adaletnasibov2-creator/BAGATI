"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents, CircleMarker, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import type { MapPoint, MapStoreMarker } from "@/components/interactive-map";

const AZERBAIJAN_CENTER: [number, number] = [40.1431, 47.5769];
const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const selectedIcon = L.divIcon({ className: "bagati-map-pin", html: '<span style="display:block;width:20px;height:20px;border:3px solid #173c40;border-radius:50%;background:#d9a441;box-shadow:0 2px 8px #0005"></span>', iconSize: [20, 20], iconAnchor: [10, 10] });

function ClickHandler({ onSelect }: { onSelect?: (point: MapPoint) => void }) {
  useMapEvents({ click(event) { onSelect?.({ latitude: event.latlng.lat, longitude: event.latlng.lng }); } });
  return null;
}

function FitMarkersToView({ markers }: { markers: MapStoreMarker[] }) {
  const map = useMap();
  useEffect(() => {
    if (markers.length === 0) return;
    const bounds = L.latLngBounds(markers.map(marker => [marker.latitude, marker.longitude] as [number, number]));
    map.fitBounds(bounds, { padding: [36, 36], maxZoom: 12 });
  }, [map, markers]);
  return null;
}

function RecenterOnSelection({ selected, zoom }: { selected?: MapPoint | null; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    if (selected) map.setView([selected.latitude, selected.longitude], Math.max(zoom, 13));
  }, [map, selected?.latitude, selected?.longitude, zoom]);
  return null;
}

export default function InteractiveMapSurface({ selected, onSelect, markers = [], className = "h-72", zoom = 6 }: {
  selected?: MapPoint | null; onSelect?: (point: MapPoint) => void; markers?: MapStoreMarker[]; className?: string; zoom?: number;
}) {
  const center = selected ? [selected.latitude, selected.longitude] as [number, number] : AZERBAIJAN_CENTER;
  return <MapContainer center={center} zoom={selected ? Math.max(zoom, 13) : zoom} scrollWheelZoom className={`z-0 w-full overflow-hidden rounded-xl ${className}`}>
    <TileLayer attribution={ATTRIBUTION} url={TILE_URL} />
    <ClickHandler onSelect={onSelect} />
    {markers.length > 0 && <FitMarkersToView markers={markers} />}
    <RecenterOnSelection selected={selected} zoom={zoom} />
    {selected && <Marker position={[selected.latitude, selected.longitude]} icon={selectedIcon} draggable={Boolean(onSelect)} eventHandlers={{ dragend(event) { const point = event.target.getLatLng(); onSelect?.({ latitude: point.lat, longitude: point.lng }); } }}><Popup>Seçilmiş mövqe · marker sürüşdürülə bilər</Popup></Marker>}
    {markers.map(marker => <CircleMarker key={marker.id} center={[marker.latitude, marker.longitude]} radius={8} pathOptions={{ color: "#173c40", fillColor: "#d9a441", fillOpacity: 0.9 }}><Popup>{marker.logoUrl&&<img src={marker.logoUrl} alt="" className="mb-2 h-12 w-12 rounded-lg object-cover"/>}<b>{marker.name}</b><br/>{marker.address ? `${marker.address}, ` : ""}{marker.city}<br/><a href={`/stores/${marker.id}`}>Mağazaya bax</a></Popup></CircleMarker>)}
  </MapContainer>;
}
