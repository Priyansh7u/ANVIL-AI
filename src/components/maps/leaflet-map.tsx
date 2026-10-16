"use client";

import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { Circle, CircleMarker, MapContainer, Polygon, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";

export interface MapMarker {
  id: string;
  lat: number;
  lon: number;
  label: string;
  detail?: string;
  kind: "shelter" | "shelter-unmapped" | "origin" | "destination" | "place" | "closed" | "facility";
  /** Overrides the kind colour (e.g. facility categories). */
  color?: string;
  /** Draw larger and with a highlight ring (selected item). */
  highlight?: boolean;
  onClick?: () => void;
}

export interface MapArea {
  id: string;
  polygons: [number, number][][];
  color: string;
  label: string;
  detail?: string;
  dashed?: boolean;
  pulse?: boolean;
  fillOpacity?: number;
}

export interface MapCircle {
  id: string;
  center: [number, number];
  radiusKm: number;
  color: string;
  label: string;
  detail?: string;
  fillOpacity?: number;
  dashed?: boolean;
}

export interface MapPath {
  id: string;
  path: [number, number][];
  color: string;
  weight?: number;
  dashed?: boolean;
  label?: string;
  onClick?: () => void;
}

const COLORS: Record<MapMarker["kind"], string> = {
  shelter: "#2dd4bf",
  "shelter-unmapped": "#94a3b8",
  origin: "#60a5fa",
  destination: "#f59e0b",
  place: "#a78bfa",
  closed: "#ef4444",
  facility: "#f472b6",
};

function ClickHandler({ onClick }: { onClick?: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onClick?.(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function FitTo({ points }: { points: [number, number][] }) {
  const map = useMap();
  // Re-fit only when the set of points actually changes, not on every render.
  const key = points.map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).join(";");
  useEffect(() => {
    if (!key) return;
    const pts = key.split(";").map((s) => s.split(",").map(Number) as [number, number]);
    if (pts.length >= 2) map.fitBounds(pts, { padding: [30, 30], maxZoom: 14 });
    else if (pts[0]) map.setView(pts[0], 11);
  }, [map, key]);
  return null;
}

/** Vector-only map layers: no image marker assets to download on slow connections. */
export default function LeafletMap({
  center,
  zoom = 10,
  markers = [],
  areas = [],
  circles = [],
  path,
  paths = [],
  tileUrl,
  attribution,
  onMapClick,
  className,
  fitToAreas = true,
}: {
  center: [number, number];
  zoom?: number;
  markers?: MapMarker[];
  areas?: MapArea[];
  circles?: MapCircle[];
  path?: [number, number][];
  paths?: MapPath[];
  tileUrl: string;
  attribution: string;
  onMapClick?: (lat: number, lon: number) => void;
  className?: string;
  fitToAreas?: boolean;
}) {
  const fitPoints: [number, number][] =
    path && path.length > 1
      ? path
      : paths.length
        ? paths.flatMap((p) => p.path.filter((_, i) => i % 10 === 0))
        : [
          ...markers.map((m) => [m.lat, m.lon] as [number, number]),
          ...(fitToAreas ? areas.flatMap((a) => a.polygons.flatMap((p) => p.filter((_, i) => i % 25 === 0))) : []),
        ];
  return (
    <MapContainer center={center} zoom={zoom} className={className ?? "h-[420px] w-full rounded-lg"} scrollWheelZoom={false}>
      <TileLayer url={tileUrl} attribution={attribution} />
      <ClickHandler onClick={onMapClick} />
      <FitTo points={fitPoints} />
      {areas.map((a) =>
        a.polygons.map((poly, i) => (
          <Polygon
            key={`${a.id}-${i}`}
            positions={poly}
            pathOptions={{
              color: a.color,
              weight: 2,
              fillColor: a.color,
              fillOpacity: a.fillOpacity ?? 0.2,
              dashArray: a.dashed ? "6 6" : undefined,
              className: a.pulse ? "hazard-area-pulse" : undefined,
            }}
          >
            <Tooltip sticky>{a.label}</Tooltip>
            {a.detail ? (
              <Popup>
                <strong>{a.label}</strong>
                <div style={{ fontSize: 12, marginTop: 4 }}>{a.detail}</div>
              </Popup>
            ) : null}
          </Polygon>
        )),
      )}
      {circles.map((c) => (
        <Circle
          key={c.id}
          center={c.center}
          radius={c.radiusKm * 1000}
          pathOptions={{ color: c.color, weight: c.dashed === false ? 1.5 : 2, fillColor: c.color, fillOpacity: c.fillOpacity ?? 0.08, dashArray: c.dashed === false ? undefined : "4 6" }}
        >
          <Tooltip>{c.label}</Tooltip>
          {c.detail ? (
            <Popup>
              <strong>{c.label}</strong>
              <div style={{ fontSize: 12, marginTop: 4 }}>{c.detail}</div>
            </Popup>
          ) : null}
        </Circle>
      ))}
      {paths.map((p) => (
        <Polyline
          key={p.id}
          positions={p.path}
          pathOptions={{ color: p.color, weight: p.weight ?? 4, opacity: 0.85, dashArray: p.dashed ? "8 8" : undefined }}
          eventHandlers={p.onClick ? { click: p.onClick } : undefined}
        >
          {p.label ? <Tooltip sticky>{p.label}</Tooltip> : null}
        </Polyline>
      ))}
      {path && path.length > 1 ? <Polyline positions={path} pathOptions={{ color: "#60a5fa", weight: 5, opacity: 0.9 }} /> : null}
      {markers.map((m) => (
        <CircleMarker
          key={m.id}
          center={[m.lat, m.lon]}
          radius={m.highlight ? 12 : m.kind === "place" ? 7 : 8}
          pathOptions={{ color: m.highlight ? "#ffffff" : "#0b1220", weight: m.highlight ? 3 : 2, fillColor: m.color ?? COLORS[m.kind], fillOpacity: 0.95 }}
          eventHandlers={m.onClick ? { click: m.onClick } : undefined}
        >
          <Popup>
            <strong>{m.label}</strong>
            {m.detail ? <div style={{ fontSize: 12, marginTop: 4 }}>{m.detail}</div> : null}
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}