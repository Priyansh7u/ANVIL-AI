import { normalizeName } from "./location-match";

/**
 * Reference geography for Indian states and union territories: names, common
 * aliases (incl. Hindi) and an approximate geographic centre used only to
 * place a state-level summary bubble on the national map. This is static
 * geography, not alert data.
 */
export interface StateRef {
  code: string;
  name: string;
  aliases: string[];
  center: [number, number];
}

export const INDIA_STATES: StateRef[] = [
  { code: "AN", name: "Andaman and Nicobar Islands", aliases: ["andaman", "nicobar"], center: [11.7, 92.7] },
  { code: "AP", name: "Andhra Pradesh", aliases: ["andhra pradesh", "आंध्र प्रदेश", "ఆంధ్రప్రదేశ్"], center: [15.9, 79.7] },
  { code: "AR", name: "Arunachal Pradesh", aliases: ["arunachal"], center: [28.2, 94.7] },
  { code: "AS", name: "Assam", aliases: ["assam", "असम"], center: [26.2, 92.9] },
  { code: "BR", name: "Bihar", aliases: ["bihar", "बिहार"], center: [25.6, 85.6] },
  { code: "CH", name: "Chandigarh", aliases: ["chandigarh"], center: [30.73, 76.78] },
  { code: "CT", name: "Chhattisgarh", aliases: ["chhattisgarh", "छत्तीसगढ़"], center: [21.3, 81.9] },
  { code: "DN", name: "Dadra and Nagar Haveli and Daman and Diu", aliases: ["dadra", "daman", "diu"], center: [20.4, 72.9] },
  { code: "DL", name: "Delhi", aliases: ["delhi", "new delhi", "दिल्ली"], center: [28.65, 77.15] },
  { code: "GA", name: "Goa", aliases: ["goa"], center: [15.4, 74.0] },
  { code: "GJ", name: "Gujarat", aliases: ["gujarat", "गुजरात"], center: [22.7, 71.6] },
  { code: "HR", name: "Haryana", aliases: ["haryana", "हरियाणा"], center: [29.1, 76.1] },
  { code: "HP", name: "Himachal Pradesh", aliases: ["himachal", "हिमाचल"], center: [31.9, 77.2] },
  { code: "JK", name: "Jammu and Kashmir", aliases: ["jammu", "kashmir", "j&k"], center: [33.7, 75.1] },
  { code: "JH", name: "Jharkhand", aliases: ["jharkhand", "झारखंड"], center: [23.6, 85.3] },
  { code: "KA", name: "Karnataka", aliases: ["karnataka", "कर्नाटक"], center: [15.3, 75.7] },
  { code: "KL", name: "Kerala", aliases: ["kerala", "केरल", "കേരള"], center: [10.4, 76.4] },
  { code: "LA", name: "Ladakh", aliases: ["ladakh", "leh", "kargil"], center: [34.2, 77.6] },
  { code: "LD", name: "Lakshadweep", aliases: ["lakshadweep"], center: [10.6, 72.6] },
  { code: "MP", name: "Madhya Pradesh", aliases: ["madhya pradesh", "मध्य प्रदेश"], center: [23.5, 78.4] },
  { code: "MH", name: "Maharashtra", aliases: ["maharashtra", "महाराष्ट्र"], center: [19.5, 75.7] },
  { code: "MN", name: "Manipur", aliases: ["manipur"], center: [24.7, 93.9] },
  { code: "ML", name: "Meghalaya", aliases: ["meghalaya"], center: [25.5, 91.3] },
  { code: "MZ", name: "Mizoram", aliases: ["mizoram"], center: [23.2, 92.8] },
  { code: "NL", name: "Nagaland", aliases: ["nagaland"], center: [26.1, 94.5] },
  { code: "OR", name: "Odisha", aliases: ["odisha", "orissa", "ओडिशा"], center: [20.5, 84.4] },
  { code: "PY", name: "Puducherry", aliases: ["puducherry", "pondicherry", "karaikal"], center: [11.94, 79.8] },
  { code: "PB", name: "Punjab", aliases: ["punjab", "पंजाब"], center: [30.9, 75.4] },
  { code: "RJ", name: "Rajasthan", aliases: ["rajasthan", "राजस्थान"], center: [26.6, 73.8] },
  { code: "SK", name: "Sikkim", aliases: ["sikkim"], center: [27.5, 88.5] },
  { code: "TN", name: "Tamil Nadu", aliases: ["tamil nadu", "तमिलनाडु"], center: [11.1, 78.4] },
  { code: "TG", name: "Telangana", aliases: ["telangana", "तेलंगाना"], center: [17.9, 79.1] },
  { code: "TR", name: "Tripura", aliases: ["tripura"], center: [23.8, 91.6] },
  { code: "UP", name: "Uttar Pradesh", aliases: ["uttar pradesh", "उत्तर प्रदेश"], center: [27.0, 80.9] },
  { code: "UK", name: "Uttarakhand", aliases: ["uttarakhand", "उत्तराखंड"], center: [30.1, 79.2] },
  { code: "WB", name: "West Bengal", aliases: ["west bengal", "पश्चिम बंगाल", "পশ্চিমবঙ্গ"], center: [23.0, 87.9] },
];

/** IMD regional offices → the single state they mainly serve (ambiguous offices are omitted on purpose). */
const ISSUER_OFFICE: Record<string, string> = {
  "imd new delhi": "DL",
  "imd jaipur": "RJ",
  "imd lucknow": "UP",
  "imd patna": "BR",
  "imd dehradun": "UK",
  "imd chennai": "TN",
  "imd thiruvananthapuram": "KL",
  "imd visakhapatnam": "AP",
  "imd amaravati": "AP",
  "imd bhubaneswar": "OR",
  "imd mumbai": "MH",
  "imd ahmedabad": "GJ",
  "imd bhopal": "MP",
  "imd raipur": "CT",
  "imd ranchi": "JH",
  "imd guwahati": "AS",
  "imd hyderabad": "TG",
  "imd bengaluru": "KA",
  "imd shimla": "HP",
  "imd srinagar": "JK",
  "imd goa": "GA",
  "imd gangtok": "SK",
};

function hasPhrase(text: string, alias: string): boolean {
  const a = normalizeName(alias);
  if (a.length < 3) return false;
  return ` ${text} `.includes(` ${a} `);
}

/**
 * Which state does an alert concern? Text first (area description, headline,
 * issuer such as "Andhra Pradesh SDMA"), then the issuing IMD office.
 * Returns null when it cannot be determined — never a guess.
 */
export function assignState(alert: { areaDesc: string | null; headline: string; issuer: string }): StateRef | null {
  const area = normalizeName(alert.areaDesc ?? "");
  // An IMD office name ("IMD Chandigarh") is where the bulletin came from, not necessarily the affected
  // state, so only non-IMD issuer names (e.g. "Andhra Pradesh SDMA") are used as text evidence.
  const issuerText = /^imd\b/i.test(alert.issuer.trim()) ? "" : alert.issuer;
  const rest = normalizeName(`${alert.headline} ${issuerText}`);
  // Prefer a state named in the official area description.
  for (const text of [area, rest]) {
    if (!text) continue;
    const hits = INDIA_STATES.filter((s) => [s.name, ...s.aliases].some((al) => hasPhrase(text, al)));
    if (hits.length === 1) return hits[0] as StateRef;
    if (hits.length > 1) {
      // "... district of Bihar" — the state usually comes last.
      const scored = hits
        .map((s) => ({ s, pos: Math.max(...[s.name, ...s.aliases].map((al) => ` ${text} `.lastIndexOf(` ${normalizeName(al)} `))) }))
        .sort((a, b) => b.pos - a.pos);
      return scored[0]?.s ?? null;
    }
  }
  const code = ISSUER_OFFICE[normalizeName(alert.issuer)];
  return code ? (INDIA_STATES.find((s) => s.code === code) ?? null) : null;
}