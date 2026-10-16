import { describe, expect, it } from "vitest";
import {
  circleIntersectsPolygons,
  geojsonToPolygons,
  haversineKm,
  parseCoordinateText,
  parsePolygonXml,
  pointInPolygon,
  routeHazardCrossings,
  type Polygon,
} from "../../src/lib/core/geometry";
import { buildNextSteps, computePriority } from "../../src/lib/core/next-steps";
import { diffLive, planLive, type LiveShelter } from "../../src/lib/core/live-sim";
import { verifyExtraction } from "../../src/lib/core/verify";
import type { NormalizedAlert } from "../../src/lib/core/types";

// A square roughly around central Patna.
const PATNA: Polygon = [
  [25.55, 85.05],
  [25.55, 85.25],
  [25.65, 85.25],
  [25.65, 85.05],
];

describe("hazard geometry", () => {
  it("parses CAP lat,lon and KML lon,lat,alt coordinate text to the same polygon", () => {
    const cap = parseCoordinateText("25.55,85.05 25.55,85.25 25.65,85.25 25.65,85.05 25.55,85.05");
    const kml = parseCoordinateText("85.05,25.55,0 85.25,25.55,0 85.25,25.65,0 85.05,25.65,0 85.05,25.55,0");
    expect(cap).toEqual(kml);
    expect(cap?.[0]).toEqual([25.55, 85.05]);
  });
  it("rejects coordinates outside India instead of guessing", () => {
    expect(parseCoordinateText("51.5,-0.1 51.6,-0.1 51.6,0.1")).toBeNull();
  });
  it("extracts polygons from CAP and KML documents", () => {
    expect(parsePolygonXml("<cap:area><cap:polygon>25.55,85.05 25.55,85.25 25.65,85.25 25.55,85.05</cap:polygon></cap:area>")).toHaveLength(1);
    expect(parsePolygonXml("<kml><Polygon><coordinates>85.05,25.55 85.25,25.55 85.25,25.65 85.05,25.55</coordinates></Polygon></kml>")).toHaveLength(1);
    expect(parsePolygonXml("<html>error</html>")).toHaveLength(0);
  });
  it("converts GeoJSON (lon,lat) to [lat,lon] rings", () => {
    const polys = geojsonToPolygons({ type: "MultiPolygon", coordinates: [[[[85.05, 25.55], [85.25, 25.55], [85.25, 25.65], [85.05, 25.55]]]] });
    expect(polys[0]?.[1]).toEqual([25.55, 85.25]);
  });
  it("detects points, routes and geofences inside hazard areas", () => {
    expect(pointInPolygon([25.6, 85.1], PATNA)).toBe(true);
    expect(pointInPolygon([25.8, 85.1], PATNA)).toBe(false);
    const route: [number, number][] = [[25.4, 85.1], [25.5, 85.1], [25.6, 85.1], [25.7, 85.1]];
    const hits = routeHazardCrossings(route, [{ id: "A1", polygons: [PATNA] }, { id: "A2", polygons: [] }]);
    expect(hits.map((h) => h.id)).toEqual(["A1"]);
    expect(hits[0]!.atKm).toBeGreaterThan(10);
    expect(circleIntersectsPolygons([25.7, 85.1], 10, [PATNA])).toBe(true); // ~5.5 km from edge
    expect(circleIntersectsPolygons([26.2, 85.1], 10, [PATNA])).toBe(false);
    expect(Math.round(haversineKm([28.61, 77.21], [25.59, 85.14]))).toBeGreaterThan(800);
  });
});

const alert = (o: Partial<NormalizedAlert>): NormalizedAlert => ({
  id: "x1", source: "SACHET_CAP", issuer: "IMD Patna", headline: "Heavy rain likely", event: "Heavy Rain", hazard: "heavy_rain",
  severity: "Severe", urgency: "Immediate", certainty: "Likely", areaDesc: "Patna", instruction: "Stay indoors and avoid waterlogged roads.",
  issuedAt: "2026-10-14T05:00:00Z", effectiveAt: null, expiresAt: "2026-10-14T08:00:00Z", retrievedAt: "2026-10-14T06:00:00Z",
  capUrl: "https://sachet.ndma.gov.in/cap_public_website/FetchXMLFile?identifier=x1", freshness: "ACTIVE", relevance: "DISTRICT", partial: false, ...o,
});

describe("next-steps engine", () => {
  const now = new Date("2026-10-14T06:30:00Z");
  it("puts verbatim official instructions first and defers guidance below them", () => {
    const ns = buildNextSteps({ alerts: [alert({})], feedMode: "LIVE", feedRetrievedAt: "2026-10-14T06:25:00Z", placeLabel: "Patna, Bihar", now });
    expect(ns.priority).toBe("ACT_NOW");
    expect(ns.actions[0]).toMatchObject({ authority: "OFFICIAL", text: "Stay indoors and avoid waterlogged roads." });
    const firstGuidance = ns.actions.findIndex((a) => a.authority === "GUIDANCE");
    expect(ns.actions.slice(firstGuidance).every((a) => a.authority === "GUIDANCE")).toBe(true);
    expect(ns.monitor.some((m) => m.text.includes("90 min left"))).toBe(true);
    expect(ns.contacts[0]?.phone).toBe("112");
  });
  it("is UNKNOWN (never 'all clear') when the feed is unavailable", () => {
    expect(computePriority([], "UNAVAILABLE")).toBe("UNKNOWN");
    expect(computePriority([], "LIVE")).toBe("STAY_INFORMED");
  });
  it("ignores expired alerts and adapts to the household", () => {
    const ns = buildNextSteps({
      alerts: [alert({ freshness: "EXPIRED" })],
      feedMode: "LIVE", feedRetrievedAt: null, placeLabel: "Patna", now,
      household: { members: 3, children: 1, elderly: 1, mobilityNeeds: false, medicalNeeds: true, pets: false },
      language: "hi",
    });
    expect(ns.priority).toBe("STAY_INFORMED");
    expect(ns.actions.some((a) => a.id === "g-meds")).toBe(true);
    expect(ns.actions.some((a) => a.authority === "OFFICIAL")).toBe(false);
  });
});

const SH: LiveShelter[] = [
  { id: "a", name: "School A", publishedCapacity: 500, distanceKm: 2, durationMin: 6, sourceUrl: "https://patna.nic.in/1" },
  { id: "b", name: "Hall B", publishedCapacity: null, distanceKm: 5, durationMin: 12, sourceUrl: "https://patna.nic.in/2" },
  { id: "c", name: "College C", publishedCapacity: 1000, distanceKm: 9, durationMin: 20, sourceUrl: "https://patna.nic.in/3" },
];

describe("live-seeded simulator", () => {
  const base = planLive(SH, { evacuees: 1200, assumedCapacity: 300, closedShelterIds: [], blockedRouteIds: [], demandMultiplier: 1 });
  it("fills the nearest documented shelters first and labels assumed capacity", () => {
    expect(base.isSimulated).toBe(true);
    expect(base.allocations.map((a) => a.shelterId)).toEqual(["a", "b", "c"]);
    expect(base.utilization.find((u) => u.shelterId === "b")?.capacityAssumed).toBe(true);
    expect(base.unmet).toBe(0);
  });
  it("re-plans when a road to a shelter is closed and when demand surges", () => {
    const blocked = planLive(SH, { evacuees: 1200, assumedCapacity: 300, closedShelterIds: [], blockedRouteIds: ["a"], demandMultiplier: 1.5 });
    expect(blocked.utilization.find((u) => u.shelterId === "a")?.state).toBe("ROUTE_BLOCKED");
    expect(blocked.unmet).toBe(1800 - 1300);
    expect(diffLive(base, blocked).length).toBeGreaterThan(0);
    expect(blocked.actions.some((a) => a.includes("road closure"))).toBe(true);
  });
});

describe("road-closure verification", () => {
  it("keeps closures only when the road is named inside a verbatim quote", () => {
    const page = { url: "https://traffic.bihar.gov.in/x", text: "Traffic advisory: Ashok Rajpath closed for traffic due to waterlogging till further orders." };
    const v = verifyExtraction(
      {
        shelters: [], contacts: [], advisories: [],
        roadClosures: [
          { road: "Ashok Rajpath", status: "closed", evidenceQuote: "Ashok Rajpath closed for traffic due to waterlogging" },
          { road: "Bailey Road", status: "closed", evidenceQuote: "Ashok Rajpath closed for traffic due to waterlogging" },
        ],
      },
      page, "2026-10-14T00:00:00Z", "AI_EXTRACTED_QUOTE_VERIFIED", "Patna",
    );
    expect(v.roadClosures.map((r) => r.road)).toEqual(["Ashok Rajpath"]);
    expect(v.dropped).toBe(1);
  });
});