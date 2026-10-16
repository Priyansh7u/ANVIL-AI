import "server-only";
import { generateStructured, isAiConfigured } from "./ai";
import { buildTemplateChecklist, type HouseholdProfile } from "./core/checklists";
import { BASELINE_CONTACTS } from "./core/source-registry";
import type { HazardType, NormalizedAlert, VerifiedAdvisory, VerifiedContact, VerifiedShelter } from "./core/types";
import { find } from "./repo";
import { getAlerts } from "./sources/sachet";
import { aiChecklistSchema, type PlaceInput } from "./validation";

/**
 * Safety action plan. Sections are ordered by authority:
 *   1. Official instructions from active CAP alerts (verbatim, linked)
 *   2. Verified district contacts / shelters / advisories from the research agent (quote-backed)
 *   3. Checklist — AI-generated (labelled) or the ANVIL template (labelled)
 * Lower sections never override higher ones.
 */

export interface SafetyPlanOutput {
  generatedAt: string;
  place: PlaceInput;
  language: "en" | "hi";
  alertFeed: { dataMode: string; retrievedAt: string | null; sourceUrl: string };
  officialInstructions: { alertId: string; issuer: string; headline: string; instruction: string; capUrl: string; expiresAt: string | null }[];
  activeHazards: HazardType[];
  contacts: { label: string; phone: string; sourceUrl: string; evidenceQuote: string | null; kind: "NATIONAL" | "VERIFIED_DISTRICT" }[];
  shelters: VerifiedShelter[];
  advisories: VerifiedAdvisory[];
  checklist: { text: string; reason: string | null }[];
  checklistSource: "AI_GENERATED" | "ANVIL_TEMPLATE";
  researchTaskId: string | null;
  researchFinishedAt: string | null;
  disclaimer: string;
}

const DISCLAIMER = {
  en: "ANVIL is an information aid. Always follow instructions from NDMA, IMD, your State/District Disaster Management Authority and local officials. In an emergency call 112.",
  hi: "ANVIL केवल जानकारी देने वाला साधन है। हमेशा NDMA, IMD, राज्य/जिला आपदा प्रबंधन प्राधिकरण और स्थानीय अधिकारियों के निर्देशों का पालन करें। आपात स्थिति में 112 पर कॉल करें।",
};

export async function buildSafetyPlan(place: PlaceInput, household: HouseholdProfile, language: "en" | "hi"): Promise<SafetyPlanOutput> {
  const alerts = await getAlerts(place, "local");
  const active: NormalizedAlert[] = alerts.alerts.filter((a) => a.freshness === "ACTIVE" && a.relevance !== "NONE");
  const hazards = Array.from(new Set(active.map((a) => a.hazard))).filter((h) => h !== "other");

  const officialInstructions = active
    .filter((a) => a.instruction)
    .slice(0, 6)
    .map((a) => ({ alertId: a.id, issuer: a.issuer, headline: a.headline, instruction: a.instruction as string, capUrl: a.capUrl, expiresAt: a.expiresAt }));

  // Most recent finished research for this place.
  const filter: Record<string, unknown> = { kind: "AREA_BRIEFING", "place.state": place.state };
  if (place.district) filter["place.district"] = place.district;
  const tasks = await find("ResearchTask", filter, { sortDesc: "createdAt", limit: 5 });
  const task = tasks.find((t) => t.status === "COMPLETED" || t.status === "PARTIAL") ?? null;
  const result = (task?.result ?? {}) as { contacts?: VerifiedContact[]; shelters?: VerifiedShelter[]; advisories?: VerifiedAdvisory[] };

  const contacts: SafetyPlanOutput["contacts"] = BASELINE_CONTACTS.map((c) => ({
    label: language === "hi" ? c.labelHi : c.label,
    phone: c.phone,
    sourceUrl: c.sourceUrl,
    evidenceQuote: null,
    kind: "NATIONAL" as const,
  }));
  for (const c of result.contacts ?? []) {
    contacts.push({ label: c.label, phone: c.phone, sourceUrl: c.evidence.sourceUrl, evidenceQuote: c.evidence.evidenceQuote, kind: "VERIFIED_DISTRICT" });
  }

  let checklist: SafetyPlanOutput["checklist"];
  let checklistSource: SafetyPlanOutput["checklistSource"] = "ANVIL_TEMPLATE";
  const template = buildTemplateChecklist(hazards.length ? hazards : ["flood"], household);
  checklist = template.map((i) => ({ text: language === "hi" ? i.hi : i.en, reason: null }));

  if (isAiConfigured()) {
    try {
      const ai = await generateStructured({
        system:
          `You write a short household preparedness checklist for a public-safety app in India. Language: ${language === "hi" ? "simple Hindi (Devanagari)" : "simple English"}. ` +
          "Use ONLY the hazards and official instructions provided. Never contradict official instructions; never invent phone numbers, locations, shelter names or statistics. " +
          'Each item: one concrete action under 25 words. Output JSON only: {"items":[{"text":string,"reason":string|null}]}',
        user: JSON.stringify({
          place: place.label,
          activeHazards: hazards,
          officialInstructions: officialInstructions.map((o) => o.instruction),
          household,
        }),
        schema: aiChecklistSchema,
        maxTokens: 900,
        timeoutMs: 30_000,
      });
      // Defence in depth: drop any item that contains a phone-number-like string.
      const items = ai.items.filter((i) => !/\d{3,}/.test(i.text));
      if (items.length >= 3) {
        checklist = items.map((i) => ({ text: i.text, reason: i.reason ?? null }));
        checklistSource = "AI_GENERATED";
      }
    } catch {
      /* template already in place */
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    place,
    language,
    alertFeed: { dataMode: alerts.dataMode, retrievedAt: alerts.retrievedAt, sourceUrl: alerts.sourceUrl },
    officialInstructions,
    activeHazards: hazards,
    contacts,
    shelters: (result.shelters ?? []).slice(0, 6),
    advisories: (result.advisories ?? []).slice(0, 6),
    checklist,
    checklistSource,
    researchTaskId: task?._id ?? null,
    researchFinishedAt: (task?.finishedAt as string | undefined) ?? null,
    disclaimer: DISCLAIMER[language],
  };
}