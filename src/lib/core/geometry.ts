/**
 * Dependency-free geometry for hazard areas, routes and geofences.
 * Coordinates are [lat, lon] everywhere in ANVIL (Leaflet order).
 */

export type LatLon = [number, number];
export type Polygon = LatLon[];

/** India + neighbourhood bounding box, used to detect coordinate order and reject garbage. */
const INDIA = { minLat: 5, maxLat: 38.5, minLon: 67, maxLon: 98.5 };

function inIndia([lat, lon]: LatLon): boolean {
  return lat >= INDIA.minLat && lat <= INDIA.maxLat && lon >= INDIA.minLon && lon <= INDIA.maxLon;
}

export function haversineKm(a: LatLon, b: LatLon): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Keep at most `max` points by uniform sampling (keeps rendering and hit-tests fast). */
export function simplify(poly: Polygon, max = 1500): Polygon {
  if (poly.length <= max) return poly;
  const step = poly.length / max;
  const out: Polygon = [];
  for (let i = 0; i < max; i++) out.push(poly[Math.floor(i * step)] as LatLon);
  return out;
}

/**
 * Parse a list of coordinate pairs from text. Accepts the CAP form
 * "lat,lon lat,lon …" and the KML form "lon,lat[,alt] lon,lat[,alt] …".
 * Order is decided from the data itself (India bounding box); anything that
 * cannot be placed inside India is rejected rather than guessed.
 */
export function parseCoordinateText(text: string): Polygon | null {
  const tuples = text
    .trim()
    .split(/\s+/)
    .map((t) => t.split(",").map(Number))
    .filter((n) => n.length >= 2 && n.every((x) => Number.isFinite(x)));
  if (tuples.length < 3) return null;
  const asLatLon = tuples.map((n) => [n[0], n[1]] as LatLon);
  const asLonLat = tuples.map((n) => [n[1], n[0]] as LatLon);
  const scoreA = asLatLon.filter(inIndia).length;
  const scoreB = asLonLat.filter(inIndia).length;
  const best = scoreA >= scoreB ? asLatLon : asLonLat;
  const valid = best.filter(inIndia);
  if (valid.length < 3 || valid.length < best.length * 0.9) return null;
  return simplify(valid);
}

/** Extract polygons from a CAP <polygon> or KML <coordinates> XML document. */
export function parsePolygonXml(xml: string): Polygon[] {
  const out: Polygon[] = [];
  // Content must be plain text (no nested tags), so a KML <Polygon> wrapper is skipped and its <coordinates> used.
  const re = /<(?:[A-Za-z_][\w.-]*:)?(polygon|coordinates)(?:\s[^>]*)?>([^<]*)<\/(?:[A-Za-z_][\w.-]*:)?\1\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null && out.length < 50) {
    const poly = parseCoordinateText(m[2] ?? "");
    if (poly) out.push(poly);
  }
  return out;
}

/** GeoJSON Polygon / MultiPolygon (lon,lat) → outer rings as [lat,lon]. */
export function geojsonToPolygons(g: unknown): Polygon[] {
  const geo = g as { type?: string; coordinates?: unknown };
  const ring = (r: unknown): Polygon | null => {
    if (!Array.isArray(r)) return null;
    const pts = r
      .filter((p): p is number[] => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .map((p) => [p[1], p[0]] as LatLon);
    return pts.length >= 3 ? simplify(pts) : null;
  };
  if (geo?.type === "Polygon" && Array.isArray(geo.coordinates)) {
    const r = ring(geo.coordinates[0]);
    return r ? [r] : [];
  }
  if (geo?.type === "MultiPolygon" && Array.isArray(geo.coordinates)) {
    return (geo.coordinates as unknown[])
      .map((p) => (Array.isArray(p) ? ring(p[0]) : null))
      .filter((p): p is Polygon => p !== null);
  }
  return [];
}

/** Ray-casting point-in-polygon (lon as x, lat as y). */
export function pointInPolygon([lat, lon]: LatLon, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i] as LatLon;
    const [yj, xj] = poly[j] as LatLon;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

export function pointInAny(p: LatLon, polys: Polygon[]): boolean {
  return polys.some((poly) => pointInPolygon(p, poly));
}

/** Distance (km) from point p to segment ab, using a local equirectangular projection. */
function pointSegmentKm(p: LatLon, a: LatLon, b: LatLon): number {
  const kx = 111.32 * Math.cos((p[0] * Math.PI) / 180);
  const ky = 110.57;
  const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky;
  const bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.sqrt(cx * cx + cy * cy);
}

/** True if a circle (geofence) overlaps any polygon. */
export function circleIntersectsPolygons(center: LatLon, radiusKm: number, polys: Polygon[]): boolean {
  if (pointInAny(center, polys)) return true;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if (pointSegmentKm(center, poly[j] as LatLon, poly[i] as LatLon) <= radiusKm) return true;
    }
  }
  return false;
}

export interface HazardArea {
  id: string;
  polygons: Polygon[];
}

/**
 * Which hazard areas does a route path enter? Samples at most ~600 points.
 * Returns the hazard id and the approximate distance along the route (km) of first entry.
 */
export function routeHazardCrossings(path: LatLon[], areas: HazardArea[]): { id: string; atKm: number }[] {
  if (path.length === 0) return [];
  const step = Math.max(1, Math.floor(path.length / 600));
  const hits: { id: string; atKm: number }[] = [];
  for (const area of areas) {
    if (area.polygons.length === 0) continue;
    let travelled = 0;
    for (let i = 0; i < path.length; i += step) {
      if (i > 0) travelled += haversineKm(path[i - step] as LatLon, path[i] as LatLon);
      if (pointInAny(path[i] as LatLon, area.polygons)) {
        hits.push({ id: area.id, atKm: Math.round(travelled * 10) / 10 });
        break;
      }
    }
  }
  return hits.sort((a, b) => a.atKm - b.atKm);
}

/**
 * Kilometres of a route that lie inside any of the given polygons.
 * Each segment is classified by its midpoint; the path is resampled to at most ~800 segments.
 */
export function routeExposureKm(path: LatLon[], polys: Polygon[]): number {
  if (path.length < 2 || polys.length === 0) return 0;
  const step = Math.max(1, Math.floor(path.length / 800));
  let km = 0;
  for (let i = step; i < path.length; i += step) {
    const a = path[i - step] as LatLon;
    const b = path[i] as LatLon;
    const mid: LatLon = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (pointInAny(mid, polys)) km += haversineKm(a, b);
  }
  return Math.round(km * 10) / 10;
}

export interface RouteOption {
  distanceKm: number;
  durationMin: number;
  path: LatLon[];
}

/**
 * Ranks alternative routes by hazard exposure (km inside active official alert
 * areas, weighted by severity), then by duration. Lower is better. This only
 * reduces known exposure — it never makes a route "safe".
 */
export function rankRoutesByExposure<T extends RouteOption>(
  routes: T[],
  areas: { polygons: Polygon[]; weight: number }[],
): (T & { exposureKm: number; weightedExposure: number })[] {
  return routes
    .map((r) => {
      let exposureKm = 0;
      let weighted = 0;
      for (const a of areas) {
        const km = routeExposureKm(r.path, a.polygons);
        exposureKm += km;
        weighted += km * a.weight;
      }
      return { ...r, exposureKm: Math.round(exposureKm * 10) / 10, weightedExposure: Math.round(weighted * 10) / 10 };
    })
    .sort((a, b) => a.weightedExposure - b.weightedExposure || a.durationMin - b.durationMin);
}