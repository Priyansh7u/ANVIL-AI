"use client";

import type { Place } from "@/lib/core/types";
import { relativeTime } from "@/lib/core/freshness";
import { SEVERITY_COLOR, type HazardMapResponse } from "@/types/api";
import type { MapArea, MapMarker } from "./leaflet-map";

/** Turns the live /api/hazard-map payload into map layers. Confirmed vs approximate vs unmapped is always distinguishable. */
export function buildHazardLayers(data: HazardMapResponse | null, place: Place | null): { areas: MapArea[]; markers: MapMarker[] } {
  const areas: MapArea[] = [];
  const markers: MapMarker[] = [];
  if (data?.boundary) {
    areas.push({
      id: "district-boundary",
      polygons: data.boundary.polygons,
      color: "#94a3b8",
      label: `District boundary (${data.boundary.source})`,
      dashed: true,
      fillOpacity: 0.02,
    });
  }
  for (const h of data?.hazards ?? []) {
    if (!h.polygons.length) continue;
    areas.push({
      id: `hz-${h.id}`,
      polygons: h.polygons,
      color: SEVERITY_COLOR[h.severity],
      label: `${h.issuer}: ${h.severity === "Unknown" ? "severity not stated" : h.severity} — ${h.areaSource === "CAP_POLYGON" ? "official alert area" : "district named in alert"}`,
      detail: `${h.headline}${h.expiresAt ? ` · expires ${new Date(h.expiresAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST` : ""}`,
      dashed: h.areaSource === "DISTRICT_BOUNDARY",
      pulse: h.relevance === "DISTRICT",
      fillOpacity: h.areaSource === "CAP_POLYGON" ? 0.25 : 0.14,
    });
  }
  for (const s of data?.shelters ?? []) {
    if (s.location?.precision === "GEOCODED_ADDRESS" && s.location.lat != null && s.location.lon != null) {
      markers.push({
        id: `sh-${s.id}`,
        lat: s.location.lat,
        lon: s.location.lon,
        kind: "shelter",
        label: s.name,
        detail: `Listed on an official page, verified ${relativeTime(s.verification.evidence.retrievedAt)}. Position geocoded from published address (approximate). Availability NOT verified.`,
      });
    }
  }
  if (place?.lat != null && place.lon != null) {
    markers.push({ id: "me", lat: place.lat, lon: place.lon, kind: "place", label: place.label, detail: "Your selected area (~1 km precision)" });
  }
  return { areas, markers };
}

export function HazardLegend({ data }: { data: HazardMapResponse | null }) {
  const mapped = data?.hazards.filter((h) => h.polygons.length).length ?? 0;
  const unmapped = data?.hazards.filter((h) => !h.polygons.length).length ?? 0;
  const sheltersMapped = data?.shelters.filter((s) => s.location?.precision === "GEOCODED_ADDRESS").length ?? 0;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-4 rounded-sm bg-[#ef4444]/70" /> Official alert area (CAP polygon)</span>
      <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-4 rounded-sm border border-dashed border-[#f59e0b]" /> District named in alert (OSM boundary, approx.)</span>
      <span className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-full bg-[#2dd4bf]" /> Documented shelter ({sheltersMapped} mapped)</span>
      <span className="flex items-center gap-1"><span className="inline-block size-2.5 rounded-full bg-[#a78bfa]" /> Your area</span>
      {data ? <span>{mapped} alert area(s) drawn · {unmapped} state-level alert(s) without a published area</span> : null}
    </div>
  );
}