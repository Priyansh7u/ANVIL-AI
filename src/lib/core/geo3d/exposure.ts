import { validateGeometry, type AreaGeom, type Geom, type Position } from "./geojson";
import { bboxBuffer, bboxIntersects, bboxOf, GridIndex, intersectsPrepared, nearPrepared, prepareArea, representativePoint, type BBox, type PreparedArea } from "./spatial";

/**
 * Algorithm C — mapped-feature exposure.
 * Counts mapped features (OSM buildings, roads, facilities) whose geometry
 * actually intersects a hazard area, separately from those merely nearby.
 * This is exposure of MAPPED features, never confirmed damage: unmapped
 * buildings are invisible to it, and it says so through the coverage fields.
 */

export interface MappedFeature {
  id: string;
  category: string; // "building" | "road" | "facility" | ...
  name?: string | null;
  geometry: unknown; // untrusted; validated here
}

export interface HazardZone {
  id: string;
  label: string;
  kind: "OFFICIAL" | "SIMULATED";
  geometry: AreaGeom;
}

/**
 * A zone defined by a raster (e.g. inundated cells of the water-level model):
 * `hits` tests a geometry against the raster exactly at the raster's resolution.
 * Proximity is not computed for raster zones.
 */
export interface RasterZone {
  id: string;
  label: string;
  kind: "OFFICIAL" | "SIMULATED";
  bbox: BBox;
  hits: (g: Geom) => boolean;
}

export interface ExposedFeature {
  id: string;
  category: string;
  name: string | null;
  zoneIds: string[];
  location: Position;
  geometry: Geom;
}

export interface ExposureResult {
  evaluated: number;
  invalidGeometry: number;
  intersectingCount: number;
  nearCount: number;
  byCategory: Record<string, { evaluated: number; intersecting: number; near: number }>;
  intersecting: ExposedFeature[];
  zones: number;
  nearMeters: number;
  coverage: { featuresLoaded: number; truncated: boolean; note: string | null };
}

export function analyzeExposure(features: MappedFeature[], zones: (HazardZone | RasterZone)[], opts: { nearMeters?: number; maxFeatures?: number; coverageNote?: string | null } = {}): ExposureResult {
  const nearMeters = opts.nearMeters ?? 100;
  const max = opts.maxFeatures ?? 25_000;
  const truncated = features.length > max;
  const list = truncated ? features.slice(0, max) : features;

  const index = new GridIndex<{ zone: HazardZone | RasterZone; box: BBox; prep: PreparedArea | null }>(0.02);
  for (const z of zones) {
    const prep = "hits" in z ? null : prepareArea(z.geometry);
    const box = prep ? prep.box : (z as RasterZone).bbox;
    index.insert(bboxBuffer(box, nearMeters), { zone: z, box, prep });
  }

  const byCategory: ExposureResult["byCategory"] = {};
  const intersecting: ExposedFeature[] = [];
  let invalid = 0;
  let near = 0;
  let evaluated = 0;

  for (const f of list) {
    const v = validateGeometry(f.geometry);
    if (!v.ok) {
      invalid++;
      continue;
    }
    evaluated++;
    const cat = (byCategory[f.category] ??= { evaluated: 0, intersecting: 0, near: 0 });
    cat.evaluated++;
    const box = bboxOf(v.geom);
    const candidates = index.query(box);
    if (!candidates.length) continue;
    const geom = v.geom;
    const hits = candidates.filter((c) => (c.prep ? intersectsPrepared(geom, c.prep) : bboxIntersects(box, c.box) && (c.zone as RasterZone).hits(geom))).map((c) => c.zone.id);
    if (hits.length) {
      cat.intersecting++;
      intersecting.push({ id: f.id, category: f.category, name: f.name ?? null, zoneIds: hits, location: representativePoint(v.geom), geometry: v.geom });
      continue;
    }
    // Proximity is reported separately and never merged with intersection.
    const isNear = candidates.some((c) => (c.prep ? nearPrepared(geom, c.prep, nearMeters) : false));
    if (isNear) {
      cat.near++;
      near++;
    }
  }

  return {
    evaluated,
    invalidGeometry: invalid,
    intersectingCount: intersecting.length,
    nearCount: near,
    byCategory,
    intersecting,
    zones: zones.length,
    nearMeters,
    coverage: { featuresLoaded: features.length, truncated, note: opts.coverageNote ?? null },
  };
}

/** De-duplicate tile fragments of the same OSM feature (vector tiles split features at tile edges). */
export function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

/**
 * Vector tiles cut features at tile edges. Fragments sharing an id are merged
 * into one Multi* geometry so a feature is counted once and tested in full.
 */
export function mergeFragments(items: MappedFeature[]): MappedFeature[] {
  const byId = new Map<string, MappedFeature[]>();
  for (const it of items) {
    const arr = byId.get(it.id);
    if (arr) arr.push(it);
    else byId.set(it.id, [it]);
  }
  const out: MappedFeature[] = [];
  for (const [id, parts] of byId) {
    const first = parts[0] as MappedFeature;
    if (parts.length === 1) {
      out.push(first);
      continue;
    }
    const polys: unknown[] = [];
    const lines: unknown[] = [];
    for (const p of parts) {
      const g = p.geometry as { type?: string; coordinates?: unknown[] };
      if (g?.type === "Polygon") polys.push(g.coordinates);
      else if (g?.type === "MultiPolygon") polys.push(...(g.coordinates ?? []));
      else if (g?.type === "LineString") lines.push(g.coordinates);
      else if (g?.type === "MultiLineString") lines.push(...(g.coordinates ?? []));
    }
    const geometry = polys.length ? { type: "MultiPolygon", coordinates: polys } : lines.length ? { type: "MultiLineString", coordinates: lines } : first.geometry;
    out.push({ ...first, id, geometry });
  }
  return out;
}