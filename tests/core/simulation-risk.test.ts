import { describe, expect, it } from "vitest";
import { DEMO_SCENARIO, diffPlans, planResponse } from "../../src/lib/core/simulation";
import { summarizeRisk } from "../../src/lib/core/risk-analysis";
import { createRateLimiter } from "../../src/lib/core/rate-limit";
import { mapWithConcurrency } from "../../src/lib/core/concurrency";
import type { NormalizedAlert } from "../../src/lib/core/types";

describe("what-if simulator", () => {
  const base = planResponse(DEMO_SCENARIO, { closedShelterIds: [], demandMultiplier: 1 });

  it("always marks output as simulated", () => {
    expect(base.isSimulated).toBe(true);
  });

  it("never allocates more people than a shelter's capacity", () => {
    for (const u of base.utilization) expect(u.used).toBeLessThanOrEqual(u.capacity);
  });

  it("re-routes evacuees when a shelter becomes unavailable", () => {
    const closed = planResponse(DEMO_SCENARIO, { closedShelterIds: ["S1"], demandMultiplier: 1 });
    expect(closed.utilization.find((u) => u.shelterId === "S1")?.used).toBe(0);
    expect(closed.allocations.some((a) => a.shelterId === "S1")).toBe(false);
    expect(diffPlans(base, closed).length).toBeGreaterThan(0);
    expect(closed.actions.some((a) => a.includes("unavailable"))).toBe(true);
  });

  it("reports unmet demand instead of hiding it when demand surges", () => {
    const surge = planResponse(DEMO_SCENARIO, { closedShelterIds: ["S4"], demandMultiplier: 2.5 });
    const unmet = surge.unmet.reduce((n, u) => n + u.people, 0);
    const sheltered = surge.allocations.reduce((n, a) => n + a.people, 0);
    expect(unmet).toBeGreaterThan(0);
    expect(sheltered + unmet).toBe(surge.totalEvacuees);
  });

  it("clamps hostile inputs", () => {
    const p = planResponse(DEMO_SCENARIO, { closedShelterIds: ["NOPE", "S2", "S2"], demandMultiplier: 999 });
    expect(p.inputs.closedShelterIds).toEqual(["S2"]);
    expect(p.inputs.demandMultiplier).toBe(3);
  });
});

const alert = (o: Partial<NormalizedAlert>): NormalizedAlert => ({
  id: "1",
  source: "SACHET_CAP",
  issuer: "IMD",
  headline: "h",
  event: null,
  hazard: "flood",
  severity: "Moderate",
  urgency: null,
  certainty: null,
  areaDesc: null,
  instruction: null,
  issuedAt: "2026-10-14T00:00:00Z",
  effectiveAt: null,
  expiresAt: null,
  retrievedAt: "2026-10-14T00:00:00Z",
  capUrl: "https://sachet.ndma.gov.in/x",
  freshness: "ACTIVE",
  relevance: "DISTRICT",
  partial: false,
  ...o,
});

describe("risk summary", () => {
  it("is UNKNOWN when the official feed is unavailable", () => {
    expect(summarizeRisk([], false).level).toBe("UNKNOWN");
  });
  it("is SEVERE only for an active severe alert naming the district", () => {
    expect(summarizeRisk([alert({ severity: "Severe" })], true).level).toBe("SEVERE");
    expect(summarizeRisk([alert({ severity: "Severe", relevance: "STATE" })], true).level).toBe("ADVISORY");
  });
  it("ignores expired alerts when computing the level", () => {
    const s = summarizeRisk([alert({ severity: "Extreme", freshness: "EXPIRED" })], true);
    expect(s.level).toBe("NO_ACTIVE_ALERTS");
    expect(s.expiredOrStale).toBe(1);
  });
});

describe("infrastructure helpers", () => {
  it("rate limits per key within a window", () => {
    const rl = createRateLimiter({ limit: 2, windowMs: 1000 });
    expect(rl.check("a", 0).allowed).toBe(true);
    expect(rl.check("a", 1).allowed).toBe(true);
    expect(rl.check("a", 2).allowed).toBe(false);
    expect(rl.check("b", 2).allowed).toBe(true);
    expect(rl.check("a", 1001).allowed).toBe(true);
  });
  it("bounds concurrency and isolates failures", async () => {
    let inFlight = 0;
    let peak = 0;
    const res = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      if (n === 3) throw new Error("boom");
      return n * 2;
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(res[2]?.ok).toBe(false);
    expect(res[4]).toEqual({ ok: true, value: 10 });
  });
});
