import { linesOf, polygonsOf, verticesOf, type AreaGeom, type Geom, type Position, type Ring } from "./geojson";

/** Planar predicates in lon/lat space — accurate enough at district scale; distances use haversine. */

export type BBox = [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]

const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceMeters(a: Position, b: Position): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bboxOfPositions(pts: Position[]): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

export function bboxOf(g: Geom): BBox {
  return bboxOfPositions(verticesOf(g));
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/** Expand a bbox by roughly `meters` in every direction. */
export function bboxBuffer(b: BBox, meters: number): BBox {
  const dLat = meters / 111_320;
  const midLat = (b[1] + b[3]) / 2;
  const dLon = meters / (111_320 * Math.max(0.01, Math.cos(rad(midLat))));
  return [b[0] - dLon, b[1] - dLat, b[2] + dLon, b[3] + dLat];
}

/** Ray casting; points exactly on an edge may fall either way. */
export function pointInRing(p: Position, ring: Ring): boolean {
  let inside = false;
  const [x, y] = p;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as Position;
    const [xj, yj] = ring[j] as Position;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Inside the outer ring and outside every hole. */
export function pointInPolygonRings(p: Position, rings: Ring[]): boolean {
  const [outer, ...holes] = rings;
  if (!outer || !pointInRing(p, outer)) return false;
  return !holes.some((h) => pointInRing(p, h));
}

/** Algorithm A — point-in-polygon for Polygon / MultiPolygon (holes respected). */
export function pointInArea(p: Position, g: AreaGeom): boolean {
  return polygonsOf(g).some((rings) => pointInPolygonRings(p, rings));
}

function orient(a: Position, b: Position, c: Position): number {
  const v = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  return Math.abs(v) < 1e-15 ? 0 : v > 0 ? 1 : 2;
}
function onSegment(a: Position, b: Position, c: Position): boolean {
  return b[0] <= Math.max(a[0], c[0]) && b[0] >= Math.min(a[0], c[0]) && b[1] <= Math.max(a[1], c[1]) && b[1] >= Math.min(a[1], c[1]);
}

/** True when segment p1–q1 touches or crosses segment p2–q2. */
export function segmentsIntersect(p1: Position, q1: Position, p2: Position, q2: Position): boolean {
  const o1 = orient(p1, q1, p2);
  const o2 = orient(p1, q1, q2);
  const o3 = orient(p2, q2, p1);
  const o4 = orient(p2, q2, q1);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

function linesCross(a: Position[][], b: Position[][]): boolean {
  for (const la of a) {
    for (let i = 1; i < la.length; i++) {
      const p1 = la[i - 1] as Position;
      const q1 = la[i] as Position;
      for (const lb of b) {
        for (let j = 1; j < lb.length; j++) {
          if (segmentsIntersect(p1, q1, lb[j - 1] as Position, lb[j] as Position)) return true;
        }
      }
    }
  }
  return false;
}

/**
 * Algorithm B — true geometric intersection between any feature geometry and a
 * hazard area: a vertex inside the area, an area vertex inside a feature
 * polygon, or any edge crossing. Proximity alone never counts.
 */
export function intersectsArea(g: Geom, area: AreaGeom, areaBox: BBox = bboxOf(area)): boolean {
  if (!bboxIntersects(bboxOf(g), areaBox)) return false;
  if (verticesOf(g).some((p) => pointInArea(p, area))) return true;
  if (g.type === "Point") return false;
  if (g.type === "Polygon" || g.type === "MultiPolygon") {
    if (verticesOf(area).some((p) => pointInArea(p, g))) return true;
  }
  return linesCross(linesOf(g), linesOf(area));
}

/** Approximate distance (m) from a point to a segment using a local equirectangular projection. */
export function pointToSegmentMeters(p: Position, a: Position, b: Position): number {
  const k = Math.cos(rad(p[1]));
  const ax = (a[0] - p[0]) * k;
  const ay = a[1] - p[1];
  const bx = (b[0] - p[0]) * k;
  const by = b[1] - p[1];
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return Math.sqrt(x * x + y * y) * 111_320;
}

/** Distance (m) from a point to an area's boundary; 0 when the point is inside. */
export function distanceToAreaMeters(p: Position, area: AreaGeom): number {
  if (pointInArea(p, area)) return 0;
  let best = Infinity;
  for (const ring of linesOf(area)) {
    for (let i = 1; i < ring.length; i++) best = Math.min(best, pointToSegmentMeters(p, ring[i - 1] as Position, ring[i] as Position));
  }
  return best;
}

export function representativePoint(g: Geom): Position {
  const v = verticesOf(g);
  const b = bboxOfPositions(v);
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
}

/** Length of a line in metres. */
export function lineLengthMeters(line: Position[]): number {
  let m = 0;
  for (let i = 1; i < line.length; i++) m += distanceMeters(line[i - 1] as Position, line[i] as Position);
  return m;
}

/** Fixed-cell grid index over bboxes: cheap candidate lookup so features aren't tested against every zone. */
export class GridIndex<T> {
  private cells = new Map<string, T[]>();
  constructor(private cellDeg = 0.05) {}
  private keys(b: BBox): string[] {
    const out: string[] = [];
    const x0 = Math.floor(b[0] / this.cellDeg);
    const x1 = Math.floor(b[2] / this.cellDeg);
    const y0 = Math.floor(b[1] / this.cellDeg);
    const y1 = Math.floor(b[3] / this.cellDeg);
    // Guard against huge boxes flooding the index.
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 40_000) return ["*"];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(`${x}:${y}`);
    return out;
  }
  insert(b: BBox, item: T) {
    for (const k of this.keys(b)) {
      const arr = this.cells.get(k);
      if (arr) arr.push(item);
      else this.cells.set(k, [item]);
    }
  }
  query(b: BBox): T[] {
    const seen = new Set<T>();
    for (const k of [...this.keys(b), "*"]) for (const it of this.cells.get(k) ?? []) seen.add(it);
    return Array.from(seen);
  }
}

/** A circle as a 64-gon polygon (for hypothetical hazard zones). */
export function circlePolygon(center: Position, radiusM: number, steps = 64): Ring {
  const ring: Ring = [];
  const lat = rad(center[1]);
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    const dx = (radiusM * Math.cos(a)) / (111_320 * Math.cos(lat));
    const dy = (radiusM * Math.sin(a)) / 111_320;
    ring.push([center[0] + dx, center[1] + dy]);
  }
  ring[ring.length - 1] = ring[0] as Position;
  return ring;
}

/** Web-Mercator slippy-tile coordinates (fractional) for a lon/lat at zoom z. */
export function lonLatToTile(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const latR = rad(Math.max(-85.0511, Math.min(85.0511, lat)));
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n };
}

/**
 * A hazard area pre-processed for many queries: its bbox plus a grid index of
 * its edges, so each feature is only compared with the few edges near it.
 */
export interface PreparedArea {
  area: AreaGeom;
  box: BBox;
  edges: GridIndex<[Position, Position]>;
  /** Edges bucketed into horizontal bands for fast even-odd point tests. */
  bands: [Position, Position][][];
}

const BANDS = 256;

export function prepareArea(area: AreaGeom): PreparedArea {
  const box = bboxOf(area);
  const span = Math.max(box[2] - box[0], box[3] - box[1]);
  const edges = new GridIndex<[Position, Position]>(Math.max(0.002, span / 64));
  for (const ring of linesOf(area)) {
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1] as Position;
      const b = ring[i] as Position;
      edges.insert([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])], [a, b]);
    }
  }
  const bands: [Position, Position][][] = Array.from({ length: BANDS }, () => []);
  const h = box[3] - box[1] || 1e-9;
  for (const ring of linesOf(area)) {
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1] as Position;
      const b = ring[i] as Position;
      const lo = Math.max(0, Math.floor(((Math.min(a[1], b[1]) - box[1]) / h) * BANDS));
      const hi = Math.min(BANDS - 1, Math.floor(((Math.max(a[1], b[1]) - box[1]) / h) * BANDS));
      for (let k = lo; k <= hi; k++) (bands[k] as [Position, Position][]).push([a, b]);
    }
  }
  return { area, box, edges, bands };
}

/**
 * Even-odd point test using only the edges in the point's band. For valid
 * (non-overlapping) polygons this equals pointInArea, holes included.
 */
export function pointInPrepared(pt: Position, p: PreparedArea): boolean {
  const [x, y] = pt;
  if (x < p.box[0] || x > p.box[2] || y < p.box[1] || y > p.box[3]) return false;
  const h = p.box[3] - p.box[1] || 1e-9;
  const band = p.bands[Math.min(BANDS - 1, Math.max(0, Math.floor(((y - p.box[1]) / h) * BANDS)))] ?? [];
  let inside = false;
  for (const [[xi, yi], [xj, yj]] of band) {
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Same result as intersectsArea, using the edge index. */
export function intersectsPrepared(g: Geom, p: PreparedArea): boolean {
  const gb = bboxOf(g);
  if (!bboxIntersects(gb, p.box)) return false;
  // One vertex per connected part decides containment unless edges cross, which is tested next.
  const firsts = (x: Geom): Position[] => (x.type === "Point" ? [x.coordinates] : linesOf(x).map((l) => l[0] as Position));
  if (firsts(g).some((q) => pointInPrepared(q, p))) return true;
  if ((g.type === "Polygon" || g.type === "MultiPolygon") && firsts(p.area).some((q) => pointInArea(q, g))) return true;
  const near = p.edges.query(gb);
  if (!near.length) return false;
  for (const line of linesOf(g)) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1] as Position;
      const b = line[i] as Position;
      for (const [c, d] of near) if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

/** Whether any vertex of g lies within `meters` of the area's boundary (g assumed not intersecting). */
export function nearPrepared(g: Geom, p: PreparedArea, meters: number): boolean {
  const gb = bboxBuffer(bboxOf(g), meters);
  if (!bboxIntersects(gb, p.box)) return false;
  const near = p.edges.query(gb);
  if (!near.length) return false;
  const verts = verticesOf(g);
  const step = Math.max(1, Math.floor(verts.length / 40));
  for (let i = 0; i < verts.length; i += step) {
    const v = verts[i] as Position;
    for (const [c, d] of near) if (pointToSegmentMeters(v, c, d) <= meters) return true;
  }
  return false;
}