/**
 * Minimal, dependency-free GeoJSON geometry types and validation for the 3D
 * map. All positions are GeoJSON order: [longitude, latitude] in WGS84
 * (EPSG:4326). Anything that fails validation is counted and skipped — never
 * "fixed" by guessing, except closing an unclosed ring (reported as repaired).
 */

export type Position = [number, number];
export type Ring = Position[];

export interface PointGeom {
  type: "Point";
  coordinates: Position;
}
export interface LineGeom {
  type: "LineString";
  coordinates: Position[];
}
export interface MultiLineGeom {
  type: "MultiLineString";
  coordinates: Position[][];
}
export interface PolygonGeom {
  type: "Polygon";
  coordinates: Ring[];
}
export interface MultiPolygonGeom {
  type: "MultiPolygon";
  coordinates: Ring[][];
}
export type Geom = PointGeom | LineGeom | MultiLineGeom | PolygonGeom | MultiPolygonGeom;
export type AreaGeom = PolygonGeom | MultiPolygonGeom;

export type ValidationResult = { ok: true; geom: Geom; repaired: boolean } | { ok: false; reason: string };

export function isValidPosition(p: unknown): p is Position {
  return (
    Array.isArray(p) &&
    p.length >= 2 &&
    typeof p[0] === "number" &&
    typeof p[1] === "number" &&
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1]) &&
    p[0] >= -180 &&
    p[0] <= 180 &&
    p[1] >= -90 &&
    p[1] <= 90
  );
}

function cleanPositions(arr: unknown): Position[] | null {
  if (!Array.isArray(arr)) return null;
  const out: Position[] = [];
  for (const p of arr) {
    if (!isValidPosition(p)) return null;
    out.push([p[0], p[1]]);
  }
  return out;
}

function cleanRing(arr: unknown): { ring: Ring; repaired: boolean } | null {
  const pts = cleanPositions(arr);
  if (!pts || pts.length < 3) return null;
  const first = pts[0] as Position;
  const last = pts[pts.length - 1] as Position;
  let repaired = false;
  if (first[0] !== last[0] || first[1] !== last[1]) {
    pts.push([first[0], first[1]]);
    repaired = true;
  }
  // A closed ring needs at least 4 positions (triangle + closing point).
  if (pts.length < 4) return null;
  return { ring: pts, repaired };
}

function cleanPolygon(arr: unknown): { rings: Ring[]; repaired: boolean } | null {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const rings: Ring[] = [];
  let repaired = false;
  for (const r of arr) {
    const c = cleanRing(r);
    if (!c) return null;
    rings.push(c.ring);
    repaired ||= c.repaired;
  }
  return { rings, repaired };
}

/** Validate an untrusted geometry object. Self-intersection is not checked. */
export function validateGeometry(g: unknown): ValidationResult {
  if (!g || typeof g !== "object") return { ok: false, reason: "not an object" };
  const { type, coordinates } = g as { type?: unknown; coordinates?: unknown };
  switch (type) {
    case "Point":
      return isValidPosition(coordinates) ? { ok: true, geom: { type, coordinates: [coordinates[0], coordinates[1]] }, repaired: false } : { ok: false, reason: "invalid point" };
    case "LineString": {
      const pts = cleanPositions(coordinates);
      return pts && pts.length >= 2 ? { ok: true, geom: { type, coordinates: pts }, repaired: false } : { ok: false, reason: "invalid line" };
    }
    case "MultiLineString": {
      if (!Array.isArray(coordinates) || !coordinates.length) return { ok: false, reason: "invalid multiline" };
      const lines: Position[][] = [];
      for (const l of coordinates) {
        const pts = cleanPositions(l);
        if (!pts || pts.length < 2) return { ok: false, reason: "invalid multiline part" };
        lines.push(pts);
      }
      return { ok: true, geom: { type, coordinates: lines }, repaired: false };
    }
    case "Polygon": {
      const p = cleanPolygon(coordinates);
      return p ? { ok: true, geom: { type, coordinates: p.rings }, repaired: p.repaired } : { ok: false, reason: "invalid polygon" };
    }
    case "MultiPolygon": {
      if (!Array.isArray(coordinates) || !coordinates.length) return { ok: false, reason: "invalid multipolygon" };
      const polys: Ring[][] = [];
      let repaired = false;
      for (const part of coordinates) {
        const p = cleanPolygon(part);
        if (!p) return { ok: false, reason: "invalid multipolygon part" };
        polys.push(p.rings);
        repaired ||= p.repaired;
      }
      return { ok: true, geom: { type, coordinates: polys }, repaired };
    }
    default:
      return { ok: false, reason: `unsupported type ${String(type)}` };
  }
}

/** ANVIL's existing APIs return rings as [lat, lon]; convert to GeoJSON polygons, validating each. */
export function latLonRingsToPolygons(rings: unknown): { polygons: PolygonGeom[]; invalid: number } {
  const polygons: PolygonGeom[] = [];
  let invalid = 0;
  if (!Array.isArray(rings)) return { polygons, invalid: 0 };
  for (const r of rings) {
    if (!Array.isArray(r)) {
      invalid++;
      continue;
    }
    const swapped = r.map((p) => (Array.isArray(p) ? [p[1], p[0]] : p));
    const v = validateGeometry({ type: "Polygon", coordinates: [swapped] });
    if (v.ok && v.geom.type === "Polygon") polygons.push(v.geom);
    else invalid++;
  }
  return { polygons, invalid };
}

export function polygonsOf(g: AreaGeom): Ring[][] {
  return g.type === "Polygon" ? [g.coordinates] : g.coordinates;
}

/** Every vertex of a geometry (used for bboxes and proximity). */
export function verticesOf(g: Geom): Position[] {
  switch (g.type) {
    case "Point":
      return [g.coordinates];
    case "LineString":
      return g.coordinates;
    case "MultiLineString":
      return g.coordinates.flat();
    case "Polygon":
      return g.coordinates.flat();
    case "MultiPolygon":
      return g.coordinates.flat(2);
  }
}

/** Line parts of a geometry (polygon rings count as closed lines). */
export function linesOf(g: Geom): Position[][] {
  switch (g.type) {
    case "Point":
      return [];
    case "LineString":
      return [g.coordinates];
    case "MultiLineString":
      return g.coordinates;
    case "Polygon":
      return g.coordinates;
    case "MultiPolygon":
      return g.coordinates.flat();
  }
}