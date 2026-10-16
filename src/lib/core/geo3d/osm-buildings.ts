import { validateGeometry, type Position } from "./geojson";

/**
 * Live OpenStreetMap buildings from the Overpass API (minutes behind OSM
 * edits). Heights come only from OSM tags; when a building has none, it is
 * drawn at a default height and marked as such — never presented as measured.
 */

export const MAX_LIVE_SPAN_DEG = 0.03; // ~3 km: keeps Overpass responses small
export const LIVE_LIMIT = 6000;
export const DEFAULT_HEIGHT_M = 6;
export const METERS_PER_LEVEL = 3.2;

export function liveBuildingsQuery(b: { west: number; south: number; east: number; north: number }): string {
  const bb = `${b.south.toFixed(5)},${b.west.toFixed(5)},${b.north.toFixed(5)},${b.east.toFixed(5)}`;
  return `[out:json][timeout:25];(way["building"](${bb});way["building:part"](${bb}););out meta geom ${LIVE_LIMIT};`;
}

/** Parse OSM length values: "12", "12.5 m", "40 ft", "12;14" (first). Returns metres or null. */
export function parseLength(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.split(";")[0]?.trim().toLowerCase() ?? "";
  const ft = s.match(/^(\d+(?:\.\d+)?)\s*(?:ft|feet|')$/);
  if (ft) return Math.round(Number(ft[1]) * 0.3048 * 10) / 10;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(?:m|metre|meter|metres|meters)?$/);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) && v > 0 && v < 1000 ? v : null;
}

export type HeightSource = "height tag" | "levels tag" | "default";

export function buildingHeight(tags: Record<string, string>): { height: number; minHeight: number; source: HeightSource; levels: number | null } {
  const levelsRaw = Number(tags["building:levels"]);
  const levels = Number.isFinite(levelsRaw) && levelsRaw > 0 && levelsRaw < 200 ? levelsRaw : null;
  const minLevel = Number(tags["building:min_level"]);
  const minHeight = parseLength(tags.min_height) ?? (Number.isFinite(minLevel) && minLevel > 0 ? minLevel * METERS_PER_LEVEL : 0);
  const h = parseLength(tags.height);
  if (h !== null) return { height: Math.max(h, minHeight + 1), minHeight, source: "height tag", levels };
  if (levels !== null) return { height: Math.max(levels * METERS_PER_LEVEL, minHeight + 1), minHeight, source: "levels tag", levels };
  return { height: Math.max(DEFAULT_HEIGHT_M, minHeight + 1), minHeight, source: "default", levels: null };
}

export interface LiveBuildingFeature {
  type: "Feature";
  id: number;
  properties: { osmId: string; height: number; minHeight: number; heightSource: HeightSource; levels: number | null; name: string | null; edited: string | null; part: boolean };
  geometry: { type: "Polygon"; coordinates: Position[][] };
}

export interface LiveBuildings {
  type: "FeatureCollection";
  features: LiveBuildingFeature[];
  summary: { count: number; truncated: boolean; withHeightTag: number; withLevels: number; newestEdit: string | null; invalid: number };
}

interface OverpassWay {
  type?: string;
  id?: number;
  timestamp?: string;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

export function overpassToBuildings(json: unknown): LiveBuildings {
  const els = (json as { elements?: OverpassWay[] })?.elements;
  const features: LiveBuildingFeature[] = [];
  let invalid = 0;
  let newest: string | null = null;
  if (Array.isArray(els)) {
    for (const e of els) {
      if (e.type !== "way" || typeof e.id !== "number" || !Array.isArray(e.geometry)) continue;
      const ring = e.geometry.map((p) => [p.lon, p.lat]);
      const v = validateGeometry({ type: "Polygon", coordinates: [ring] });
      if (!v.ok || v.geom.type !== "Polygon") {
        invalid++;
        continue;
      }
      const tags = e.tags ?? {};
      const h = buildingHeight(tags);
      if (e.timestamp && (!newest || e.timestamp > newest)) newest = e.timestamp;
      features.push({
        type: "Feature",
        id: e.id,
        properties: { osmId: `way/${e.id}`, height: h.height, minHeight: h.minHeight, heightSource: h.source, levels: h.levels, name: tags.name ?? null, edited: e.timestamp ?? null, part: Boolean(tags["building:part"]) && !tags.building },
        geometry: { type: "Polygon", coordinates: v.geom.coordinates },
      });
    }
  }
  return {
    type: "FeatureCollection",
    features,
    summary: {
      count: features.length,
      truncated: Array.isArray(els) && els.length >= LIVE_LIMIT,
      withHeightTag: features.filter((f) => f.properties.heightSource === "height tag").length,
      withLevels: features.filter((f) => f.properties.heightSource === "levels tag").length,
      newestEdit: newest,
      invalid,
    },
  };
}

/** Clamp a view to the live-query limit around its centre. */
export function clampLiveBox(b: { west: number; south: number; east: number; north: number }): { west: number; south: number; east: number; north: number } {
  const cx = (b.west + b.east) / 2;
  const cy = (b.south + b.north) / 2;
  const hw = Math.min(MAX_LIVE_SPAN_DEG, b.east - b.west) / 2;
  const hh = Math.min(MAX_LIVE_SPAN_DEG, b.north - b.south) / 2;
  return { west: cx - hw, east: cx + hw, south: cy - hh, north: cy + hh };
}