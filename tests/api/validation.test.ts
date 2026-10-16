import { describe, expect, it } from "vitest";
import {
  familyStatusSchema,
  pageExtractionSchema,
  preferencesSchema,
  researchCreateSchema,
  routeQuerySchema,
  simulatorSchema,
  tinyfishFetchResponse,
  tinyfishSearchResponse,
} from "@/lib/validation";

describe("API input validation", () => {
  it("rejects research tasks without a district or state", () => {
    expect(researchCreateSchema.safeParse({ place: { label: "Somewhere", district: null, state: null } }).success).toBe(false);
  });
  it("rejects injection-like characters in place names", () => {
    expect(researchCreateSchema.safeParse({ place: { label: "x", district: "Patna<script>", state: "Bihar" } }).success).toBe(false);
  });
  it("rejects out-of-range coordinates", () => {
    expect(routeQuerySchema.safeParse({ fromLat: 91, fromLon: 0, toLat: 0, toLon: 0 }).success).toBe(false);
    expect(routeQuerySchema.safeParse({ fromLat: "28.6", fromLon: "77.2", toLat: "28.7", toLon: "77.1" }).success).toBe(true);
  });
  it("requires explicit consent for family status sharing", () => {
    expect(familyStatusSchema.safeParse({ displayName: "Asha", status: "SAFE", consent: false }).success).toBe(false);
    expect(familyStatusSchema.safeParse({ displayName: "Asha", status: "SAFE", consent: true }).success).toBe(true);
  });
  it("strips coordinates from stored preferences (privacy)", () => {
    const r = preferencesSchema.parse({
      clientId: "6f1c1c1e-5a3b-4e7f-9a51-0c4f2b8f3d11",
      place: { label: "Patna, Bihar", district: "Patna", state: "Bihar", lat: 25.6123, lon: 85.1456 },
      lat: 25.6,
    } as unknown);
    expect(JSON.stringify(r)).not.toContain("25.6");
  });
  it("only accepts the published simulator scenario and clamps demand", () => {
    expect(simulatorSchema.safeParse({ scenarioId: "real-patna", closedShelterIds: [] }).success).toBe(false);
    expect(simulatorSchema.safeParse({ scenarioId: "riverbend-flood-v1", demandMultiplier: 10 }).success).toBe(false);
  });
});

describe("external response validation", () => {
  it("accepts documented TinyFish Search and Fetch payloads", () => {
    expect(tinyfishSearchResponse.safeParse({ query: "q", results: [{ position: 1, site_name: "x", title: "t", snippet: "s", url: "https://a.gov.in" }] }).success).toBe(true);
    expect(tinyfishFetchResponse.safeParse({ results: [{ url: "https://a.gov.in", final_url: "https://a.gov.in", title: "t", format: "markdown", text: "hi" }], errors: [] }).success).toBe(true);
  });
  it("rejects malformed payloads", () => {
    expect(tinyfishSearchResponse.safeParse({ results: [{ title: "no url" }] }).success).toBe(false);
    expect(tinyfishFetchResponse.safeParse("<html>").success).toBe(false);
  });
  it("rejects AI extractions without evidence quotes", () => {
    expect(pageExtractionSchema.safeParse({ shelters: [{ name: "School" }], contacts: [], advisories: [] }).success).toBe(false);
    expect(pageExtractionSchema.safeParse({ shelters: [], contacts: [{ label: "DEOC", phone: "1077", evidenceQuote: "short" }], advisories: [] }).success).toBe(false);
  });
});
