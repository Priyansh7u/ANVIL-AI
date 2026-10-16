import { normalizeForMatch } from "./evidence";
import { districtVariants, normalizeName, stateVariants } from "./location-match";
import { isOfficialIndianDomain } from "./url-safety";
import type { HazardType } from "./types";

/**
 * Pure logic for the live hazard-intelligence research agent:
 * source classification, publication-date handling (never invented),
 * freshness, geographic relevance, de-duplication, conflict detection,
 * report assembly and monitor change detection.
 */

// ── Stages ───────────────────────────────────────────────────────────────────

export const HAZARD_STAGES = [
  "INITIALIZING",
  "DISCOVERING_SOURCES",
  "RESEARCHING",
  "EXTRACTING_EVIDENCE",
  "VALIDATING_FINDINGS",
  "PREPARING_REPORT",
  "COMPLETED",
] as const;
export type HazardStage = (typeof HAZARD_STAGES)[number] | "PARTIAL" | "FAILED" | "CANCELLED";
export const TERMINAL_STAGES: HazardStage[] = ["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"];
export const STAGE_LABEL: Record<HazardStage, string> = {
  INITIALIZING: "Initializing",
  DISCOVERING_SOURCES: "Discovering sources",
  RESEARCHING: "Researching",
  EXTRACTING_EVIDENCE: "Extracting evidence",
  VALIDATING_FINDINGS: "Validating findings",
  PREPARING_REPORT: "Preparing report",
  COMPLETED: "Completed",
  PARTIAL: "Partial",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

/** Where an event came from: an external provider's own progress, or ANVIL's processing. */
export type EventOrigin = "APP" | "SACHET" | "TINYFISH_SEARCH" | "TINYFISH_FETCH" | "TINYFISH_AGENT" | "AI";

// ── Hazards ──────────────────────────────────────────────────────────────────

export type ResearchHazard = Exclude<HazardType, "other" | "high_waves" | "avalanche" | "fire"> | "all";

export const HAZARD_PROFILES: Record<ResearchHazard, { label: string; terms: string[]; query: string }> = {
  all: { label: "All hazards", terms: [], query: "disaster warning advisory" },
  flood: { label: "Flood", terms: ["flood", "flooding", "inundat", "water level", "danger mark", "बाढ़"], query: "flood warning river water level" },
  heavy_rain: { label: "Heavy rainfall", terms: ["heavy rain", "rainfall", "downpour", "waterlogging", "बारिश", "वर्षा"], query: "heavy rainfall warning" },
  cyclone: { label: "Cyclone", terms: ["cyclone", "cyclonic", "depression", "storm surge", "चक्रवात"], query: "cyclone warning" },
  heatwave: { label: "Heatwave", terms: ["heat wave", "heatwave", "high temperature", "लू"], query: "heatwave warning" },
  earthquake: { label: "Earthquake", terms: ["earthquake", "tremor", "magnitude", "seismic", "भूकंप"], query: "earthquake" },
  landslide: { label: "Landslide", terms: ["landslide", "landslip", "mudslide", "भूस्खलन"], query: "landslide warning" },
  thunderstorm: { label: "Thunderstorm / lightning", terms: ["thunderstorm", "lightning", "squall", "hailstorm", "आंधी", "बिजली"], query: "thunderstorm lightning warning" },
  cold_wave: { label: "Cold wave / fog", terms: ["cold wave", "cold day", "dense fog", "शीतलहर", "कोहरा"], query: "cold wave fog warning" },
  tsunami: { label: "Tsunami", terms: ["tsunami", "सुनामी"], query: "tsunami warning" },
};

export function mentionsHazard(text: string, hazard: ResearchHazard): boolean {
  if (hazard === "all") {
    return Object.values(HAZARD_PROFILES).some((p) => p.terms.some((t) => text.toLowerCase().includes(t)));
  }
  const t = text.toLowerCase();
  return HAZARD_PROFILES[hazard].terms.some((term) => t.includes(term));
}

// ── Sources ──────────────────────────────────────────────────────────────────

export type SourceCategory = "OFFICIAL" | "SECONDARY" | "UNVERIFIED";

const OFFICIAL_NAMES: [RegExp, string][] = [
  [/(^|\.)sachet\.ndma\.gov\.in$/, "NDMA SACHET"],
  [/(^|\.)ndma\.gov\.in$/, "National Disaster Management Authority"],
  [/(^|\.)(mausam\.)?imd\.gov\.in$/, "India Meteorological Department"],
  [/(^|\.)cwc\.gov\.in$/, "Central Water Commission"],
  [/(^|\.)india-water\.gov\.in$/, "Central Water Commission (flood forecasting)"],
  [/(^|\.)incois\.gov\.in$/, "INCOIS"],
  [/(^|\.)seismo\.gov\.in$/, "National Center for Seismology"],
  [/(^|\.)pib\.gov\.in$/, "Press Information Bureau"],
  [/(^|\.)ndrf\.gov\.in$/, "NDRF"],
];

/** Established news organisations, treated as SECONDARY (reporting, not issuing) sources. */
const NEWS: Record<string, string> = {
  "thehindu.com": "The Hindu",
  "indianexpress.com": "The Indian Express",
  "timesofindia.indiatimes.com": "The Times of India",
  "hindustantimes.com": "Hindustan Times",
  "ndtv.com": "NDTV",
  "livemint.com": "Mint",
  "deccanherald.com": "Deccan Herald",
  "newindianexpress.com": "The New Indian Express",
  "telegraphindia.com": "The Telegraph",
  "indiatoday.in": "India Today",
  "news18.com": "News18",
  "thewire.in": "The Wire",
  "scroll.in": "Scroll",
  "theprint.in": "ThePrint",
  "bbc.com": "BBC",
  "bbc.co.uk": "BBC",
  "reuters.com": "Reuters",
  "ptinews.com": "Press Trust of India",
  "aninews.in": "ANI",
  "business-standard.com": "Business Standard",
  "economictimes.indiatimes.com": "The Economic Times",
  "tribuneindia.com": "The Tribune",
  "bhaskar.com": "Dainik Bhaskar",
  "jagran.com": "Dainik Jagran",
  "amarujala.com": "Amar Ujala",
  "livehindustan.com": "Hindustan",
  "abplive.com": "ABP Live",
  "zeenews.india.com": "Zee News",
};

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function classifySource(url: string, publisher?: string | null): { category: SourceCategory; sourceName: string } {
  const host = hostOf(url);
  if (!host) return { category: "UNVERIFIED", sourceName: "Unknown source" };
  if (isOfficialIndianDomain(host)) {
    const named = OFFICIAL_NAMES.find(([re]) => re.test(host));
    return { category: "OFFICIAL", sourceName: named?.[1] ?? `${host} (government website)` };
  }
  const news = Object.entries(NEWS).find(([d]) => host === d || host.endsWith(`.${d}`));
  if (news) return { category: "SECONDARY", sourceName: news[1] };
  return { category: "UNVERIFIED", sourceName: publisher?.trim() || host };
}

// ── Publication dates (never invented) ──────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5,
  jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

function valid(d: Date, now: Date): string | null {
  const t = d.getTime();
  if (Number.isNaN(t)) return null;
  if (d.getUTCFullYear() < 2000) return null;
  if (t > now.getTime() + 36 * 3_600_000) return null; // publication dates can't be in the future
  return d.toISOString();
}

/**
 * Parse a date string as it appears on a page or in provider metadata.
 * Supports ISO, "13 Oct 2026", "October 13, 2026", Indian DD/MM/YYYY and
 * relative forms ("3 hours ago") resolved against `now`. Returns null when
 * the text is ambiguous or implausible — never a guess.
 */
export function parseLooseDate(raw: string | null | undefined, now: Date = new Date()): string | null {
  if (!raw) return null;
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s || s.length > 80) return null;

  const rel = s.toLowerCase().match(/^(\d{1,3})\s*(minute|min|hour|hr|day|week)s?\s+ago$/);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2] as string;
    const ms = unit.startsWith("min") ? 60_000 : unit.startsWith("h") ? 3_600_000 : unit === "day" ? 86_400_000 : 7 * 86_400_000;
    return valid(new Date(now.getTime() - n * ms), now);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return valid(new Date(s.length === 10 ? `${s}T00:00:00+05:30` : s), now);

  // 13 Oct 2026 / 13 October, 2026 / 13th October 2026
  let m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s\-.]+([A-Za-z]{3,9})[\s\-.,]+(\d{4})/);
  if (m && MONTHS[(m[2] as string).toLowerCase()] !== undefined) {
    return valid(new Date(Date.UTC(Number(m[3]), MONTHS[(m[2] as string).toLowerCase()] as number, Number(m[1])) - 5.5 * 3_600_000), now);
  }
  // October 13, 2026
  m = s.match(/^([A-Za-z]{3,9})[\s.]+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
  if (m && MONTHS[(m[1] as string).toLowerCase()] !== undefined) {
    return valid(new Date(Date.UTC(Number(m[3]), MONTHS[(m[1] as string).toLowerCase()] as number, Number(m[2])) - 5.5 * 3_600_000), now);
  }
  // 13/10/2026, 13-10-2026, 13.10.2026 — Indian day-first convention
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
    return valid(new Date(Date.UTC(Number(m[3]), mo - 1, d) - 5.5 * 3_600_000), now);
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : valid(new Date(t), now);
}

const DATE_TOKEN =
  "(\\d{1,2}(?:st|nd|rd|th)?[\\s\\-.]+[A-Za-z]{3,9}[\\s\\-.,]+\\d{4}|[A-Za-z]{3,9}[\\s.]+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|\\d{1,2}[/\\-.]\\d{1,2}[/\\-.]\\d{4}|\\d{4}-\\d{2}-\\d{2})";

/**
 * A page-level publication date, only when the page labels it
 * ("Updated on", "Issued", "Published", "Dated", "Date:") within its first 3 000
 * characters. Returns the raw text too, so the UI can show what was read.
 */
export function findLabelledDate(pageText: string, now: Date = new Date()): { raw: string; iso: string } | null {
  const head = pageText.slice(0, 3000);
  const re = new RegExp(`(?:updated(?: on)?|last updated|issued(?: on| at)?|published(?: on)?|dated|date)\\s*[:\\-]?\\s*${DATE_TOKEN}`, "i");
  const m = head.match(re);
  if (!m?.[1]) return null;
  const iso = parseLooseDate(m[1], now);
  return iso ? { raw: m[1], iso } : null;
}

// ── Freshness & relevance ───────────────────────────────────────────────────

export type Freshness = "FRESH" | "RECENT" | "POTENTIALLY_STALE" | "TIMESTAMP_UNAVAILABLE";

export function freshnessOf(publishedAt: string | null, now: Date = new Date()): Freshness {
  if (!publishedAt) return "TIMESTAMP_UNAVAILABLE";
  const ageH = (now.getTime() - Date.parse(publishedAt)) / 3_600_000;
  if (ageH <= 24) return "FRESH";
  if (ageH <= 72) return "RECENT";
  return "POTENTIALLY_STALE";
}

export type GeoRelevance = "DISTRICT" | "STATE" | "NOT_LOCATION_SPECIFIC";

function hasPhrase(text: string, phrase: string): boolean {
  const p = normalizeName(phrase);
  return p.length >= 3 && ` ${normalizeName(text)} `.includes(` ${p} `);
}

export function geoRelevance(text: string, place: { district: string | null; state: string | null }): GeoRelevance {
  if (districtVariants(place.district, place.state).some((v) => hasPhrase(text, v))) return "DISTRICT";
  if (stateVariants(place.state).some((v) => hasPhrase(text, v))) return "STATE";
  return "NOT_LOCATION_SPECIFIC";
}

// ── Alert levels, fingerprints, duplicates, conflicts ───────────────────────

export type AlertLevel = "RED" | "ORANGE" | "YELLOW" | "GREEN";
const LEVEL_RANK: Record<AlertLevel, number> = { GREEN: 0, YELLOW: 1, ORANGE: 2, RED: 3 };

/** IMD-style colour-coded warning level mentioned in the text (English or Hindi), if any. */
export function alertLevelOf(text: string): AlertLevel | null {
  const t = text.toLowerCase();
  const found: AlertLevel[] = [];
  if (/\bred (alert|warning)|रेड अलर्ट|लाल चेतावनी/.test(t)) found.push("RED");
  if (/\borange (alert|warning)|ऑरेंज अलर्ट|नारंगी चेतावनी/.test(t)) found.push("ORANGE");
  if (/\byellow (alert|warning)|येलो अलर्ट|पीली चेतावनी/.test(t)) found.push("YELLOW");
  if (/\bgreen (alert|warning)|no warning/.test(t)) found.push("GREEN");
  if (!found.length) return null;
  return found.sort((a, b) => LEVEL_RANK[b] - LEVEL_RANK[a])[0] as AlertLevel;
}

export function isWithdrawal(text: string): boolean {
  return /\b(withdrawn|lifted|called off|no longer in (force|effect)|downgraded)\b|वापस ले/i.test(text);
}

const STOP = new Set(["the", "a", "an", "of", "in", "on", "at", "to", "and", "or", "is", "are", "for", "with", "by", "from", "will", "be", "has", "have", "this", "that", "it", "as", "over", "next"]);

export function tokens(text: string): string[] {
  return normalizeForMatch(text)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** Stable 32-bit FNV-1a hash of the sorted unique content tokens. */
export function fingerprint(text: string): string {
  const s = Array.from(new Set(tokens(text))).sort().join(" ");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Hash of a raw identity string (URLs etc.) — safe to use as a MongoDB field name. */
export function hashKey(raw: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `k${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

export function jaccard(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export interface Finding {
  id: string; // content fingerprint
  itemKey: string; // stable identity across runs (CAP id, or url + title)
  title: string;
  summary: string;
  hazard: ResearchHazard | HazardType;
  location: string | null;
  relevance: GeoRelevance;
  sourceName: string;
  sourceUrl: string;
  sourceCategory: SourceCategory;
  publishedAt: string | null;
  publishedRaw: string | null;
  publishedBasis: "CAP_SENT" | "PAGE_TEXT" | "SEARCH_PROVIDER" | null;
  retrievedAt: string;
  evidenceQuote: string | null;
  evidenceVerified: boolean;
  freshness: Freshness;
  alertLevel: AlertLevel | null;
  withdrawal: boolean;
  origin: "SACHET_FEED" | "TINYFISH_FETCH" | "TINYFISH_AGENT";
  corroboratedBy: { sourceName: string; sourceUrl: string; category: SourceCategory }[];
  conflictsWith: string[];
  instruction?: string | null;
  areaDesc?: string | null;
}

export type VerificationLabel = "Official source" | "Secondary source" | "Unverified source";

export function verificationLabel(f: Pick<Finding, "sourceCategory" | "evidenceVerified">): VerificationLabel {
  if (f.sourceCategory === "OFFICIAL" && f.evidenceVerified) return "Official source";
  if (f.sourceCategory === "SECONDARY" && f.evidenceVerified) return "Secondary source";
  return "Unverified source";
}

const CATEGORY_RANK: Record<SourceCategory, number> = { OFFICIAL: 2, SECONDARY: 1, UNVERIFIED: 0 };

/** Merge near-duplicate findings (Jaccard ≥ 0.55 on the same hazard). The best-sourced, freshest one is kept. */
export function dedupeFindings(list: Finding[], threshold = 0.55): { findings: Finding[]; merged: number } {
  const sorted = [...list].sort(
    (a, b) =>
      CATEGORY_RANK[b.sourceCategory] - CATEGORY_RANK[a.sourceCategory] ||
      Date.parse(b.publishedAt ?? "0") - Date.parse(a.publishedAt ?? "0"),
  );
  const kept: Finding[] = [];
  let merged = 0;
  for (const f of sorted) {
    const dup = kept.find((k) => k.id === f.id || (k.hazard === f.hazard && jaccard(`${k.title} ${k.summary}`, `${f.title} ${f.summary}`) >= threshold));
    if (dup) {
      merged++;
      if (dup.sourceUrl !== f.sourceUrl && !dup.corroboratedBy.some((c) => c.sourceUrl === f.sourceUrl)) {
        dup.corroboratedBy.push({ sourceName: f.sourceName, sourceUrl: f.sourceUrl, category: f.sourceCategory });
      }
    } else {
      kept.push({ ...f, corroboratedBy: [...f.corroboratedBy] });
    }
  }
  return { findings: kept, merged };
}

export interface Conflict {
  kind: "ALERT_LEVEL" | "WITHDRAWN_VS_ACTIVE";
  findingIds: [string, string];
  message: string;
}

/** Findings for the same hazard from different sources, published within 48 h of each other, that disagree. */
export function detectFindingConflicts(list: Finding[]): Conflict[] {
  const out: Conflict[] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i] as Finding;
      const b = list[j] as Finding;
      if (a.hazard !== b.hazard || hostOf(a.sourceUrl) === hostOf(b.sourceUrl)) continue;
      if (a.publishedAt && b.publishedAt && Math.abs(Date.parse(a.publishedAt) - Date.parse(b.publishedAt)) > 48 * 3_600_000) continue;
      if (a.relevance === "NOT_LOCATION_SPECIFIC" || b.relevance === "NOT_LOCATION_SPECIFIC") continue;
      if (a.alertLevel && b.alertLevel && a.alertLevel !== b.alertLevel) {
        out.push({ kind: "ALERT_LEVEL", findingIds: [a.id, b.id], message: `${a.sourceName} reports a ${a.alertLevel.toLowerCase()} alert while ${b.sourceName} reports ${b.alertLevel.toLowerCase()}.` });
      } else if (a.withdrawal !== b.withdrawal && (a.alertLevel || b.alertLevel || a.withdrawal || b.withdrawal)) {
        const w = a.withdrawal ? a : b;
        const o = a.withdrawal ? b : a;
        out.push({ kind: "WITHDRAWN_VS_ACTIVE", findingIds: [w.id, o.id], message: `${w.sourceName} says a warning was withdrawn or lifted, but ${o.sourceName} still reports it as active.` });
      }
    }
  }
  return out;
}

// ── Report ───────────────────────────────────────────────────────────────────

export interface IntelReport {
  generatedAt: string;
  executiveSummary: string;
  summaryMethod: "AI_GROUNDED" | "TEMPLATE";
  insufficientEvidence: boolean;
  insufficiencyReason: string | null;
  latestFindingIds: string[];
  officialAdvisories: { text: string; sourceName: string; sourceUrl: string; publishedAt: string | null }[];
  affectedAreas: { name: string; supportedBy: string[] }[];
  reliability: { official: number; secondary: number; unverified: number; text: string };
  freshness: { fresh: number; recent: number; stale: number; unknown: number; newestPublishedAt: string | null; retrievedAt: string };
  conflicts: Conflict[];
  gaps: string[];
  nextSteps: { text: string; authority: "OFFICIAL" | "GUIDANCE"; sourceUrl?: string }[];
}

export function buildIntelReport(args: {
  findings: Finding[];
  conflicts: Conflict[];
  place: { label: string; district: string | null; state: string | null };
  hazard: ResearchHazard;
  gaps: string[];
  guidance: string[];
  now?: Date;
}): IntelReport {
  const now = args.now ?? new Date();
  const f = args.findings;
  const relevant = f.filter((x) => x.relevance !== "NOT_LOCATION_SPECIFIC");
  const official = f.filter((x) => verificationLabel(x) === "Official source");
  const officialRelevantFresh = official.filter((x) => x.relevance !== "NOT_LOCATION_SPECIFIC" && (x.freshness === "FRESH" || x.freshness === "RECENT"));
  const byTime = [...f].sort((a, b) => {
    if (a.publishedAt && b.publishedAt) return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
    if (a.publishedAt) return -1;
    if (b.publishedAt) return 1;
    return CATEGORY_RANK[b.sourceCategory] - CATEGORY_RANK[a.sourceCategory];
  });

  const officialAdvisories = official
    .filter((x) => x.instruction || /advis|instruct|avoid|evacuat|stay|do not|must|should|सलाह|निर्देश/i.test(x.summary))
    .slice(0, 8)
    .map((x) => ({ text: x.instruction ?? x.summary, sourceName: x.sourceName, sourceUrl: x.sourceUrl, publishedAt: x.publishedAt }));

  const areas = new Map<string, Set<string>>();
  const add = (name: string, id: string) => {
    const k = name.trim();
    if (k.length < 3) return;
    areas.set(k, (areas.get(k) ?? new Set()).add(id));
  };
  for (const x of f) {
    if (x.areaDesc) add(x.areaDesc, x.id);
    if (x.relevance === "DISTRICT" && args.place.district) add(args.place.district, x.id);
    if (x.relevance !== "NOT_LOCATION_SPECIFIC" && args.place.state) add(args.place.state, x.id);
  }

  const count = (fr: Freshness) => f.filter((x) => x.freshness === fr).length;
  const reliability = {
    official: f.filter((x) => x.sourceCategory === "OFFICIAL").length,
    secondary: f.filter((x) => x.sourceCategory === "SECONDARY").length,
    unverified: f.filter((x) => x.sourceCategory === "UNVERIFIED").length,
    text: "",
  };
  reliability.text =
    reliability.official > 0
      ? `${reliability.official} finding(s) come directly from government sources${reliability.secondary ? `; ${reliability.secondary} from news organisations reporting on them` : ""}.`
      : reliability.secondary > 0
        ? `No government source was found; ${reliability.secondary} finding(s) come from news reports, which are secondary sources.`
        : "No findings from government or established news sources.";

  const insufficientEvidence = officialRelevantFresh.length === 0;
  const insufficiencyReason = insufficientEvidence
    ? f.length === 0
      ? "No relevant information was found in the sources that could be reached."
      : official.length === 0
        ? "No current official source was found for this area and hazard; news reports alone cannot establish the current danger."
        : "Official sources were found, but none is both recent (under 72 h) and specific to this area."
    : null;

  const gaps = [...args.gaps];
  const noTs = f.filter((x) => !x.publishedAt).length;
  if (noTs) gaps.push(`${noTs} finding(s) have no publication date on the source; their age is unknown.`);
  if (count("POTENTIALLY_STALE")) gaps.push(`${count("POTENTIALLY_STALE")} finding(s) were published more than 72 hours ago.`);
  if (relevant.length === 0 && f.length) gaps.push("No finding names this district or state specifically.");

  const nextSteps: IntelReport["nextSteps"] = [
    ...officialAdvisories.slice(0, 4).map((a) => ({ text: a.text, authority: "OFFICIAL" as const, sourceUrl: a.sourceUrl })),
    ...args.guidance.slice(0, 5).map((g) => ({ text: g, authority: "GUIDANCE" as const })),
  ];

  const hz = HAZARD_PROFILES[args.hazard].label.toLowerCase();
  const executiveSummary = insufficientEvidence
    ? `ANVIL could not establish the current ${hz} situation for ${args.place.label} from official sources. ${insufficiencyReason} Follow local official channels and call 112 in an emergency.`
    : `${officialRelevantFresh.length} recent official finding(s) concern ${hz} in ${args.place.label}. The most recent is from ${officialRelevantFresh[0]?.sourceName}${officialRelevantFresh[0]?.publishedAt ? ` (${new Date(officialRelevantFresh[0].publishedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST)` : ""}: ${officialRelevantFresh[0]?.title}.${args.conflicts.length ? ` ${args.conflicts.length} disagreement(s) between sources need checking.` : ""}`;

  return {
    generatedAt: now.toISOString(),
    executiveSummary,
    summaryMethod: "TEMPLATE",
    insufficientEvidence,
    insufficiencyReason,
    latestFindingIds: byTime.map((x) => x.id),
    officialAdvisories,
    affectedAreas: Array.from(areas, ([name, ids]) => ({ name, supportedBy: Array.from(ids) })).slice(0, 12),
    reliability,
    freshness: {
      fresh: count("FRESH"),
      recent: count("RECENT"),
      stale: count("POTENTIALLY_STALE"),
      unknown: count("TIMESTAMP_UNAVAILABLE"),
      newestPublishedAt: byTime.find((x) => x.publishedAt)?.publishedAt ?? null,
      retrievedAt: now.toISOString(),
    },
    conflicts: args.conflicts,
    gaps,
    nextSteps,
  };
}

/** AI summary must cite [F1]… ids that exist and contain no numbers absent from the cited findings. */
export function checkSummaryGrounding(summary: string, findings: { ref: string; text: string }[]): boolean {
  const refs = new Set(findings.map((f) => f.ref));
  const cited = Array.from(summary.matchAll(/\[(F\d{1,2})\]/g), (m) => m[1] as string);
  if (cited.length === 0 || cited.some((c) => !refs.has(c))) return false;
  const hay = findings.map((f) => f.text.replace(/[\s,]/g, "")).join("|");
  const nums = summary.replace(/\[F\d{1,2}\]/g, "").match(/\d[\d,.]*\d|\d/g) ?? [];
  return nums.every((n) => n.length < 2 || n === "112" || hay.includes(n.replace(/,/g, "")));
}

// ── Monitor change detection ────────────────────────────────────────────────

export function diffAgainstKnown(
  known: Record<string, string>,
  current: Pick<Finding, "itemKey" | "id">[],
): { newKeys: string[]; changedKeys: string[]; next: Record<string, string> } {
  const next: Record<string, string> = { ...known };
  const newKeys: string[] = [];
  const changedKeys: string[] = [];
  for (const f of current) {
    const prev = known[f.itemKey];
    if (prev === undefined) newKeys.push(f.itemKey);
    else if (prev !== f.id) changedKeys.push(f.itemKey);
    next[f.itemKey] = f.id;
  }
  // Bound memory: keep the 400 most recent keys.
  const keys = Object.keys(next);
  if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete next[k];
  return { newKeys, changedKeys, next };
}