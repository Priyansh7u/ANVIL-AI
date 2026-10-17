import { describe, expect, it } from "vitest";
import { facingRotation, gibsGlobeUrl, latLonToVector3, markerHeight, range, rotateYX } from "@/lib/landing/globe-math";

describe("landing globe maths", () => {
  it("places lon 0 on +X, lon -90 on +Z and the pole on +Y", () => {
    const a = latLonToVector3(0, 0);
    expect(a.x).toBeCloseTo(1);
    const b = latLonToVector3(0, -90);
    expect(b.z).toBeCloseTo(1);
    expect(latLonToVector3(90, 10).y).toBeCloseTo(1);
  });

  it("facing rotation brings India to the camera (+Z)", () => {
    const lat = 22.5;
    const lon = 80.5;
    const r = facingRotation(lat, lon);
    const p = rotateYX(latLonToVector3(lat, lon), r.x, r.y);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(0, 6);
    expect(p.z).toBeCloseTo(1, 6);
  });

  it("marker height grows sub-linearly and is bounded", () => {
    expect(markerHeight(0)).toBe(0);
    expect(markerHeight(4)).toBeGreaterThan(markerHeight(1));
    expect(markerHeight(10_000)).toBeLessThanOrEqual(0.32);
  });

  it("range clamps to 0..1", () => {
    expect(range(-1, 0, 1)).toBe(0);
    expect(range(0.5, 0, 1)).toBe(0.5);
    expect(range(5, 0, 1)).toBe(1);
  });

  it("builds an equirectangular GIBS request with the pass date", () => {
    const u = new URL(gibsGlobeUrl("VIIRS_SNPP_CorrectedReflectance_TrueColor", 2048, "2026-10-16"));
    expect(u.searchParams.get("WIDTH")).toBe("2048");
    expect(u.searchParams.get("HEIGHT")).toBe("1024");
    expect(u.searchParams.get("TIME")).toBe("2026-10-16");
    expect(u.searchParams.get("BBOX")).toBe("-90,-180,90,180");
  });
});