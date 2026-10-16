import {
  isPlausibleIndianPhone,
  normalizeForMatch,
  normalizePhone,
  phoneAppearsInQuote,
  phraseAppearsIn,
  quoteAppearsIn,
} from "./evidence";
import type { EvidenceRef, VerifiedAdvisory, VerifiedContact, VerifiedRoadClosure, VerifiedShelter } from "./types";

/** Raw extraction shape (mirrors pageExtractionSchema in lib/validation.ts). */
export interface PageExtraction {
  shelters: {
    name: string;
    address?: string | null;
    capacity?: number | null;
    accessibility?: string | null;
    operationalStatus?: string | null;
    evidenceQuote: string;
  }[];
  contacts: { label: string; phone: string; evidenceQuote: string }[];
  advisories: { text: string; evidenceQuote: string }[];
  roadClosures?: { road: string; status: string; evidenceQuote: string }[];
}

/**
 * Turn raw (AI- or agent-) extracted items into verified items.
 * An item survives only if its evidence quote is verbatim in the page text we
 * retrieved, and its key value (phone / shelter name) is actually present.
 * Kept free of server-only imports so it is unit-testable.
 */
export function verifyExtraction(
  extraction: PageExtraction,
  page: { url: string; text: string },
  retrievedAt: string,
  method: EvidenceRef["method"],
  district: string | null,
): { contacts: VerifiedContact[]; shelters: VerifiedShelter[]; advisories: VerifiedAdvisory[]; roadClosures: VerifiedRoadClosure[]; dropped: number } {
  let dropped = 0;
  const ev = (quote: string): EvidenceRef => ({ sourceUrl: page.url, evidenceQuote: quote.trim(), retrievedAt, method });

  const contacts: VerifiedContact[] = [];
  for (const c of extraction.contacts) {
    const ok =
      quoteAppearsIn(page.text, c.evidenceQuote) &&
      isPlausibleIndianPhone(c.phone) &&
      phoneAppearsInQuote(c.phone, c.evidenceQuote);
    if (ok) contacts.push({ label: c.label, phone: c.phone, evidence: ev(c.evidenceQuote) });
    else dropped++;
  }

  const shelters: VerifiedShelter[] = [];
  for (const s of extraction.shelters) {
    const ok = quoteAppearsIn(page.text, s.evidenceQuote) && phraseAppearsIn(page.text, s.name);
    // Capacity/status are kept only if the number/words are inside the quoted evidence.
    const capacityOk = s.capacity != null && s.evidenceQuote.replace(/[,\s]/g, "").includes(String(s.capacity));
    const statusOk = s.operationalStatus != null && phraseAppearsIn(s.evidenceQuote, s.operationalStatus);
    if (ok) {
      shelters.push({
        name: s.name,
        address: s.address && phraseAppearsIn(page.text, s.address) ? s.address : null,
        district,
        capacity: capacityOk ? (s.capacity ?? null) : null,
        accessibility: s.accessibility && phraseAppearsIn(page.text, s.accessibility) ? s.accessibility : null,
        operationalStatus: statusOk ? (s.operationalStatus ?? null) : null,
        evidence: ev(s.evidenceQuote),
      });
    } else dropped++;
  }

  const advisories: VerifiedAdvisory[] = [];
  for (const a of extraction.advisories) {
    if (quoteAppearsIn(page.text, a.evidenceQuote)) advisories.push({ text: a.text, evidence: ev(a.evidenceQuote) });
    else dropped++;
  }

  const roadClosures: VerifiedRoadClosure[] = [];
  for (const r of extraction.roadClosures ?? []) {
    // The road name must be inside the verbatim quote, and the quote must be on the page.
    if (quoteAppearsIn(page.text, r.evidenceQuote) && phraseAppearsIn(r.evidenceQuote, r.road)) {
      roadClosures.push({ road: r.road, status: r.status, evidence: ev(r.evidenceQuote) });
    } else dropped++;
  }

  return { contacts, shelters, advisories, roadClosures, dropped };
}

export function dedupeContacts(list: VerifiedContact[]): VerifiedContact[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    const k = `${normalizePhone(c.phone)}|${c.evidence.sourceUrl}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function dedupeShelters(list: VerifiedShelter[]): VerifiedShelter[] {
  const seen = new Set<string>();
  return list.filter((s) => {
    const k = normalizeForMatch(s.name);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}