import { describe, expect, it } from "vitest";
import { aggregateNational, attentionIndex, corroborate, detectEscalation } from "../../src/lib/core/intelligence";
import { assignState } from "../../src/lib/core/india-states";
import { rankRoutesByExposure, routeExposureKm } from "../../src/lib/core/geometry";
import type { NormalizedAlert } from "../../src/lib/core/types";

const now = new Date("2026-10-15T06:00:00Z");
const A = (o: Partial<NormalizedAlert>): NormalizedAlert => ({
  id: Math.random().toString(36).slice(2), source: "SACHET_CAP", issuer: "IMD Patna", headline: "Heavy rain likely", event: null, hazard: "heavy_rain",
  severity: "Severe", urgency: "Immediate", certainty: "Likely", areaDesc: "Patna district of Bihar", instruction: null,
  issuedAt: "2026-10-15T05:30:00Z", effectiveAt: null, expiresAt: "2026-10-15T09:00:00Z", retrievedAt: now.toISOString(),
  capUrl: "https://sachet.ndma.gov.in/x", freshness: "ACTIVE", relevance: "DISTRICT", partial: false, ...o,
});

describe("attention index", () => {
  it("is UNKNOWN when the feed is down and NONE with no active alerts", () => {
    expect(attentionIndex([], false, now).band).toBe("UNKNOWN");
    expect(attentionIndex([A({ freshness: "EXPIRED" })], true, now).band).toBe("NONE");
  });
  it("ranks a fresh severe district alert above an old state-level one, with factor breakdown", () => {
    const r = attentionIndex([A({ id: "old", relevance: "STATE", issuedAt: "2026-10-14T18:00:00Z" }), A({ id: "new" })], true, now);
    expect(r.contributions[0]?.alertId).toBe("new");
    expect(r.contributions[0]?.parts.map((p) => p.label)).toEqual(["Severity", "Urgency", "Certainty", "Area", "Recency"]);
    expect(r.score).toBeGreaterThan(30);
    expect(r.score).toBeLessThanOrEqual(100);
  });
  it("boosts when independent agencies report the same hazard family", () => {
    const single = attentionIndex([A({ issuer: "IMD Patna" })], true, now);
    const multi = attentionIndex([A({ issuer: "IMD Patna" }), A({ issuer: "CWC", hazard: "flood", severity: "Minor", relevance: "STATE" })], true, now);
    expect(multi.corroborationBonus).toBeCloseTo(0.1);
    expect(multi.score).toBeGreaterThan(single.score);
  });
});

describe("corroboration and escalation", () => {
  it("clusters rain and flood alerts from different agencies", () => {
    const c = corroborate([A({ issuer: "IMD Patna" }), A({ issuer: "CWC", hazard: "flood", issuedAt: "2026-10-15T04:00:00Z" }), A({ issuer: "IMD Patna", hazard: "heatwave" })]);
    expect(c[0]?.issuers.sort()).toEqual(["CWC", "IMD Patna"]);
    expect(c).toHaveLength(2);
  });
  it("flags a surge of alerts in the last 3 hours against a quiet baseline", () => {
    const base = Array.from({ length: 4 }, (_, i) => ({ issuedAt: new Date(now.getTime() - (10 + i * 8) * 3_600_000).toISOString() }));
    const surge = Array.from({ length: 6 }, (_, i) => ({ issuedAt: new Date(now.getTime() - i * 20 * 60_000).toISOString() }));
    const e = detectEscalation([...base, ...surge], now);
    expect(e.escalating).toBe(true);
    expect(e.trend).toBe("SURGING");
    expect(e.hourly).toHaveLength(48);
    expect(detectEscalation([], now).trend).toBe("QUIET");
  });
});

describe("national aggregation", () => {
  it("assigns states from area text, SDMA names and IMD offices — or leaves them unassigned", () => {
    expect(assignState({ areaDesc: "Patna district of Bihar", headline: "x", issuer: "CWC" })?.code).toBe("BR");
    expect(assignState({ areaDesc: null, headline: "Lightning likely", issuer: "Andhra Pradesh SDMA" })?.code).toBe("AP");
    expect(assignState({ areaDesc: null, headline: "Thunderstorm", issuer: "IMD Jaipur" })?.code).toBe("RJ");
    expect(assignState({ areaDesc: "Karaikal district of Puducherry", headline: "rain", issuer: "IMD Chennai" })?.code).toBe("PY");
    expect(assignState({ areaDesc: null, headline: "Thunderstorm", issuer: "IMD Chandigarh" })).toBeNull();
  });
  it("summarises states, totals and unassigned alerts", () => {
    const n = aggregateNational(
      [A({}), A({ areaDesc: "Siwan district of Bihar", severity: "Extreme" }), A({ areaDesc: null, issuer: "IMD Chandigarh", headline: "storm" }), A({ areaDesc: "Jaipur, Rajasthan", issuer: "IMD Jaipur", freshness: "EXPIRED" })],
      now,
    );
    expect(n.states[0]).toMatchObject({ code: "BR", active: 2, maxSeverity: "Extreme" });
    expect(n.unassigned).toBe(1);
    expect(n.totals).toMatchObject({ active: 3, total48h: 4, statesAffected: 1 });
  });
});

describe("route exposure", () => {
  const zone: [number, number][] = [[25.55, 85.05], [25.55, 85.25], [25.65, 85.25], [25.65, 85.05]];
  const through: [number, number][] = Array.from({ length: 21 }, (_, i) => [25.5 + i * 0.01, 85.1]);
  const around: [number, number][] = Array.from({ length: 21 }, (_, i) => [25.5 + i * 0.01, 85.4]);
  it("measures km inside alert areas and prefers the lower-exposure alternative", () => {
    expect(routeExposureKm(through, [zone])).toBeGreaterThan(9);
    expect(routeExposureKm(around, [zone])).toBe(0);
    const ranked = rankRoutesByExposure(
      [{ distanceKm: 22, durationMin: 30, path: through }, { distanceKm: 26, durationMin: 36, path: around }],
      [{ polygons: [zone], weight: 4 }],
    );
    expect(ranked[0]?.durationMin).toBe(36);
    expect(ranked[1]?.exposureKm).toBeGreaterThan(9);
  });
});