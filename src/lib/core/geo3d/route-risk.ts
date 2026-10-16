import type { CapSeverity } from "../types";
import type { AreaGeom, Position } from "./geojson";
import { bboxOf, bboxIntersects, bboxOfPositions, distanceMeters, pointInArea } from "./spatial";

/**
 * Algorithm D — explainable route-risk scoring.
 *
 * exposureIndex = Σ over hazard areas of
 *     km of route inside the area × severity weight × source reliability × freshness factor
 *
 * It is a relative index for comparing routes, not a probability. A route
 * with no mapped hazard is "no mapped hazard found", never "safe".
 */

export interface RouteHazard {
  id: string;
  label: string;
  geometry: AreaGeom;
  severity: CapSeverity;
  sourceCategory: "OFFICIAL" | "SECONDARY" | "UNVERIFIED";
  issuedAt: string | null;
  expiresAt: string | null;
  simulated?: boolean;
  evidenceUrl?: string | null;
}

export interface RouteClosure {
  road: string;
  status: string;
  sourceUrl: string;
  retrievedAt: string;
}

export const SEVERITY_WEIGHT: Record<CapSeverity, number> = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 1 };
export const RELIABILITY: Record<RouteHazard["sourceCategory"], number> = { OFFICIAL: 1, SECONDARY: 0.6, UNVERIFIED: 0.3 };

export function freshnessFactor(issuedAt: string | null, now: Date): { factor: number; label: string } {
  if (!issuedAt) return { factor: 0.6, label: "issue time unknown" };
  const h = (now.getTime() - Date.parse(issuedAt)) / 3_600_000;
  if (h <= 6) return { factor: 1, label: "issued within 6 h" };
  if (h <= 24) return { factor: 0.8, label: "issued 6–24 h ago" };
  return { factor: 0.6, label: "issued over 24 h ago" };
}

export interface RouteFactor {
  type: "HAZARD_AREA" | "SIMULATED_AREA" | "REPORTED_CLOSURE";
  label: string;
  km?: number;
  severity?: CapSeverity;
  weight?: number;
  reliability?: number;
  freshness?: string;
  contribution?: number;
  evidenceUrl?: string | null;
}

export interface RouteRisk {
  status: "ENTERS_HAZARD_AREA" | "REPORTED_CLOSURE_ON_ROUTE" | "NO_MAPPED_HAZARD_FOUND";
  exposureIndex: number;
  kmInsideOfficial: number;
  kmInsideSimulated: number;
  routeKm: number;
  factors: RouteFactor[];
  warnings: string[];
  verifiedSafe: false;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, " ").trim();

/** Km of the path inside an area, by sampling ~every 50 m. */
export function kmInside(path: Position[], area: AreaGeom): number {
  const box = bboxOf(area);
  if (!bboxIntersects(bboxOfPositions(path), box)) return 0;
  let m = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as Position;
    const b = path[i] as Position;
    const d = distanceMeters(a, b);
    const n = Math.max(1, Math.ceil(d / 50));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      if (pointInArea([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], area)) m += d / n;
    }
  }
  return m / 1000;
}

export function scoreRoute(args: { path: Position[]; hazards: RouteHazard[]; closures: RouteClosure[]; roadNames?: string[]; unmappedAlerts?: number; now?: Date }): RouteRisk {
  const now = args.now ?? new Date();
  const factors: RouteFactor[] = [];
  const warnings: string[] = [];
  let index = 0;
  let kmOff = 0;
  let kmSim = 0;
  let routeM = 0;
  for (let i = 1; i < args.path.length; i++) routeM += distanceMeters(args.path[i - 1] as Position, args.path[i] as Position);

  let expired = 0;
  for (const h of args.hazards) {
    if (h.expiresAt && Date.parse(h.expiresAt) < now.getTime()) {
      expired++;
      continue;
    }
    const km = kmInside(args.path, h.geometry);
    if (km <= 0) continue;
    const fr = freshnessFactor(h.issuedAt, now);
    const w = SEVERITY_WEIGHT[h.severity];
    const rel = RELIABILITY[h.sourceCategory];
    const contribution = km * w * rel * fr.factor;
    if (h.simulated) {
      kmSim += km;
      factors.push({ type: "SIMULATED_AREA", label: h.label, km: round(km), contribution: round(contribution) });
      continue;
    }
    kmOff += km;
    index += contribution;
    factors.push({ type: "HAZARD_AREA", label: h.label, km: round(km), severity: h.severity, weight: w, reliability: rel, freshness: fr.label, contribution: round(contribution), evidenceUrl: h.evidenceUrl ?? null });
  }

  const names = (args.roadNames ?? []).map(norm).filter((n) => n.length >= 3);
  let closureHit = false;
  if (args.closures.length && !names.length) {
    warnings.push(`${args.closures.length} officially reported road closure(s) could not be checked: the routing provider returned no road names.`);
  }
  for (const c of args.closures) {
    const r = norm(c.road);
    if (r.length >= 3 && names.some((n) => n.includes(r) || r.includes(n))) {
      closureHit = true;
      factors.push({ type: "REPORTED_CLOSURE", label: `${c.road} — ${c.status}`, evidenceUrl: c.sourceUrl });
    }
  }

  if (!args.hazards.length) warnings.push("No hazard areas were loaded, so the route could not be checked against hazards.");
  if (expired) warnings.push(`${expired} expired alert(s) were ignored.`);
  if (args.unmappedAlerts) warnings.push(`${args.unmappedAlerts} active alert(s) have no published area and could not be checked geometrically.`);
  warnings.push("Not verified safe: conditions can change faster than any data source.");

  return {
    status: closureHit ? "REPORTED_CLOSURE_ON_ROUTE" : kmOff > 0 ? "ENTERS_HAZARD_AREA" : "NO_MAPPED_HAZARD_FOUND",
    exposureIndex: round(index),
    kmInsideOfficial: round(kmOff),
    kmInsideSimulated: round(kmSim),
    routeKm: round(routeM / 1000),
    factors: factors.sort((a, b) => (b.contribution ?? 0) - (a.contribution ?? 0)),
    warnings,
    verifiedSafe: false,
  };
}

function round(n: number) {
  return Math.round(n * 10) / 10;
}