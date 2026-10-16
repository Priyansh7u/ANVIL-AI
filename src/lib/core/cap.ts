import type { CapSeverity, HazardType, NormalizedAlert } from "./types";
import { findAllElements, textOf, textsOf } from "./xml";
import { assessAlertFreshness } from "./freshness";

/**
 * Parsers for the NDMA SACHET public feeds.
 *  - RSS index: https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml
 *  - Each item links to a CAP 1.2 XML document (FetchXMLFile?identifier=...).
 * Field layout verified against the live feed (Oct 2026).
 */

export interface RssItem {
  title: string;
  link: string;
  guid: string;
  author: string | null;
  category: string | null;
  pubDate: string | null; // ISO
}

export interface RssFeed {
  title: string | null;
  publishedAt: string | null; // ISO
  items: RssItem[];
}

export interface CapArea {
  areaDesc: string;
  geocodes: { valueName: string; value: string }[];
}

export interface CapDocument {
  identifier: string;
  sender: string | null;
  sent: string | null;
  status: string | null;
  msgType: string | null;
  scope: string | null;
  language: string | null;
  category: string | null;
  event: string | null;
  urgency: string | null;
  severity: CapSeverity;
  certainty: string | null;
  effective: string | null;
  onset: string | null;
  expires: string | null;
  senderName: string | null;
  headline: string | null;
  description: string | null;
  instruction: string | null;
  areas: CapArea[];
}

export function toIso(value: string | null): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function parseRss(xml: string): RssFeed {
  const [channel = xml] = findAllElements(xml, "channel");
  // channel-level fields appear before the first <item>
  const head = channel.split(/<item[\s>]/)[0] ?? "";
  const items: RssItem[] = [];
  for (const raw of findAllElements(channel, "item")) {
    const link = textOf(raw, "link");
    const title = textOf(raw, "title");
    if (!link || !title) continue; // malformed entries are skipped, not guessed
    items.push({
      title,
      link,
      guid: textOf(raw, "guid") ?? link,
      author: textOf(raw, "author"),
      category: textOf(raw, "category"),
      pubDate: toIso(textOf(raw, "pubDate")),
    });
  }
  return {
    title: textOf(head, "title"),
    publishedAt: toIso(textOf(head, "pubDate")),
    items,
  };
}

const SEVERITIES: CapSeverity[] = ["Extreme", "Severe", "Moderate", "Minor", "Unknown"];

function toSeverity(v: string | null): CapSeverity {
  const found = SEVERITIES.find((s) => s.toLowerCase() === (v ?? "").toLowerCase());
  return found ?? "Unknown";
}

export function parseCap(xml: string): CapDocument | null {
  const identifier = textOf(xml, "identifier");
  if (!identifier) return null;
  const infos = findAllElements(xml, "info");
  // Prefer an English info block when several languages are present.
  const info =
    infos.find((i) => (textOf(i, "language") ?? "").toLowerCase().startsWith("en")) ?? infos[0] ?? "";

  const areas: CapArea[] = findAllElements(info, "area").map((a) => ({
    areaDesc: textOf(a, "areaDesc") ?? "",
    geocodes: findAllElements(a, "geocode").map((g) => ({
      valueName: textOf(g, "valueName") ?? "",
      value: textOf(g, "value") ?? "",
    })),
  }));

  return {
    identifier,
    sender: textOf(xml, "sender"),
    sent: toIso(textOf(xml, "sent")),
    status: textOf(xml, "status"),
    msgType: textOf(xml, "msgType"),
    scope: textOf(xml, "scope"),
    language: textOf(info, "language"),
    category: textOf(info, "category"),
    event: textOf(info, "event"),
    urgency: textOf(info, "urgency"),
    severity: toSeverity(textOf(info, "severity")),
    certainty: textOf(info, "certainty"),
    effective: toIso(textOf(info, "effective")),
    onset: toIso(textOf(info, "onset")),
    expires: toIso(textOf(info, "expires")),
    senderName: textOf(info, "senderName"),
    headline: textOf(info, "headline"),
    description: textOf(info, "description"),
    instruction: textOf(info, "instruction"),
    areas,
  };
}

/** "controlroom@ndma.gov.in (IMD Chennai)" → "IMD Chennai" */
export function extractIssuer(author: string | null): string {
  if (!author) return "NDMA SACHET";
  const m = author.match(/\(([^)]+)\)/);
  return (m?.[1] ?? author).trim();
}

const HAZARD_RULES: [HazardType, RegExp][] = [
  ["tsunami", /tsunami|सुनामी/i],
  ["cyclone", /cyclon|depression over|deep depression|चक्रवात/i],
  ["earthquake", /earthquake|seismic|magnitude|भूकंप/i],
  ["landslide", /landslide|भूस्खलन/i],
  ["avalanche", /avalanche|हिमस्खलन/i],
  ["flood", /flood|river .* (above|severe)|water level|बाढ़|বন্যা/i],
  ["high_waves", /high wave|swell|storm surge|అలల/i],
  ["heatwave", /heat ?wave|hot and humid|लू|उष्ण/i],
  ["cold_wave", /cold wave|cold day|frost|शीत/i],
  ["fire", /forest fire|wildfire|fire/i],
  ["thunderstorm", /thunder|lightning|squall|hail|गरज|वज्रपात|बिजली|ఉరుము|పిడుగు/i],
  ["heavy_rain", /heavy rain|rain|वर्षा|बारिश|മഴ|వర్షం|மழை/i],
];

export function classifyHazard(...texts: (string | null | undefined)[]): HazardType {
  const joined = texts.filter(Boolean).join(" ");
  for (const [hazard, re] of HAZARD_RULES) {
    if (re.test(joined)) return hazard;
  }
  return "other";
}

/**
 * Combine an RSS entry with its (optional) CAP document into the normalized
 * shape used everywhere in ANVIL. When the CAP doc is missing we keep the
 * entry but mark it `partial` — we never fill gaps with guesses.
 */
export function normalizeAlert(
  item: RssItem,
  cap: CapDocument | null,
  retrievedAt: string,
  now: Date = new Date(),
): Omit<NormalizedAlert, "relevance"> {
  const headline = cap?.headline ?? item.title;
  const issuedAt = cap?.sent ?? item.pubDate;
  const expiresAt = cap?.expires ?? null;
  return {
    id: cap?.identifier ?? item.guid,
    source: "SACHET_CAP",
    issuer: cap?.senderName ?? extractIssuer(item.author),
    headline,
    event: cap?.event ?? null,
    // The CAP <event> field is authoritative; fall back to headline keywords.
    hazard: cap?.event && classifyHazard(cap.event) !== "other" ? classifyHazard(cap.event) : classifyHazard(headline),
    severity: cap?.severity ?? "Unknown",
    urgency: cap?.urgency ?? null,
    certainty: cap?.certainty ?? null,
    areaDesc: cap ? cap.areas.map((a) => a.areaDesc).filter(Boolean).join("; ") || null : null,
    instruction: cap?.instruction ?? null,
    issuedAt,
    effectiveAt: cap?.effective ?? null,
    expiresAt,
    retrievedAt,
    capUrl: item.link,
    freshness: assessAlertFreshness({ issuedAt, expiresAt, now }),
    partial: cap === null,
  };
}

export const SEVERITY_RANK: Record<CapSeverity, number> = {
  Extreme: 4,
  Severe: 3,
  Moderate: 2,
  Minor: 1,
  Unknown: 0,
};

/** CAP feeds often publish the same message several times; collapse by issuer+headline+issue minute. */
export function dedupeAlerts<T extends { issuer: string; headline: string; issuedAt: string | null }>(
  alerts: T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const a of alerts) {
    const key = `${a.issuer}|${a.headline.toLowerCase().replace(/\s+/g, " ")}|${(a.issuedAt ?? "").slice(0, 13)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

export { textsOf };
