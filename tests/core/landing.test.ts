import { describe, expect, it } from "vitest";
import { INDIA_BOUNDS, JOURNEY, lastPassDate, map3dLink, mosaicFor, positionIn, tileUrl } from "../../src/lib/landing/imagery";
import { hillshadeRGBA } from "../../src/lib/landing/hillshade";
import { parseViewState } from "../../src/lib/core/geo3d/view-state";

describe("landing imagery", () => {
  it("builds a mosaic that covers India and places points inside it", () => {
    const m = mosaicFor(INDIA_BOUNDS, 6);
    expect(m.cols * m.rows).toBeLessThanOrEqual(49);
    expect(m.bounds.west).toBeLessThanOrEqual(INDIA_BOUNDS.west);
    expect(m.bounds.north).toBeGreaterThanOrEqual(INDIA_BOUNDS.north);
    const p = positionIn(m, 77.2, 28.6); // Delhi
    expect(p.x).toBeGreaterThan(0);
    expect(p.x).toBeLessThan(1);
    expect(p.y).toBeGreaterThan(0);
    expect(p.y).toBeLessThan(1);
  });
  it("uses yesterday's UTC date and real tile endpoints", () => {
    expect(lastPassDate(new Date("2026-10-16T03:00:00Z"))).toBe("2026-10-15");
    expect(tileUrl("viirs", 6, 45, 27, "2026-10-15")).toContain("/2026-10-15/GoogleMapsCompatible_Level9/6/27/45.jpg");
    expect(tileUrl("osm", 6, 45, 27)).toBe("https://tile.openstreetmap.org/6/45/27.png");
  });
  it("journey links open valid 3D map views", () => {
    for (const p of JOURNEY) {
      const v = parseViewState(new URLSearchParams(map3dLink(p).split("?")[1]));
      expect(v.lat).toBeCloseTo(p.lat, 3);
      expect(v.mode).toBe("3d");
    }
  });
  it("hillshade returns one opaque pixel per cell", () => {
    const g = { west: 85, east: 85.1, south: 25, north: 25.1, cols: 3, rows: 2, values: Float32Array.from([10, 20, 30, 10, 20, Number.NaN]) };
    const px = hillshadeRGBA(g);
    expect(px.length).toBe(24);
    expect(px[3]).toBe(255);
  });
});