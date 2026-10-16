import { describe, expect, it } from "vitest";
import { checkGrounding, fallbackKinds, unsupportedNumbers, type EvidenceItem } from "../../src/lib/core/grounding";

const evidence: EvidenceItem[] = [
  { id: "A1", kind: "ALERT", label: "IMD", url: "https://sachet.ndma.gov.in/x", text: "Heavy rain with winds 50-60 kmph likely over Patna. Instruction: Stay indoors." },
  { id: "C1", kind: "CONTACT", label: "ERSS — 112", url: "https://www.india.gov.in/directory/helpline", text: "Emergency: 112" },
  { id: "C2", kind: "CONTACT", label: "DEOC", url: "https://patna.nic.in", text: "DEOC helpline 0612-2210118" },
];

describe("Ask ANVIL grounding", () => {
  it("accepts answers that cite known sources and use only sourced numbers", () => {
    const g = checkGrounding("Heavy rain is likely [A1]. Call the DEOC on 0612 2210118 [C2] or 112 [C1].", evidence, true);
    expect(g.ok).toBe(true);
    expect(g.citations).toEqual(["A1", "C2", "C1"]);
  });
  it("rejects invented phone numbers", () => {
    const g = checkGrounding("Call the flood cell on 0612-2219999 [C2].", evidence, true);
    expect(g.ok).toBe(false);
    expect(unsupportedNumbers("Call 0612-2219999", evidence)).toEqual(["06122219999"]);
  });
  it("rejects citations to sources that were never provided", () => {
    expect(checkGrounding("A camp is open at the stadium [S4].", evidence, true).ok).toBe(false);
  });
  it("rejects uncited claims when evidence exists", () => {
    expect(checkGrounding("There is a relief camp at the school.", evidence, true).ok).toBe(false);
  });
  it("allows an honest 'not in sources' answer without citations", () => {
    expect(checkGrounding("The sources don't say. Call 112.", evidence, false).ok).toBe(true);
  });
  it("routes fallback questions in English and Hindi", () => {
    expect(fallbackKinds("Where is the nearest relief camp?")).toContain("SHELTER");
    expect(fallbackKinds("हेल्पलाइन नंबर क्या है?")).toContain("CONTACT");
    expect(fallbackKinds("क्या बाढ़ की चेतावनी है?")).toContain("ALERT");
  });
});