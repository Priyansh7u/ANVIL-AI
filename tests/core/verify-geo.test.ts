import { describe, expect, it } from "vitest";
import { verifyExtraction } from "../../src/lib/core/verify";
import { geolocationMessage, geolocationOutcome } from "../../src/lib/core/geo-permission";

const page = {
  url: "https://patna.nic.in/disaster",
  text: [
    "# Flood Relief Arrangements 2026",
    "Relief camp: Govt. Middle School, Danapur — capacity 500 persons, currently operational.",
    "District Emergency Operation Centre helpline 0612-2210118 (24x7).",
    "Do not enter flood waters; move to higher ground when instructed.",
  ].join("\n"),
};

describe("shelter / contact verification of extracted data", () => {
  it("keeps items whose quote and key value appear on the page", () => {
    const v = verifyExtraction(
      {
        shelters: [{ name: "Govt. Middle School, Danapur", capacity: 500, operationalStatus: "operational", evidenceQuote: "Relief camp: Govt. Middle School, Danapur — capacity 500 persons, currently operational." }],
        contacts: [{ label: "DEOC", phone: "0612-2210118", evidenceQuote: "District Emergency Operation Centre helpline 0612-2210118 (24x7)." }],
        advisories: [{ text: "Avoid flood water", evidenceQuote: "Do not enter flood waters; move to higher ground" }],
      },
      page,
      "2026-10-14T00:00:00Z",
      "AI_EXTRACTED_QUOTE_VERIFIED",
      "Patna",
    );
    expect(v.dropped).toBe(0);
    expect(v.shelters[0]?.capacity).toBe(500);
    expect(v.shelters[0]?.operationalStatus).toBe("operational");
    expect(v.contacts).toHaveLength(1);
    expect(v.advisories).toHaveLength(1);
  });

  it("drops hallucinated shelters, numbers not in the quote, and paraphrased quotes", () => {
    const v = verifyExtraction(
      {
        shelters: [
          { name: "Patna Stadium", evidenceQuote: "Patna Stadium is open as a shelter for 5000 people" },
          { name: "Govt. Middle School, Danapur", capacity: 900, evidenceQuote: "Relief camp: Govt. Middle School, Danapur — capacity 500 persons" },
        ],
        contacts: [
          { label: "DEOC", phone: "0612-2219999", evidenceQuote: "District Emergency Operation Centre helpline 0612-2210118" },
          { label: "Fake", phone: "112", evidenceQuote: "Call the helpline at any time for help" },
        ],
        advisories: [{ text: "Stay safe", evidenceQuote: "Residents should stay indoors at all times" }],
      },
      page,
      "2026-10-14T00:00:00Z",
      "AI_EXTRACTED_QUOTE_VERIFIED",
      "Patna",
    );
    expect(v.shelters).toHaveLength(1);
    // capacity 900 is not in the quote → removed rather than trusted
    expect(v.shelters[0]?.capacity).toBeNull();
    expect(v.contacts).toHaveLength(0);
    expect(v.advisories).toHaveLength(0);
    expect(v.dropped).toBe(4);
  });
});

describe("geolocation permission handling", () => {
  it("maps denied / timeout / unsupported to a manual-selection message", () => {
    expect(geolocationOutcome(1)).toBe("PERMISSION_DENIED");
    expect(geolocationOutcome(3)).toBe("TIMEOUT");
    expect(geolocationOutcome(2)).toBe("POSITION_UNAVAILABLE");
    expect(geolocationOutcome(null)).toBe("UNSUPPORTED");
    for (const o of ["PERMISSION_DENIED", "TIMEOUT", "UNSUPPORTED", "POSITION_UNAVAILABLE"] as const) {
      expect(geolocationMessage(o).toLowerCase()).toContain("district");
    }
  });
});
