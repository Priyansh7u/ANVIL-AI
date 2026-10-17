import { describe, expect, it } from "vitest";
import type { LiveShelter, LiveSimInputs } from "@/lib/core/live-sim";
import { arrivalShare, arrivalTimeline, criticalShelters, monteCarlo, mulberry32 } from "@/lib/core/sim-analytics";
import { goBagList, readinessScore } from "@/lib/core/readiness";

const SHELTERS: LiveShelter[] = [
  { id: "a", name: "School A", publishedCapacity: 500, distanceKm: 1, durationMin: 4, sourceUrl: "https://x.gov.in/a" },
  { id: "b", name: "Hall B", publishedCapacity: 300, distanceKm: 2, durationMin: 8, sourceUrl: "https://x.gov.in/b" },
  { id: "c", name: "College C", publishedCapacity: null, distanceKm: 6, durationMin: 15, sourceUrl: "https://x.gov.in/c" },
];
const INPUTS: LiveSimInputs = { evacuees: 900, assumedCapacity: 200, closedShelterIds: [], blockedRouteIds: [], demandMultiplier: 1 };

describe("simulator analytics", () => {
  it("ranks the shelter whose loss leaves most people unsheltered first", () => {
    const c = criticalShelters(SHELTERS, INPUTS);
    expect(c).toHaveLength(3);
    expect(c[0]!.shelterId).toBe("a");
    expect(c[0]!.extraUnmet).toBe(400);
    expect(c[0]!.serving).toBe(500);
  });

  it("skips shelters already unavailable", () => {
    const c = criticalShelters(SHELTERS, { ...INPUTS, closedShelterIds: ["a"] });
    expect(c.map((x) => x.shelterId).includes("a")).toBe(false);
  });

  it("Monte Carlo is reproducible and bounded", () => {
    const a = monteCarlo(SHELTERS, INPUTS, { runs: 200, pFail: 0.2, seed: 7 });
    const b = monteCarlo(SHELTERS, INPUTS, { runs: 200, pFail: 0.2, seed: 7 });
    expect(a.fullyShelteredShare).toBe(b.fullyShelteredShare);
    expect(a.fullyShelteredShare).toBeGreaterThan(0);
    expect(a.fullyShelteredShare).toBeLessThanOrEqual(1);
    expect(a.histogram.reduce((n, h) => n + h.runs, 0)).toBe(200);
    expect(a.unmetP90).toBeGreaterThanOrEqual(a.unmetP50);
  });

  it("no failures means everyone is always sheltered when capacity suffices", () => {
    const r = monteCarlo(SHELTERS, INPUTS, { runs: 50, pFail: 0 });
    expect(r.fullyShelteredShare).toBe(1);
    expect(r.unmetMax).toBe(0);
  });

  it("arrival curve starts at 0 and the timeline ends with everyone", () => {
    expect(arrivalShare(0, 4)).toBe(0);
    expect(arrivalShare(12, 4)).toBeGreaterThan(0.9);
    const t = arrivalTimeline(SHELTERS, { ...INPUTS, demandMultiplier: 1.5 }, { hours: 6 });
    expect(t).toHaveLength(7);
    expect(t[0]!.arrived).toBe(0);
    expect(t[6]!.arrived).toBe(1350);
    expect(t[6]!.unmet).toBe(350);
  });

  it("PRNG is deterministic", () => {
    const r = mulberry32(1);
    const s = mulberry32(1);
    expect(r()).toBe(s());
  });
});

describe("household readiness", () => {
  it("sizes water to household and days, and adds needs-based items", () => {
    const list = goBagList({ members: 4, children: 1, elderly: 0, mobilityNeeds: false, medicalNeeds: true, pets: false }, 3);
    expect(list.find((i) => i.id === "water")!.qty).toBe("48 L");
    expect(list.some((i) => i.id === "meds")).toBe(true);
    expect(list.some((i) => i.id === "kids")).toBe(true);
    expect(list.some((i) => i.id === "pets")).toBe(false);
  });

  it("scores 100 only when everything is done and fresh", () => {
    const full = readinessScore({ checklistDone: 5, checklistTotal: 5, bagDone: 10, bagTotal: 10, familyCardComplete: true, drillSeconds: 300, planAgeHours: 2, planOutdated: false });
    expect(full.score).toBe(100);
    const none = readinessScore({ checklistDone: 0, checklistTotal: 5, bagDone: 0, bagTotal: 10, familyCardComplete: false, drillSeconds: null, planAgeHours: null, planOutdated: false });
    expect(none.score).toBe(0);
    const stale = readinessScore({ checklistDone: 5, checklistTotal: 5, bagDone: 10, bagTotal: 10, familyCardComplete: true, drillSeconds: 300, planAgeHours: 2, planOutdated: true });
    expect(stale.score).toBe(88);
  });
});