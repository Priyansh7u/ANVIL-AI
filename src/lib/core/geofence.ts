import { SEVERITY_RANK } from "./cap";
import { circleIntersectsPolygons, type Polygon } from "./geometry";
import type { CapSeverity } from "./types";

/**
 * Smart geofenced alerts: a watch area is either a whole district, or a
 * circle around a chosen point. Matching uses ONLY official data: the alert's
 * relevance to the district (CAP area text) and, for circles, the official
 * CAP polygon or the real district boundary the alert names.
 */

export interface WatchArea {
  id: string;
  label: string;
  district: string | null;
  state: string | null;
  /** circle geofence; absent = whole district */
  center?: [number, number];
  radiusKm?: number;
  minSeverity: CapSeverity;
  includeStateLevel: boolean;
}

export interface WatchHazard {
  id: string;
  severity: CapSeverity;
  relevance: "DISTRICT" | "STATE" | "NONE";
  areaSource: "CAP_POLYGON" | "DISTRICT_BOUNDARY" | "NOT_MAPPED";
  polygons: Polygon[];
}

export type MatchReason = "INSIDE_ALERT_AREA" | "DISTRICT_NAMED" | "STATE_LEVEL";

export function matchWatchArea<T extends WatchHazard>(area: WatchArea, hazards: T[]): { hazard: T; reason: MatchReason }[] {
  const out: { hazard: T; reason: MatchReason }[] = [];
  for (const h of hazards) {
    if (SEVERITY_RANK[h.severity] < SEVERITY_RANK[area.minSeverity]) continue;
    if (area.center && area.radiusKm) {
      if (h.polygons.length && circleIntersectsPolygons(area.center, area.radiusKm, h.polygons)) {
        out.push({ hazard: h, reason: "INSIDE_ALERT_AREA" });
        continue;
      }
      if (h.areaSource === "NOT_MAPPED" && h.relevance === "DISTRICT") {
        out.push({ hazard: h, reason: "DISTRICT_NAMED" });
        continue;
      }
    } else if (h.relevance === "DISTRICT") {
      out.push({ hazard: h, reason: "DISTRICT_NAMED" });
      continue;
    }
    if (area.includeStateLevel && h.relevance === "STATE") out.push({ hazard: h, reason: "STATE_LEVEL" });
  }
  return out;
}