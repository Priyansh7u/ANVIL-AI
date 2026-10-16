import { describe, expect, it } from "vitest";
import {
  alertLevelOf,
  buildIntelReport,
  checkSummaryGrounding,
  classifySource,
  dedupeFindings,
  detectFindingConflicts,
  diffAgainstKnown,
  findLabelledDate,
  fingerprint,
  freshnessOf,
  geoRelevance,
  isWithdrawal,
  mentionsHazard,
  parseLooseDate,
  verificationLabel,
  type Finding,
} from "../../src/lib/core/hazard-intel";
import { directionsUrl, overpassQuery, parseOverpass } from "../../src/lib/core/nearby";

const now = new Date("2026-10-15T06:00:00Z");
const F = (o: Partial<Finding>): Finding => ({
  id: fingerprint(`${o.title ?? "t"} ${o.summary ?? "s"}`),
  itemKey: o.sourceUrl ?? "k",
  title: "Orange alert for heavy rain in Patna",
  summary: "IMD has issued an orange alert for heavy rainfall in Patna district.",
  hazard: "heavy_rain",
  location: "Patna",
  relevance: "DISTRICT",
  sourceName: "India Meteorological Department",
  sourceUrl: "https://mausam.imd.gov.in/patna",
  sourceCategory: "OFFICIAL",
  publishedAt: "2026-10-15T03:00:00Z",
  publishedRaw: null,
  publishedBasis: "PAGE_TEXT",
  retrievedAt: now.toISOString(),
  evidenceQuote: "orange alert for heavy rainfall",
  evidenceVerified: true,
  freshness: "FRESH",
  alertLevel: "ORANGE",
  withdrawal: false,
  origin: "TINYFISH_FETCH",
  corroboratedBy: [],
  conflictsWith: [],
  ...o,
});

describe("classifySource", () => {
  it("names official agencies", () => {
    expect(classifySource("https://mausam.imd.gov.in/x").sourceName).toBe("India Meteorological Department");
    expect(classifySource("https://sachet.ndma.gov.in/x").sourceName).toBe("NDMA SACHET");
    expect(classifySource("https://patna.nic.in/notice").category).toBe("OFFICIAL");
  });
  it("treats news as secondary and others as unverified", () => {
    expect(classifySource("https://www.thehindu.com/news/a").category).toBe("SECONDARY");
    expect(classifySource("https://randomblog.example.com/a").category).toBe("UNVERIFIED");
    expect(classifySource("https://gov.in.evil.com/a").category).toBe("UNVERIFIED");
  });
});

describe("dates", () => {
  it("parses common formats in IST and rejects nonsense", () => {
    expect(parseLooseDate("2026-10-14T10:00:00Z", now)).toBe("2026-10-14T10:00:00.000Z");
    expect(parseLooseDate("14 Oct 2026", now)).toBe("2026-10-13T18:30:00.000Z");
    expect(parseLooseDate("October 14, 2026", now)).toBe("2026-10-13T18:30:00.000Z");
    expect(parseLooseDate("14/10/2026", now)).toBe("2026-10-13T18:30:00.000Z");
    expect(parseLooseDate("3 hours ago", now)).toBe("2026-10-15T03:00:00.000Z");
    expect(parseLooseDate("31/13/2026", now)).toBeNull();
    expect(parseLooseDate("20 Dec 2026", now)).toBeNull(); // future
    expect(parseLooseDate("sometime", now)).toBeNull();
    expect(parseLooseDate(null, now)).toBeNull();
  });
  it("only accepts labelled page dates", () => {
    expect(findLabelledDate("Press release. Updated on: 14 Oct 2026. Heavy rain…", now)?.raw).toBe("14 Oct 2026");
    expect(findLabelledDate("Founded 12 Jan 2001 as a department", now)).toBeNull();
  });
  it("classifies freshness", () => {
    expect(freshnessOf("2026-10-15T00:00:00Z", now)).toBe("FRESH");
    expect(freshnessOf("2026-10-13T00:00:00Z", now)).toBe("RECENT");
    expect(freshnessOf("2026-10-01T00:00:00Z", now)).toBe("POTENTIALLY_STALE");
    expect(freshnessOf(null, now)).toBe("TIMESTAMP_UNAVAILABLE");
  });
});

describe("text signals", () => {
  it("detects relevance, levels, withdrawal and hazards", () => {
    expect(geoRelevance("Heavy rain in Patna and Gaya", { district: "Patna", state: "Bihar" })).toBe("DISTRICT");
    expect(geoRelevance("Heavy rain across Bihar", { district: "Patna", state: "Bihar" })).toBe("STATE");
    expect(geoRelevance("Heavy rain in Kerala", { district: "Patna", state: "Bihar" })).toBe("NOT_LOCATION_SPECIFIC");
    expect(alertLevelOf("Yellow alert today, red alert tomorrow")).toBe("RED");
    expect(alertLevelOf("पटना में ऑरेंज अलर्ट")).toBe("ORANGE");
    expect(alertLevelOf("Light rain likely")).toBeNull();
    expect(isWithdrawal("The flood warning has been withdrawn")).toBe(true);
    expect(mentionsHazard("River above danger mark", "flood")).toBe(true);
    expect(mentionsHazard("Sunny weather", "flood")).toBe(false);
  });
});

describe("dedupe and conflicts", () => {
  it("merges near-duplicates keeping the official one", () => {
    const a = F({ sourceCategory: "SECONDARY", sourceName: "NDTV", sourceUrl: "https://ndtv.com/a", summary: "IMD has issued an orange alert for heavy rainfall in Patna district today." });
    const b = F({});
    const { findings, merged } = dedupeFindings([a, b]);
    expect(merged).toBe(1);
    expect(findings[0]?.sourceCategory).toBe("OFFICIAL");
    expect(findings[0]?.corroboratedBy[0]?.sourceName).toBe("NDTV");
  });
  it("flags level disagreement and withdrawal vs active", () => {
    const a = F({});
    const b = F({ title: "Red alert Patna", summary: "Red alert issued for extremely heavy rain in Patna.", sourceUrl: "https://ndtv.com/b", sourceName: "NDTV", sourceCategory: "SECONDARY", alertLevel: "RED" });
    const c = F({ title: "Warning lifted", summary: "The rain warning for Patna has been withdrawn.", sourceUrl: "https://patna.nic.in/c", sourceName: "Patna district", alertLevel: null, withdrawal: true });
    const conflicts = detectFindingConflicts([a, b, c]);
    expect(conflicts.some((x) => x.kind === "ALERT_LEVEL")).toBe(true);
    expect(conflicts.some((x) => x.kind === "WITHDRAWN_VS_ACTIVE")).toBe(true);
  });
});

describe("report", () => {
  it("states insufficient evidence when there is no fresh official finding", () => {
    const r = buildIntelReport({ findings: [F({ sourceCategory: "SECONDARY", sourceUrl: "https://ndtv.com/x" })], conflicts: [], place: { label: "Patna, Bihar", district: "Patna", state: "Bihar" }, hazard: "heavy_rain", gaps: [], guidance: ["Keep phones charged."], now });
    expect(r.insufficientEvidence).toBe(true);
    expect(r.executiveSummary).toContain("could not establish");
    expect(r.nextSteps[0]?.authority).toBe("GUIDANCE");
  });
  it("summarises fresh official findings and lists advisories first", () => {
    const f = F({ instruction: "Avoid travel to low-lying areas." });
    const r = buildIntelReport({ findings: [f], conflicts: [], place: { label: "Patna, Bihar", district: "Patna", state: "Bihar" }, hazard: "heavy_rain", gaps: [], guidance: ["Keep phones charged."], now });
    expect(r.insufficientEvidence).toBe(false);
    expect(r.nextSteps[0]?.authority).toBe("OFFICIAL");
    expect(r.affectedAreas.map((a) => a.name)).toContain("Patna");
    expect(verificationLabel(f)).toBe("Official source");
  });
  it("checks grounding of AI summaries", () => {
    const src = [{ ref: "F1", text: "Orange alert, 115 mm rain expected" }];
    expect(checkSummaryGrounding("An orange alert is in force [F1].", src)).toBe(true);
    expect(checkSummaryGrounding("An orange alert with 200 mm rain [F1].", src)).toBe(false);
    expect(checkSummaryGrounding("An orange alert [F9].", src)).toBe(false);
    expect(checkSummaryGrounding("No citations here.", src)).toBe(false);
  });
});

describe("monitor diff", () => {
  it("reports only new and changed items", () => {
    const d1 = diffAgainstKnown({}, [{ itemKey: "a", id: "1" }, { itemKey: "b", id: "2" }]);
    expect(d1.newKeys).toEqual(["a", "b"]);
    const d2 = diffAgainstKnown(d1.next, [{ itemKey: "a", id: "1" }, { itemKey: "b", id: "3" }, { itemKey: "c", id: "4" }]);
    expect(d2.newKeys).toEqual(["c"]);
    expect(d2.changedKeys).toEqual(["b"]);
  });
});

describe("nearby (Overpass)", () => {
  it("builds a bounded query and parses facilities", () => {
    const q = overpassQuery(25.6, 85.1, 999_999, ["hospital", "shelter"]);
    expect(q).toContain("around:25000,25.6000,85.1000");
    expect(q).toContain('"social_facility"="shelter"');
    expect(q).not.toContain("fire_station");
    const parsed = parseOverpass(
      {
        elements: [
          { type: "node", id: 1, lat: 25.61, lon: 85.1, timestamp: "2025-01-01T00:00:00Z", tags: { amenity: "hospital", name: "City Hospital", phone: "+91 612 222 3333; 112", emergency: "yes" } },
          { type: "way", id: 2, center: { lat: 25.6, lon: 85.12 }, tags: { amenity: "police", name: "Kotwali PS" } },
          { type: "node", id: 3, lat: 25.6, lon: 85.1, tags: { amenity: "clinic" } },
          { type: "node", id: 1, lat: 25.61, lon: 85.1, tags: { amenity: "hospital", name: "dup" } },
        ],
      },
      [25.6, 85.1],
    );
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.name).toBe("City Hospital");
    expect(parsed[0]?.phone).toBe("+91 612 222 3333");
    expect(parsed[0]?.emergencyDept).toBe(true);
    expect(parsed[1]?.osmUrl).toBe("https://www.openstreetmap.org/way/2");
    expect(directionsUrl([25.6, 85.1], [25.61, 85.1])).toContain("route=25.60000%2C85.10000%3B25.61000%2C85.10000");
  });
});

describe("hashKey", () => {
  it("is stable, dot-free and distinguishes URLs", async () => {
    const { hashKey } = await import("../../src/lib/core/hazard-intel");
    const a = hashKey("https://patna.nic.in/notice#abc");
    expect(a).toBe(hashKey("https://patna.nic.in/notice#abc"));
    expect(a.includes(".")).toBe(false);
    expect(a).not.toBe(hashKey("https://patna.nic.in/notice#abd"));
  });
});