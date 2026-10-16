import { describe, expect, it } from "vitest";
import { latLonRingsToPolygons, validateGeometry, type PolygonGeom, type Position } from "../../src/lib/core/geo3d/geojson";
import { circlePolygon, distanceToAreaMeters, GridIndex, intersectsArea, lonLatToTile, pointInArea, segmentsIntersect } from "../../src/lib/core/geo3d/spatial";
import { analyzeExposure, dedupeById, type HazardZone } from "../../src/lib/core/geo3d/exposure";
import { freshnessFactor, kmInside, scoreRoute, type RouteHazard } from "../../src/lib/core/geo3d/route-risk";
import { connectedInundation, decodeTerrarium, depthBand, inundationCells, positionToCell, sampleGrid, SIMULATION_LABEL, type ElevationGrid } from "../../src/lib/core/geo3d/inundation";
import { assessLayer } from "../../src/lib/core/geo3d/quality";
import { parseViewState, serializeViewState } from "../../src/lib/core/geo3d/view-state";

// A 0.1° square around Patna with a 0.02° hole in the middle.
const square: PolygonGeom = {
  type: "Polygon",
  coordinates: [
    [[85.1, 25.5], [85.2, 25.5], [85.2, 25.6], [85.1, 25.6], [85.1, 25.5]],
    [[85.14, 25.54], [85.16, 25.54], [85.16, 25.56], [85.14, 25.56], [85.14, 25.54]],
  ],
};
const now = new Date("2026-10-16T06:00:00Z");

describe("geometry validation", () => {
  it("accepts valid and rejects invalid coordinates", () => {
    expect(validateGeometry({ type: "Point", coordinates: [85.1, 25.5] }).ok).toBe(true);
    expect(validateGeometry({ type: "Point", coordinates: [185, 25.5] }).ok).toBe(false);
    expect(validateGeometry({ type: "Point", coordinates: [85.1, Number.NaN] }).ok).toBe(false);
    expect(validateGeometry({ type: "LineString", coordinates: [[85, 25]] }).ok).toBe(false);
    expect(validateGeometry({ type: "Polygon", coordinates: [[[0, 0], [1, 0]]] }).ok).toBe(false);
    expect(validateGeometry({ type: "Circle", coordinates: [0, 0] }).ok).toBe(false);
    expect(validateGeometry(null).ok).toBe(false);
  });
  it("closes unclosed rings and reports the repair", () => {
    const v = validateGeometry({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1]]] });
    expect(v.ok && v.repaired).toBe(true);
  });
  it("converts [lat, lon] API rings and counts bad ones", () => {
    const r = latLonRingsToPolygons([[[25.5, 85.1], [25.5, 85.2], [25.6, 85.2], [25.5, 85.1]], [[999, 1]]]);
    expect(r.polygons).toHaveLength(1);
    expect(r.invalid).toBe(1);
    expect(r.polygons[0]?.coordinates[0]?.[0]).toEqual([85.1, 25.5]);
  });
});

describe("Algorithm A: point in polygon", () => {
  it("respects holes", () => {
    expect(pointInArea([85.12, 25.52], square)).toBe(true);
    expect(pointInArea([85.15, 25.55], square)).toBe(false); // in the hole
    expect(pointInArea([85.3, 25.55], square)).toBe(false);
    expect(pointInArea([85.12, 25.52], { type: "MultiPolygon", coordinates: [square.coordinates] })).toBe(true);
  });
});

describe("Algorithm B: intersection vs proximity", () => {
  it("detects crossing lines with no vertex inside", () => {
    expect(segmentsIntersect([0, 0], [2, 2], [0, 2], [2, 0])).toBe(true);
    expect(segmentsIntersect([0, 0], [1, 0], [0, 1], [1, 1])).toBe(false);
    const crossing = { type: "LineString", coordinates: [[85.05, 25.52], [85.25, 25.52]] } as const;
    expect(intersectsArea({ type: "LineString", coordinates: crossing.coordinates.map((p) => [...p] as Position) }, square)).toBe(true);
  });
  it("treats a nearby road as near, not intersecting", () => {
    const nearLine = { type: "LineString" as const, coordinates: [[85.2005, 25.52], [85.2005, 25.53]] as Position[] };
    expect(intersectsArea(nearLine, square)).toBe(false);
    expect(distanceToAreaMeters([85.2005, 25.52], square)).toBeLessThan(100);
  });
  it("detects a building that contains the whole hazard", () => {
    const big: PolygonGeom = { type: "Polygon", coordinates: [[[85, 25.4], [85.3, 25.4], [85.3, 25.7], [85, 25.7], [85, 25.4]]] };
    expect(intersectsArea(big, square)).toBe(true);
  });
  it("grid index returns candidates only", () => {
    const g = new GridIndex<string>(0.05);
    g.insert([85.1, 25.5, 85.2, 25.6], "a");
    g.insert([77, 28, 77.1, 28.1], "b");
    expect(g.query([85.15, 25.55, 85.16, 25.56])).toEqual(["a"]);
  });
});

describe("Algorithm C: exposure", () => {
  const zones: HazardZone[] = [{ id: "z1", label: "alert", kind: "OFFICIAL", geometry: square }];
  it("counts intersecting, near and invalid features separately", () => {
    const r = analyzeExposure(
      [
        { id: "b1", category: "building", geometry: { type: "Polygon", coordinates: [[[85.12, 25.52], [85.121, 25.52], [85.121, 25.521], [85.12, 25.52]]] } },
        { id: "b2", category: "building", geometry: { type: "Polygon", coordinates: [[[85.3, 25.3], [85.301, 25.3], [85.301, 25.301], [85.3, 25.3]]] } },
        { id: "r1", category: "road", geometry: { type: "LineString", coordinates: [[85.2005, 25.52], [85.2005, 25.53]] } },
        { id: "bad", category: "road", geometry: { type: "LineString", coordinates: [[999, 0], [1, 1]] } },
      ],
      zones,
      { nearMeters: 100 },
    );
    expect(r.evaluated).toBe(3);
    expect(r.invalidGeometry).toBe(1);
    expect(r.intersectingCount).toBe(1);
    expect(r.intersecting[0]?.id).toBe("b1");
    expect(r.nearCount).toBe(1);
    expect(r.byCategory.road?.near).toBe(1);
    expect(r.byCategory.building?.evaluated).toBe(2);
  });
  it("dedupes tile fragments", () => {
    expect(dedupeById([{ id: "a" }, { id: "a" }, { id: "b" }])).toHaveLength(2);
  });
});

describe("Algorithm D: route risk", () => {
  const hz = (o: Partial<RouteHazard>): RouteHazard => ({ id: "h", label: "IMD: Severe", geometry: square, severity: "Severe", sourceCategory: "OFFICIAL", issuedAt: "2026-10-16T04:00:00Z", expiresAt: "2026-10-16T12:00:00Z", ...o });
  const path: Position[] = [[85.0, 25.52], [85.3, 25.52]];
  it("measures km inside and scores with explainable factors", () => {
    const km = kmInside(path, square);
    expect(km).toBeGreaterThan(9);
    expect(km).toBeLessThan(10.2); // 0.1° of longitude at 25.5°N ≈ 10.0 km
    const r = scoreRoute({ path, hazards: [hz({})], closures: [], now });
    expect(r.status).toBe("ENTERS_HAZARD_AREA");
    expect(r.factors[0]?.weight).toBe(3);
    expect(r.exposureIndex).toBeCloseTo(r.kmInsideOfficial * 3, 0);
    expect(r.verifiedSafe).toBe(false);
  });
  it("never calls a clear route safe and flags unchecked closures", () => {
    const r = scoreRoute({ path: [[86, 26], [86.1, 26]], hazards: [hz({})], closures: [{ road: "NH 31", status: "closed", sourceUrl: "https://x.gov.in", retrievedAt: now.toISOString() }], now });
    expect(r.status).toBe("NO_MAPPED_HAZARD_FOUND");
    expect(r.warnings.join(" ")).toContain("could not be checked");
    expect(r.warnings.join(" ")).toContain("Not verified safe");
  });
  it("matches closures by road name, ignores expired alerts, keeps simulated separate", () => {
    const r = scoreRoute({
      path,
      hazards: [hz({ expiresAt: "2026-10-15T00:00:00Z" }), hz({ id: "s", simulated: true, label: "Scenario" })],
      closures: [{ road: "NH 31", status: "closed", sourceUrl: "https://x.gov.in", retrievedAt: now.toISOString() }],
      roadNames: ["NH31 Patna Bypass", "nh 31"],
      now,
    });
    expect(r.status).toBe("REPORTED_CLOSURE_ON_ROUTE");
    expect(r.kmInsideOfficial).toBe(0);
    expect(r.kmInsideSimulated).toBeGreaterThan(9);
    expect(r.exposureIndex).toBe(0);
    expect(r.warnings.join(" ")).toContain("expired");
  });
  it("freshness factor", () => {
    expect(freshnessFactor("2026-10-16T05:00:00Z", now).factor).toBe(1);
    expect(freshnessFactor("2026-10-15T20:00:00Z", now).factor).toBe(0.8);
    expect(freshnessFactor(null, now).factor).toBe(0.6);
  });
});

describe("hypothetical inundation", () => {
  // 5×5 valley: low centre column, a ridge splits off the right-hand low cell.
  const values = Float32Array.from([
    10, 10, 2, 10, 1,
    10, 10, 2, 10, 1,
    10, 3, 1, 10, 1,
    10, 10, 2, 10, 1,
    10, 10, 2, 10, Number.NaN,
  ]);
  const g: ElevationGrid = { west: 85, east: 85.05, south: 25.5, north: 25.55, cols: 5, rows: 5, values };
  it("decodes terrarium", () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(128, 100, 128)).toBe(100.5);
  });
  it("floods only cells connected to the seed", () => {
    const r = connectedInundation(g, { col: 2, row: 2 }, 4);
    expect(r.cells).toBe(6); // centre column (5) + the 3 m cell; the right column is cut off by the 10 m ridge
    expect(r.maxDepth).toBe(3);
    expect(r.touchesEdge).toBe(true);
    expect(r.noDataCells).toBe(1);
    expect(inundationCells(g, r)).toHaveLength(6);
  });
  it("returns nothing when the seed is above the water", () => {
    expect(connectedInundation(g, { col: 0, row: 0 }, 4).cells).toBe(0);
  });
  it("bands, cells and sampling", () => {
    expect(depthBand(0.3)).toBe(0);
    expect(depthBand(2.5)).toBe(3);
    expect(depthBand(9)).toBe(4);
    expect(positionToCell(g, [85.025, 25.525])).toEqual({ col: 2, row: 2 });
    expect(positionToCell(g, [86, 25])).toBeNull();
    expect(sampleGrid(g, [85.025, 25.525])).toBeCloseTo(1, 3);
    expect(SIMULATION_LABEL).toContain("SIMULATED");
  });
  it("circle polygon is closed and sized", () => {
    const ring = circlePolygon([85, 25], 1000);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(pointInArea([85, 25.008], { type: "Polygon", coordinates: [ring] })).toBe(true);
    expect(pointInArea([85, 25.01], { type: "Polygon", coordinates: [ring] })).toBe(false);
  });
  it("tile math", () => {
    const t = lonLatToTile(0, 0, 1);
    expect(t.x).toBe(1);
    expect(t.y).toBeCloseTo(1, 6);
  });
});

describe("Algorithm E: data quality and labelling", () => {
  it("classifies freshness and keeps simulations separate", () => {
    expect(assessLayer({ layer: "a", source: "SACHET", verification: "OFFICIAL", retrievedAt: "2026-10-16T05:55:00Z", features: 2, now }).freshness).toBe("LIVE");
    expect(assessLayer({ layer: "a", source: "SACHET", verification: "OFFICIAL", retrievedAt: "2026-10-16T05:20:00Z", features: 2, now }).freshness).toBe("RECENT");
    expect(assessLayer({ layer: "a", source: "SACHET", verification: "OFFICIAL", retrievedAt: "2026-10-16T01:00:00Z", features: 2, now }).freshness).toBe("STALE");
    expect(assessLayer({ layer: "a", source: "x", verification: "OFFICIAL", retrievedAt: null, features: 2, now }).freshness).toBe("UNKNOWN");
    const sim = assessLayer({ layer: "s", source: "model", verification: "SIMULATED", retrievedAt: null, features: 10, now });
    expect(sim.isSimulated).toBe(true);
    expect(sim.freshness).toBe("NOT_APPLICABLE");
    expect(assessLayer({ layer: "a", source: "x", verification: "OFFICIAL", retrievedAt: now.toISOString(), features: 0, invalidGeometry: 2, now }).uncertainty).toHaveLength(2);
  });
});

describe("shareable view state", () => {
  it("round-trips and rejects bad values", () => {
    const s = serializeViewState({ lat: 25.6, lon: 85.1, zoom: 14, pitch: 60, bearing: -20, mode: "3d", layers: ["alerts", "buildings"] });
    const v = parseViewState(new URLSearchParams(s));
    expect(v.lat).toBe(25.6);
    expect(v.layers).toEqual(["alerts", "buildings"]);
    const bad = parseViewState(new URLSearchParams("lat=999&lon=85&z=50&pitch=-3&mode=x&layers=alerts,evil"));
    expect(bad.lat).toBeUndefined();
    expect(bad.zoom).toBeUndefined();
    expect(bad.pitch).toBeUndefined();
    expect(bad.mode).toBeUndefined();
    expect(bad.layers).toEqual(["alerts"]);
  });
});

describe("raster exposure and tile fragments", () => {
  it("merges fragments and tests features against flooded cells", async () => {
    const { mergeFragments } = await import("../../src/lib/core/geo3d/exposure");
    const { geomTouchesMask } = await import("../../src/lib/core/geo3d/inundation");
    const merged = mergeFragments([
      { id: "r", category: "road", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } },
      { id: "r", category: "road", geometry: { type: "LineString", coordinates: [[1, 1], [2, 2]] } },
      { id: "x", category: "road", geometry: { type: "LineString", coordinates: [[5, 5], [6, 6]] } },
    ]);
    expect(merged).toHaveLength(2);
    expect((merged[0]?.geometry as { type: string }).type).toBe("MultiLineString");

    const values = Float32Array.from([10, 10, 10, 10, 1, 10, 10, 10, 10]);
    const g: ElevationGrid = { west: 0, east: 0.03, south: 0, north: 0.03, cols: 3, rows: 3, values };
    const res = connectedInundation(g, { col: 1, row: 1 }, 2);
    expect(res.cells).toBe(1);
    // A road crossing the middle cell without a vertex in it still counts.
    expect(geomTouchesMask(g, res, { type: "LineString", coordinates: [[0.001, 0.015], [0.029, 0.015]] })).toBe(true);
    expect(geomTouchesMask(g, res, { type: "LineString", coordinates: [[0.001, 0.028], [0.029, 0.028]] })).toBe(false);
    const r = analyzeExposure(
      [{ id: "b", category: "building", geometry: { type: "Point", coordinates: [0.015, 0.015] } }],
      [{ id: "sim", label: "scenario", kind: "SIMULATED", bbox: [0, 0, 0.03, 0.03], hits: (geom) => geomTouchesMask(g, res, geom) }],
    );
    expect(r.intersectingCount).toBe(1);
  });
});

describe("prepared areas match the direct predicates", () => {
  it("agrees with intersectsArea on a sweep of lines", async () => {
    const { prepareArea, intersectsPrepared } = await import("../../src/lib/core/geo3d/spatial");
    const prep = prepareArea(square);
    for (let i = 0; i < 60; i++) {
      const y = 25.48 + i * 0.002;
      const line = { type: "LineString" as const, coordinates: [[85.05, y], [85.25, y + 0.01]] as Position[] };
      const short = { type: "LineString" as const, coordinates: [[85.145 + (i % 7) * 0.001, y], [85.146 + (i % 7) * 0.001, y + 0.001]] as Position[] };
      expect(intersectsPrepared(line, prep)).toBe(intersectsArea(line, square));
      expect(intersectsPrepared(short, prep)).toBe(intersectsArea(short, square));
    }
  });
});

describe("multi-part features", () => {
  it("detects a part fully inside even when another part is outside", async () => {
    const { prepareArea, intersectsPrepared } = await import("../../src/lib/core/geo3d/spatial");
    const g = { type: "MultiLineString" as const, coordinates: [[[86, 26], [86.01, 26]], [[85.11, 25.51], [85.12, 25.52]]] as Position[][] };
    expect(intersectsPrepared(g, prepareArea(square))).toBe(true);
    expect(intersectsArea(g, square)).toBe(true);
  });
});

describe("banded point test", () => {
  it("matches pointInArea on a grid, holes included", async () => {
    const { prepareArea, pointInPrepared } = await import("../../src/lib/core/geo3d/spatial");
    const prep = prepareArea(square);
    for (let i = 0; i <= 40; i++) for (let j = 0; j <= 40; j++) {
      const p: Position = [85.08 + i * 0.0035, 25.48 + j * 0.0035];
      expect(pointInPrepared(p, prep)).toBe(pointInArea(p, square));
    }
  });
});

describe("live OSM buildings", () => {
  it("parses heights only from tags and labels defaults", async () => {
    const { parseLength, buildingHeight, overpassToBuildings, clampLiveBox, liveBuildingsQuery } = await import("../../src/lib/core/geo3d/osm-buildings");
    expect(parseLength("12")).toBe(12);
    expect(parseLength("12.5 m")).toBe(12.5);
    expect(parseLength("40 ft")).toBe(12.2);
    expect(parseLength("tall")).toBeNull();
    expect(buildingHeight({ height: "30" }).source).toBe("height tag");
    expect(buildingHeight({ "building:levels": "5" }).height).toBe(16);
    expect(buildingHeight({}).source).toBe("default");
    const fc = overpassToBuildings({
      elements: [
        { type: "way", id: 1, timestamp: "2026-10-16T05:00:00Z", tags: { building: "yes", "building:levels": "3" }, geometry: [{ lat: 25.6, lon: 85.1 }, { lat: 25.6, lon: 85.1001 }, { lat: 25.6001, lon: 85.1001 }, { lat: 25.6, lon: 85.1 }] },
        { type: "way", id: 2, tags: { building: "yes" }, geometry: [{ lat: 25.6, lon: 85.1 }] },
        { type: "node", id: 3 },
      ],
    });
    expect(fc.summary.count).toBe(1);
    expect(fc.summary.invalid).toBe(1);
    expect(fc.summary.withLevels).toBe(1);
    expect(fc.summary.newestEdit).toBe("2026-10-16T05:00:00Z");
    const box = clampLiveBox({ west: 85, east: 85.2, south: 25.5, north: 25.6 });
    expect(box.east - box.west).toBeCloseTo(0.03, 6);
    expect(liveBuildingsQuery(box)).toContain('way["building"]');
  });
});