import type { ResearchFlag, VerifiedContact } from "./types";

/**
 * Evidence verification — the core anti-hallucination guard.
 * Every fact ANVIL extracts from a web page must carry a quote that appears
 * verbatim (modulo whitespace/case) in the text we actually retrieved.
 * Anything that fails this check is dropped and reported.
 */

export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[​-‍﻿]/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[*_`#>|]/g, " ") // markdown formatting from the fetch layer
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export const MIN_QUOTE_LENGTH = 12;

export function quoteAppearsIn(pageText: string, quote: string): boolean {
  const q = normalizeForMatch(quote);
  if (q.length < MIN_QUOTE_LENGTH) return false;
  return normalizeForMatch(pageText).includes(q);
}

/** Looser check for short strings such as names: present in the page as a phrase. */
export function phraseAppearsIn(pageText: string, phrase: string): boolean {
  const p = normalizeForMatch(phrase);
  return p.length >= 3 && normalizeForMatch(pageText).includes(p);
}

/** Digits-only form; Indian numbers lose +91 / leading 0 so equivalent numbers compare equal. */
export function normalizePhone(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.length > 10 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d;
}

export function isPlausibleIndianPhone(raw: string): boolean {
  const d = normalizePhone(raw);
  // 3–4 digit service numbers (112, 1077, 1070, 1078) or 10-digit numbers incl. STD+landline
  return /^1\d{2,3}$/.test(d) || /^\d{10}$/.test(d);
}

export function phoneAppearsInQuote(phone: string, quote: string): boolean {
  const target = normalizePhone(phone);
  if (!target) return false;
  const quoteDigits = quote.replace(/[\s\-().]/g, "");
  return quoteDigits.includes(target) || normalizePhone(quoteDigits).includes(target);
}

const PHONE_RE = /(?:\+?91[\s-]?)?(?:0\d{2,4}[\s-]?\d{6,8}|[6-9]\d{9}|\b1\d{2,3}\b)/g;
const CONTACT_KEYWORDS =
  /(control room|helpline|help line|emergency|toll[- ]free|deoc|seoc|disaster|flood cell|कंट्रोल रूम|हेल्पलाइन|आपदा)/i;

/**
 * Deterministic fallback used when no AI key is configured: pick lines that
 * mention an emergency keyword AND contain a phone-like number. The line
 * itself is the evidence quote, so verification is exact by construction.
 */
export function extractContactsByPattern(
  pageText: string,
  sourceUrl: string,
  retrievedAt: string,
  limit = 12,
): VerifiedContact[] {
  const out: VerifiedContact[] = [];
  const seen = new Set<string>();
  for (const rawLine of pageText.split(/\n+/)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (line.length < MIN_QUOTE_LENGTH || line.length > 300) continue;
    if (!CONTACT_KEYWORDS.test(line)) continue;
    const phones = line.match(PHONE_RE) ?? [];
    for (const p of phones) {
      if (!isPlausibleIndianPhone(p)) continue;
      const norm = normalizePhone(p);
      if (seen.has(norm)) continue;
      seen.add(norm);
      const label = line.replace(PHONE_RE, "").replace(/[:\-–|,]+\s*$/, "").trim().slice(0, 80) || "Contact";
      out.push({
        label,
        phone: p.trim(),
        evidence: { sourceUrl, evidenceQuote: line, retrievedAt, method: "PATTERN_MATCHED" },
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function labelKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-zऀ-ॿ ]/g, " ")
    .replace(/\b(no|number|phone|tel|contact|the|of)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same role/label published with different numbers on different pages → conflict. */
export function detectContactConflicts(contacts: VerifiedContact[]): ResearchFlag[] {
  const groups = new Map<string, VerifiedContact[]>();
  for (const c of contacts) {
    const k = labelKey(c.label);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const flags: ResearchFlag[] = [];
  for (const [k, list] of groups) {
    const numbers = new Set(list.map((c) => normalizePhone(c.phone)));
    const sources = new Set(list.map((c) => c.evidence.sourceUrl));
    if (numbers.size > 1 && sources.size > 1) {
      flags.push({
        type: "CONFLICT",
        message: `"${k}" is listed with ${numbers.size} different numbers across ${sources.size} official pages. Confirm with the district control room.`,
      });
    }
  }
  return flags;
}

/**
 * Rough page-age signal: the newest 4-digit year mentioned in the text.
 * If the newest year is older than last year, the page is probably stale.
 */
export function detectStalePage(pageText: string, now: Date = new Date()): { stale: boolean; newestYear: number | null } {
  const years = (pageText.match(/\b(19|20)\d{2}\b/g) ?? [])
    .map(Number)
    .filter((y) => y <= now.getFullYear() + 1);
  if (years.length === 0) return { stale: false, newestYear: null };
  const newest = Math.max(...years);
  return { stale: newest < now.getFullYear() - 1, newestYear: newest };
}
