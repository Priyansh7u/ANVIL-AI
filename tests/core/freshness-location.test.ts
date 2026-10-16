import { describe, expect, it } from "vitest";
import { assessAlertFreshness, assessFeedMode, relativeTime } from "../../src/lib/core/freshness";
import { districtVariants, matchAlertToPlace } from "../../src/lib/core/location-match";

const now = new Date("2026-10-14T06:00:00Z");

describe("stale alerts", () => {
  it("uses CAP expiry when present", () => {
    expect(assessAlertFreshness({ issuedAt: "2026-10-14T05:00:00Z", expiresAt: "2026-10-14T05:30:00Z", now })).toBe("EXPIRED");
    expect(assessAlertFreshness({ issuedAt: "2026-10-14T05:00:00Z", expiresAt: "2026-10-14T09:00:00Z", now })).toBe("ACTIVE");
  });
  it("treats alerts with no expiry older than 24h as STALE", () => {
    expect(assessAlertFreshness({ issuedAt: "2026-10-12T05:00:00Z", expiresAt: null, now })).toBe("STALE");
  });
  it("returns UNKNOWN for missing or future-dated timestamps", () => {
    expect(assessAlertFreshness({ issuedAt: null, expiresAt: null, now })).toBe("UNKNOWN");
    expect(assessAlertFreshness({ issuedAt: "2026-10-15T05:00:00Z", expiresAt: null, now })).toBe("UNKNOWN");
  });
  it("flags a feed whose own pubDate is old as STALE and an unreachable one as CACHED/UNAVAILABLE", () => {
    expect(assessFeedMode({ feedPublishedAt: "2026-10-13T20:00:00Z", fetchedLive: true, now })).toBe("STALE");
    expect(assessFeedMode({ feedPublishedAt: "2026-10-14T05:00:00Z", fetchedLive: true, now })).toBe("LIVE");
    expect(assessFeedMode({ feedPublishedAt: "2026-10-14T05:00:00Z", fetchedLive: false, now })).toBe("CACHED");
    expect(assessFeedMode({ feedPublishedAt: null, fetchedLive: false, now })).toBe("UNAVAILABLE");
  });
  it("formats relative times", () => {
    expect(relativeTime("2026-10-14T05:30:00Z", now)).toBe("30 min ago");
    expect(relativeTime(null, now)).toBe("unknown time");
  });
});

describe("location matching", () => {
  const delhiAlert = {
    areaDesc: "Central, East, New Delhi, North, North East, North West, Shahdara, South districts of Delhi",
    headline: "Heavy rain likely over Delhi",
    issuer: "IMD New Delhi",
  };
  it("matches Nominatim-style district names after stripping the state", () => {
    expect(districtVariants("North West Delhi", "Delhi")).toContain("north west");
    expect(matchAlertToPlace(delhiAlert, { district: "North West Delhi", state: "Delhi" })).toBe("DISTRICT");
  });
  it("falls back to STATE relevance and never invents a district match", () => {
    const patna = { areaDesc: "Patna district of Bihar", headline: "River Ganga flood", issuer: "CWC" };
    expect(matchAlertToPlace(patna, { district: "Gaya", state: "Bihar" })).toBe("STATE");
    expect(matchAlertToPlace(patna, { district: "Patna", state: "Bihar" })).toBe("DISTRICT");
    expect(matchAlertToPlace(patna, { district: "Pune", state: "Maharashtra" })).toBe("NONE");
  });
  it("uses the issuing IMD office as a weak state signal", () => {
    const a = { areaDesc: null, headline: "Thunderstorm likely in next 3 hours", issuer: "IMD Jaipur" };
    expect(matchAlertToPlace(a, { district: "Kota", state: "Rajasthan" })).toBe("STATE");
  });
  it("does not match short substrings inside other words", () => {
    const a = { areaDesc: "Eastern Ghats region", headline: "x", issuer: "IMD Chennai" };
    expect(matchAlertToPlace(a, { district: "East", state: "Sikkim" })).toBe("NONE");
  });
});
