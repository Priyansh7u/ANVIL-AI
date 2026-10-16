import { describe, expect, it } from "vitest";
import { classifyHazard, dedupeAlerts, extractIssuer, normalizeAlert, parseCap, parseRss } from "../../src/lib/core/cap";
import { decodeEntities } from "../../src/lib/core/xml";
import { CAP_SAMPLE, RSS_SAMPLE } from "../fixtures/sachet";

describe("SACHET RSS parsing", () => {
  it("parses channel pubDate and valid items, skipping malformed ones", () => {
    const feed = parseRss(RSS_SAMPLE);
    expect(feed.title).toBe("All India: CAP Disaster Alert Feeds");
    expect(feed.publishedAt).toBe("2026-10-13T11:02:00.000Z");
    expect(feed.items).toHaveLength(2); // the empty-title item is rejected
    expect(feed.items[0]?.guid).toBe("1791765435882022");
    expect(feed.items[1]?.author).toContain("CWC");
  });

  it("extracts the issuing office from the author field", () => {
    expect(extractIssuer("controlroom@ndma.gov.in (IMD Chennai)")).toBe("IMD Chennai");
    expect(extractIssuer(null)).toBe("NDMA SACHET");
  });

  it("decodes XML entities", () => {
    expect(decodeEntities("Jammu &amp; Kashmir &#8212; &#x26;")).toBe("Jammu & Kashmir — &");
  });
});

describe("CAP parsing", () => {
  it("reads severity, timestamps, area and instruction", () => {
    const cap = parseCap(CAP_SAMPLE);
    expect(cap).not.toBeNull();
    expect(cap?.identifier).toBe("IN-1791765435882022_48");
    expect(cap?.severity).toBe("Extreme");
    expect(cap?.expires).toBe("2026-10-12T02:35:00.000Z");
    expect(cap?.areas[0]?.areaDesc).toContain("North West");
    expect(cap?.areas[0]?.geocodes[0]).toEqual({ valueName: "LGD District Code", value: "83" });
    expect(cap?.instruction).toBe("Please follow SDMA guidelines.");
  });

  it("rejects documents without an identifier (invalid extracted data)", () => {
    expect(parseCap("<alert><info><severity>Extreme</severity></info></alert>")).toBeNull();
  });

  it("maps unknown severities to Unknown instead of guessing", () => {
    const cap = parseCap(CAP_SAMPLE.replace("Extreme", "Catastrophic"));
    expect(cap?.severity).toBe("Unknown");
  });
});

describe("normalizeAlert", () => {
  const feed = parseRss(RSS_SAMPLE);
  it("marks alerts past their CAP expiry as EXPIRED", () => {
    const a = normalizeAlert(feed.items[0]!, parseCap(CAP_SAMPLE), "2026-10-14T00:00:00Z", new Date("2026-10-14T00:00:00Z"));
    expect(a.freshness).toBe("EXPIRED");
    expect(a.partial).toBe(false);
    expect(a.hazard).toBe("heavy_rain");
  });

  it("keeps RSS-only entries but flags them partial with Unknown severity", () => {
    const a = normalizeAlert(feed.items[1]!, null, "2026-10-13T05:00:00Z", new Date("2026-10-13T05:00:00Z"));
    expect(a.partial).toBe(true);
    expect(a.severity).toBe("Unknown");
    expect(a.freshness).toBe("ACTIVE");
    expect(a.hazard).toBe("flood");
  });

  it("dedupes repeated publications of the same message", () => {
    const a = normalizeAlert(feed.items[1]!, null, "x");
    expect(dedupeAlerts([a, { ...a, id: "other" }])).toHaveLength(1);
  });
});

describe("classifyHazard", () => {
  it("handles Hindi and English text", () => {
    expect(classifyHazard("उत्तर प्रदेश में घाघरा नदी बाढ़ की स्थिति")).toBe("flood");
    expect(classifyHazard("Heat wave conditions likely")).toBe("heatwave");
    expect(classifyHazard("Thunderstorm with lightning")).toBe("thunderstorm");
    expect(classifyHazard("Something unrelated")).toBe("other");
  });
});
