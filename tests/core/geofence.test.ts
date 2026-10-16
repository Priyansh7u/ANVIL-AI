import { describe, expect, it } from "vitest";
import { matchWatchArea, type WatchArea, type WatchHazard } from "../../src/lib/core/geofence";

const square: [number, number][] = [[25.55, 85.05], [25.55, 85.25], [25.65, 85.25], [25.65, 85.05]];
const hazards: WatchHazard[] = [
  { id: "poly", severity: "Severe", relevance: "STATE", areaSource: "CAP_POLYGON", polygons: [square] },
  { id: "district", severity: "Moderate", relevance: "DISTRICT", areaSource: "NOT_MAPPED", polygons: [] },
  { id: "state", severity: "Extreme", relevance: "STATE", areaSource: "NOT_MAPPED", polygons: [] },
  { id: "minor", severity: "Minor", relevance: "DISTRICT", areaSource: "NOT_MAPPED", polygons: [] },
];
const base: WatchArea = { id: "w", label: "Home", district: "Patna", state: "Bihar", minSeverity: "Moderate", includeStateLevel: false };

describe("smart geofenced alerts", () => {
  it("matches a circle that overlaps the official alert polygon", () => {
    const m = matchWatchArea({ ...base, center: [25.7, 85.1], radiusKm: 8 }, hazards);
    expect(m.map((x) => `${x.hazard.id}:${x.reason}`)).toEqual(["poly:INSIDE_ALERT_AREA", "district:DISTRICT_NAMED"]);
  });
  it("does not match a far-away circle to the polygon", () => {
    const m = matchWatchArea({ ...base, center: [26.5, 85.1], radiusKm: 5 }, hazards);
    expect(m.some((x) => x.hazard.id === "poly")).toBe(false);
  });
  it("respects minimum severity and the state-level opt-in", () => {
    expect(matchWatchArea(base, hazards).map((x) => x.hazard.id)).toEqual(["district"]);
    expect(matchWatchArea({ ...base, includeStateLevel: true }, hazards).map((x) => x.hazard.id)).toEqual(["poly", "district", "state"]);
  });
});