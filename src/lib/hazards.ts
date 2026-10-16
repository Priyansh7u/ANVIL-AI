import "server-only";
import type { Polygon } from "./core/geometry";
import type { NormalizedAlert, VerifiedRoadClosure } from "./core/types";
import { districtBoundary } from "./geo";
import { find } from "./repo";
import { attachPolygons, getAlerts, type AlertsResult } from "./sources/sachet";

/**
 * Builds the live hazard picture for a place:
 *  - active official alerts that apply to it (SACHET),
 *  - each alert's area: the official CAP polygon when published, otherwise —
 *    for alerts that name the user's district — the real district boundary
 *    from OpenStreetMap, clearly labelled as such; state-level alerts without
 *    a polygon are listed but not drawn,
 *  - road closures and documented shelters verified by the research agent.
 */

export type AreaSource = "CAP_POLYGON" | "DISTRICT_BOUNDARY" | "NOT_MAPPED";

export interface HazardArea {
  alert: NormalizedAlert;
  areaSource: AreaSource;
  polygons: Polygon[];
}

export interface HazardPicture {
  alerts: AlertsResult;
  hazards: HazardArea[];
  boundary: { polygons: Polygon[]; displayName: string } | null;
  roadClosures: VerifiedRoadClosure[];
  researchFinishedAt: string | null;
  researchTaskId: string | null;
}

export async function getHazardPicture(place: { district: string | null; state: string | null }): Promise<HazardPicture> {
  const filter: Record<string, unknown> = { kind: "AREA_BRIEFING", "place.state": place.state };
  if (place.district) filter["place.district"] = place.district;

  const [alerts, boundary, tasks] = await Promise.all([
    getAlerts(place, "local"),
    place.district ? districtBoundary(place.district, place.state) : Promise.resolve(null),
    find("ResearchTask", filter, { sortDesc: "createdAt", limit: 5 }).catch(() => []),
  ]);

  const active = alerts.alerts.filter((a) => a.freshness === "ACTIVE" && a.relevance !== "NONE");
  const withPolys = await attachPolygons(active).catch(() => active);

  const hazards: HazardArea[] = withPolys.map((alert) => {
    if (alert.polygons?.length) return { alert, areaSource: "CAP_POLYGON", polygons: alert.polygons };
    if (alert.relevance === "DISTRICT" && boundary) return { alert, areaSource: "DISTRICT_BOUNDARY", polygons: boundary.polygons };
    return { alert, areaSource: "NOT_MAPPED", polygons: [] };
  });

  const task = tasks.find((t) => t.status === "COMPLETED" || t.status === "PARTIAL");
  const result = (task?.result ?? {}) as { roadClosures?: VerifiedRoadClosure[] };

  return {
    alerts,
    hazards,
    boundary,
    roadClosures: result.roadClosures ?? [],
    researchFinishedAt: (task?.finishedAt as string | undefined) ?? null,
    researchTaskId: task?._id ?? null,
  };
}