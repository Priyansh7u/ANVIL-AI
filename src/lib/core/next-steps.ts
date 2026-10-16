import { SEVERITY_RANK } from "./cap";
import { commonChecklist, hazardChecklist, type HouseholdProfile } from "./checklists";
import { BASELINE_CONTACTS } from "./source-registry";
import type { DataMode, HazardType, NormalizedAlert, VerifiedAdvisory, VerifiedContact, VerifiedRoadClosure, VerifiedShelter } from "./types";

/**
 * Next-steps engine. Turns live official alerts + the user's place +
 * household preferences + verified research into ordered, practical actions.
 *
 * Authority order is fixed and cannot be overridden:
 *   1. OFFICIAL — verbatim instructions from active CAP alerts
 *   2. VERIFIED — quote-verified district advisories / closures from official pages
 *   3. GUIDANCE — ANVIL general preparedness guidance (clearly labelled)
 * Deterministic: the same inputs always give the same plan.
 */

export type Priority = "ACT_NOW" | "PREPARE" | "STAY_INFORMED" | "UNKNOWN";

export interface NextAction {
  id: string;
  text: string;
  why: string;
  authority: "OFFICIAL" | "VERIFIED" | "GUIDANCE";
  when: "now" | "next_hours" | "today";
  sourceUrl?: string;
}

export interface MonitorItem {
  text: string;
  at?: string;
  sourceUrl?: string;
}

export interface NextStepsInput {
  alerts: NormalizedAlert[];
  feedMode: DataMode;
  feedRetrievedAt: string | null;
  placeLabel: string;
  household?: HouseholdProfile | null;
  language?: "en" | "hi";
  research?: {
    finishedAt: string | null;
    contacts: VerifiedContact[];
    shelters: VerifiedShelter[];
    advisories: VerifiedAdvisory[];
    roadClosures: VerifiedRoadClosure[];
  } | null;
  now?: Date;
}

export interface NextSteps {
  generatedAt: string;
  priority: Priority;
  headline: string;
  basis: string[];
  official: { alertId: string; issuer: string; severity: string; headline: string; instruction: string | null; capUrl: string; expiresAt: string | null }[];
  actions: NextAction[];
  contacts: { label: string; phone: string; sourceUrl: string; verified: boolean }[];
  shelters: { name: string; address: string | null; sourceUrl: string }[];
  roadClosures: { road: string; status: string; sourceUrl: string; quote: string }[];
  monitor: MonitorItem[];
}

const HAZARD_NAME: Record<HazardType, string> = {
  flood: "flooding",
  heavy_rain: "heavy rain",
  thunderstorm: "thunderstorm / lightning",
  cyclone: "cyclone",
  heatwave: "heatwave",
  cold_wave: "cold wave",
  earthquake: "earthquake",
  landslide: "landslide",
  tsunami: "tsunami",
  high_waves: "high waves",
  avalanche: "avalanche",
  fire: "fire",
  other: "the reported hazard",
};

function istTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
}

export function computePriority(alerts: NormalizedAlert[], feedMode: DataMode): Priority {
  if (feedMode === "UNAVAILABLE") return "UNKNOWN";
  const active = alerts.filter((a) => a.freshness === "ACTIVE" && a.relevance !== "NONE");
  const urgentLocal = active.some(
    (a) => a.relevance === "DISTRICT" && (SEVERITY_RANK[a.severity] >= SEVERITY_RANK.Severe || (a.urgency ?? "").toLowerCase() === "immediate"),
  );
  if (urgentLocal) return "ACT_NOW";
  if (active.length > 0) return "PREPARE";
  return "STAY_INFORMED";
}

export function buildNextSteps(input: NextStepsInput): NextSteps {
  const now = input.now ?? new Date();
  const lang = input.language ?? "en";
  const active = input.alerts
    .filter((a) => a.freshness === "ACTIVE" && a.relevance !== "NONE")
    .sort(
      (a, b) =>
        (b.relevance === "DISTRICT" ? 1 : 0) - (a.relevance === "DISTRICT" ? 1 : 0) ||
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        Date.parse(b.issuedAt ?? "0") - Date.parse(a.issuedAt ?? "0"),
    );
  const priority = computePriority(input.alerts, input.feedMode);
  const research = input.research ?? null;

  const headline = {
    ACT_NOW: `Act now: ${active[0] ? `${active[0].issuer} reports ${HAZARD_NAME[active[0].hazard]} for your district` : "official alert for your district"}.`,
    PREPARE: `Prepare: ${active.length} active official alert(s) for your area.`,
    STAY_INFORMED: `No active official alerts for ${input.placeLabel}. Stay prepared and keep monitoring.`,
    UNKNOWN: "Official alert feed is unreachable — status unknown. Follow local official channels.",
  }[priority];

  const basis: string[] = [];
  if (active.length) basis.push(`${active.length} active alert(s) from the NDMA SACHET feed${input.feedRetrievedAt ? `, checked ${istTime(input.feedRetrievedAt)} IST` : ""}.`);
  if (research?.finishedAt) basis.push(`District contacts/shelters verified on official pages at ${istTime(research.finishedAt)} IST.`);
  if (input.household) basis.push(`Household: ${input.household.members} people${input.household.children ? `, ${input.household.children} children` : ""}${input.household.elderly ? `, ${input.household.elderly} elderly` : ""}${input.household.mobilityNeeds ? ", mobility needs" : ""}${input.household.medicalNeeds ? ", medical needs" : ""}${input.household.pets ? ", pets" : ""}.`);

  // 1. Official instructions — verbatim, never paraphrased.
  const actions: NextAction[] = [];
  const seenInstr = new Set<string>();
  for (const a of active) {
    if (!a.instruction) continue;
    const key = a.instruction.trim().toLowerCase();
    if (seenInstr.has(key)) continue;
    seenInstr.add(key);
    actions.push({
      id: `off-${a.id}`,
      text: a.instruction.trim(),
      why: `Official instruction from ${a.issuer} (${a.severity === "Unknown" ? "severity not stated" : a.severity})`,
      authority: "OFFICIAL",
      when: "now",
      sourceUrl: a.capUrl,
    });
  }

  // 2. Verified district advisories and road closures.
  for (const [i, adv] of (research?.advisories ?? []).slice(0, 3).entries()) {
    actions.push({ id: `adv-${i}`, text: adv.text, why: "Advisory published on an official district/state page", authority: "VERIFIED", when: "next_hours", sourceUrl: adv.evidence.sourceUrl });
  }
  if ((research?.roadClosures ?? []).length) {
    actions.push({
      id: "roads",
      text: lang === "hi" ? "यात्रा से पहले आधिकारिक रूप से बताए गए बंद रास्तों की जाँच करें।" : "Check the officially reported road closures before travelling.",
      why: `${research?.roadClosures.length} closure(s) reported on official pages`,
      authority: "VERIFIED",
      when: "now",
      sourceUrl: research?.roadClosures[0]?.evidence.sourceUrl,
    });
  }

  // 3. Guidance, driven by the hazards actually in the alerts.
  const hazards = Array.from(new Set(active.map((a) => a.hazard))).filter((h) => h !== "other");
  for (const h of hazards) {
    const trigger = active.find((a) => a.hazard === h);
    hazardChecklist(h).forEach((item, i) =>
      actions.push({
        id: `g-${h}-${i}`,
        text: lang === "hi" ? item.hi : item.en,
        why: `ANVIL guidance because ${trigger?.issuer ?? "an official agency"} reports ${HAZARD_NAME[h]}`,
        authority: "GUIDANCE",
        when: priority === "ACT_NOW" ? "now" : "next_hours",
      }),
    );
  }
  const hh = input.household;
  if (hh && (hh.elderly > 0 || hh.mobilityNeeds)) {
    actions.push({ id: "g-mobility", text: lang === "hi" ? "तय करें कि चलने-फिरने में असमर्थ सदस्यों को कौन और कैसे ले जाएगा।" : "Decide now who will help members with limited mobility, and how they will be moved.", why: "Your household includes elderly members or mobility needs", authority: "GUIDANCE", when: priority === "STAY_INFORMED" ? "today" : "now" });
  }
  if (hh?.medicalNeeds) {
    actions.push({ id: "g-meds", text: lang === "hi" ? "कम से कम 7 दिनों की दवाइयाँ और पर्चे वॉटरप्रूफ़ थैली में रखें।" : "Pack at least 7 days of essential medicines and prescriptions in a waterproof pouch.", why: "Your household has medical needs", authority: "GUIDANCE", when: "next_hours" });
  }
  if (hh && hh.children > 0) {
    actions.push({ id: "g-kids", text: lang === "hi" ? "बच्चों के लिए भोजन, दूध और पहचान के लिए परिवार की फ़ोटो रखें।" : "Pack food and milk for children and keep a family photo for identification.", why: "Your household includes children", authority: "GUIDANCE", when: "next_hours" });
  }
  if (hh?.pets) {
    actions.push({ id: "g-pets", text: lang === "hi" ? "पालतू जानवरों के लिए पट्टा, भोजन और पानी तैयार रखें।" : "Prepare a leash/carrier, food and water for pets.", why: "Your household has pets", authority: "GUIDANCE", when: "today" });
  }
  commonChecklist().forEach((item, i) =>
    actions.push({ id: `c-${i}`, text: lang === "hi" ? item.hi : item.en, why: "Basic readiness for any hazard (ANVIL guidance)", authority: "GUIDANCE", when: priority === "STAY_INFORMED" ? "today" : "next_hours" }),
  );

  // Contacts: national first, then verified district numbers.
  const contacts = [
    ...BASELINE_CONTACTS.map((c) => ({ label: lang === "hi" ? c.labelHi : c.label, phone: c.phone, sourceUrl: c.sourceUrl, verified: true })),
    ...(research?.contacts ?? []).slice(0, 6).map((c) => ({ label: c.label, phone: c.phone, sourceUrl: c.evidence.sourceUrl, verified: true })),
  ];

  // What to monitor next — real timestamps only.
  const monitor: MonitorItem[] = [];
  for (const a of active.slice(0, 5)) {
    if (a.expiresAt) {
      const mins = Math.round((Date.parse(a.expiresAt) - now.getTime()) / 60_000);
      monitor.push({
        text: `${a.issuer} ${HAZARD_NAME[a.hazard]} alert is valid until ${istTime(a.expiresAt)} IST${mins > 0 && mins < 180 ? ` (${mins} min left)` : ""}. Watch for an update or extension.`,
        at: a.expiresAt,
        sourceUrl: a.capUrl,
      });
    } else {
      monitor.push({ text: `${a.issuer} alert issued ${a.issuedAt ? `${istTime(a.issuedAt)} IST` : "recently"} has no stated expiry — treat it as active until a newer message replaces it.`, sourceUrl: a.capUrl });
    }
  }
  if (active.some((a) => a.issuer.toUpperCase().includes("CWC"))) {
    monitor.push({ text: "Central Water Commission river bulletins for your state are in the feed — watch for the next river-level message." });
  }
  if (input.feedRetrievedAt) monitor.push({ text: `ANVIL re-checks the official SACHET feed every 5 minutes (last check ${istTime(input.feedRetrievedAt)} IST).`, at: input.feedRetrievedAt });
  const researchAgeH = research?.finishedAt ? (now.getTime() - Date.parse(research.finishedAt)) / 3_600_000 : null;
  if (researchAgeH === null) monitor.push({ text: "District contacts and shelters have not been verified yet — run the research agent." });
  else if (researchAgeH > 24) monitor.push({ text: `District information was verified ${Math.round(researchAgeH)} h ago — re-run the research agent for fresh details.` });

  return {
    generatedAt: now.toISOString(),
    priority,
    headline,
    basis,
    official: active.slice(0, 6).map((a) => ({ alertId: a.id, issuer: a.issuer, severity: a.severity, headline: a.headline, instruction: a.instruction, capUrl: a.capUrl, expiresAt: a.expiresAt })),
    actions: dedupeActions(actions).slice(0, 18),
    contacts,
    shelters: (research?.shelters ?? []).slice(0, 5).map((s) => ({ name: s.name, address: s.address, sourceUrl: s.evidence.sourceUrl })),
    roadClosures: (research?.roadClosures ?? []).slice(0, 8).map((r) => ({ road: r.road, status: r.status, sourceUrl: r.evidence.sourceUrl, quote: r.evidence.evidenceQuote })),
    monitor,
  };
}

function dedupeActions(list: NextAction[]): NextAction[] {
  const seen = new Set<string>();
  return list.filter((a) => {
    const k = a.text.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}