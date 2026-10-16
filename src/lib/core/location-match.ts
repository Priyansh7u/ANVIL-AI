import type { LocationRelevance, Place } from "./types";

/**
 * Text-based matching of CAP area descriptions to a user's district/state.
 * SACHET CAP documents carry `areaDesc` text and LGD district codes; we match
 * on names because reverse geocoding gives names, not LGD codes. Matching is
 * conservative: a false "NONE" is preferred to a false "DISTRICT".
 */

const STATE_ALIASES: Record<string, string[]> = {
  delhi: ["delhi", "nct of delhi", "new delhi", "दिल्ली"],
  "jammu and kashmir": ["jammu and kashmir", "jammu & kashmir", "j&k"],
  "andaman and nicobar islands": ["andaman", "nicobar"],
  "dadra and nagar haveli and daman and diu": ["dadra", "daman", "diu"],
  odisha: ["odisha", "orissa"],
  puducherry: ["puducherry", "pondicherry", "karaikal"],
  uttarakhand: ["uttarakhand", "uttaranchal"],
  "uttar pradesh": ["uttar pradesh", "उत्तर प्रदेश"],
  bihar: ["bihar", "बिहार"],
  rajasthan: ["rajasthan", "राजस्थान"],
  "west bengal": ["west bengal", "पश्चिम बंगाल", "পশ্চিমবঙ্গ"],
};

/** IMD regional office / SDMA → states it typically issues for. Used only as a weak state signal. */
const ISSUER_STATES: Record<string, string[]> = {
  "imd new delhi": ["delhi"],
  "imd chandigarh": ["haryana", "punjab", "chandigarh"],
  "imd jaipur": ["rajasthan"],
  "imd lucknow": ["uttar pradesh"],
  "imd patna": ["bihar"],
  "imd dehradun": ["uttarakhand"],
  "imd chennai": ["tamil nadu", "puducherry"],
  "imd thiruvananthapuram": ["kerala"],
  "imd visakhapatnam": ["andhra pradesh"],
  "andhra pradesh sdma": ["andhra pradesh"],
};

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\b(district|dist\.?|zila|jila|tehsil|division)\b/g, " ")
    .replace(/[^\p{L}\p{N}\s&]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsPhrase(haystack: string, phrase: string): boolean {
  if (!phrase || phrase.length < 3) return false;
  const h = ` ${normalizeName(haystack)} `;
  const p = normalizeName(phrase);
  if (!p) return false;
  return h.includes(` ${p} `);
}

export function stateVariants(state: string | null): string[] {
  if (!state) return [];
  const n = normalizeName(state);
  return Array.from(new Set([n, ...(STATE_ALIASES[n] ?? [])]));
}

/** "North West Delhi" in state Delhi → ["north west delhi", "north west"] */
export function districtVariants(district: string | null, state: string | null): string[] {
  if (!district) return [];
  const d = normalizeName(district);
  const variants = new Set([d]);
  for (const sv of stateVariants(state)) {
    const stripped = d.replace(new RegExp(`\\b${sv.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), "").trim();
    if (stripped.length >= 3 && stripped !== d) variants.add(stripped);
  }
  return Array.from(variants);
}

export function matchAlertToPlace(
  alert: { areaDesc: string | null; headline: string; issuer: string },
  place: Pick<Place, "district" | "state">,
): LocationRelevance {
  const text = `${alert.areaDesc ?? ""} ${alert.headline}`;
  if (districtVariants(place.district, place.state).some((v) => containsPhrase(text, v))) {
    return "DISTRICT";
  }
  const states = stateVariants(place.state);
  if (states.some((v) => containsPhrase(text, v))) return "STATE";
  const issuerStates = ISSUER_STATES[normalizeName(alert.issuer)] ?? [];
  if (states.some((s) => issuerStates.includes(s))) return "STATE";
  return "NONE";
}
