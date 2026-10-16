/**
 * Grounding checks for "Ask ANVIL". The assistant may only answer from a
 * numbered list of evidence items (official alerts and quote-verified research).
 * These pure functions reject answers that cite unknown items or contain
 * numbers (phone numbers, capacities, dates) that are not in the evidence.
 */

export interface EvidenceItem {
  id: string; // e.g. "A1", "C2", "S1", "V3"
  kind: "ALERT" | "CONTACT" | "SHELTER" | "ADVISORY";
  text: string;
  label: string;
  url: string;
}

const CITE_RE = /\[([ACSV]\d{1,2})\]/g;

export function citedIds(answer: string): string[] {
  return Array.from(new Set(Array.from(answer.matchAll(CITE_RE), (m) => m[1] as string)));
}

/** Every 3+ digit number in the answer must appear in some evidence text (digits only comparison). */
export function unsupportedNumbers(answer: string, evidence: EvidenceItem[]): string[] {
  const haystack = evidence.map((e) => e.text.replace(/[\s\-().,]/g, "")).join("|");
  const nums = answer
    .replace(CITE_RE, "")
    .match(/\d[\d\s\-().]{1,}\d/g) ?? [];
  return nums
    .map((n) => n.replace(/[\s\-().]/g, ""))
    .filter((n) => n.length >= 3 && n !== "112" && !haystack.includes(n));
}

export interface GroundingResult {
  ok: boolean;
  reason?: string;
  citations: string[];
}

export function checkGrounding(answer: string, evidence: EvidenceItem[], answerable: boolean): GroundingResult {
  const ids = new Set(evidence.map((e) => e.id));
  const cited = citedIds(answer);
  const unknown = cited.filter((c) => !ids.has(c));
  if (unknown.length) return { ok: false, reason: `cites unknown sources ${unknown.join(", ")}`, citations: [] };
  if (answerable && cited.length === 0 && evidence.length > 0) {
    return { ok: false, reason: "makes claims without citing any source", citations: [] };
  }
  const bad = unsupportedNumbers(answer, evidence);
  if (bad.length) return { ok: false, reason: `contains numbers not found in sources (${bad.slice(0, 3).join(", ")})`, citations: [] };
  return { ok: true, citations: cited };
}

/** Keyword routing used when no AI key is configured, or when the AI answer fails grounding. */
export function fallbackKinds(question: string): EvidenceItem["kind"][] {
  const q = question.toLowerCase();
  const kinds: EvidenceItem["kind"][] = [];
  if (/shelter|camp|relief|evacuat|आश्रय|राहत|शिविर/.test(q)) kinds.push("SHELTER");
  if (/number|phone|call|helpline|control room|contact|नंबर|हेल्पलाइन|संपर्क/.test(q)) kinds.push("CONTACT");
  if (/what (should|to) do|advice|safe|precaution|क्या करें|सावधान|सुरक्षित/.test(q)) kinds.push("ADVISORY", "ALERT");
  if (kinds.length === 0 || /alert|warning|rain|flood|storm|cyclone|heat|चेतावनी|बारिश|बाढ़|तूफान/.test(q)) kinds.push("ALERT");
  return Array.from(new Set(kinds));
}