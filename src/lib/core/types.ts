/**
 * Shared domain types. This file (and everything in src/lib/core) is
 * dependency-free so it can be unit-tested in isolation and imported from
 * both server and client code.
 */

/** Where a piece of data came from — never mix these in the UI without a label. */
export type DataMode = "LIVE" | "CACHED" | "STALE" | "SIMULATED" | "UNAVAILABLE";

export type CapSeverity = "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown";

export type HazardType =
  | "flood"
  | "heavy_rain"
  | "thunderstorm"
  | "cyclone"
  | "heatwave"
  | "cold_wave"
  | "earthquake"
  | "landslide"
  | "tsunami"
  | "high_waves"
  | "avalanche"
  | "fire"
  | "other";

export type AlertFreshness = "ACTIVE" | "EXPIRED" | "STALE" | "UNKNOWN";

export type LocationRelevance = "DISTRICT" | "STATE" | "NONE";

export interface Place {
  /** Human label, e.g. "Patna, Bihar" */
  label: string;
  district: string | null;
  state: string | null;
  /** Rounded to 2 decimals (~1 km) — never store or send precise coordinates. */
  lat: number | null;
  lon: number | null;
  source: "gps" | "manual" | "demo";
}

export interface NormalizedAlert {
  id: string; // CAP identifier or RSS guid
  source: "SACHET_CAP";
  issuer: string; // e.g. "IMD New Delhi", "CWC"
  headline: string;
  event: string | null;
  hazard: HazardType;
  severity: CapSeverity;
  urgency: string | null;
  certainty: string | null;
  areaDesc: string | null;
  instruction: string | null;
  issuedAt: string | null; // ISO
  effectiveAt: string | null;
  expiresAt: string | null;
  retrievedAt: string; // ISO — when ANVIL fetched it
  capUrl: string; // official CAP XML link
  freshness: AlertFreshness;
  relevance: LocationRelevance;
  /** true when the full CAP document could not be retrieved and only RSS fields are known */
  partial: boolean;
  /** Official alert area polygons ([lat, lon] rings) when SACHET publishes them and they parse cleanly. */
  polygons?: [number, number][][];
}

export interface ResearchEvent {
  at: string;
  state: ResearchState;
  message: string;
  url?: string;
}

export type ResearchState =
  | "PENDING"
  | "RESEARCHING"
  | "VALIDATING"
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED";

export type FlagType =
  | "STALE"
  | "CONFLICT"
  | "MISSING"
  | "INJECTION_SUSPECTED"
  | "FETCH_FAILED"
  | "UNVERIFIED_DROPPED"
  | "NON_OFFICIAL_SKIPPED";

export interface ResearchFlag {
  type: FlagType;
  message: string;
  url?: string;
}

export interface EvidenceRef {
  sourceUrl: string;
  evidenceQuote: string;
  retrievedAt: string;
  method: "AI_EXTRACTED_QUOTE_VERIFIED" | "PATTERN_MATCHED" | "AGENT_EXTRACTED_QUOTE_VERIFIED";
}

export interface VerifiedContact {
  label: string;
  phone: string;
  evidence: EvidenceRef;
}

export interface VerifiedShelter {
  name: string;
  address: string | null;
  district: string | null;
  capacity: number | null;
  accessibility: string | null;
  operationalStatus: string | null;
  evidence: EvidenceRef;
}

export interface VerifiedRoadClosure {
  road: string;
  status: string;
  evidence: EvidenceRef;
}

export interface VerifiedAdvisory {
  text: string;
  evidence: EvidenceRef;
}

export interface SourceVisit {
  url: string;
  title: string | null;
  official: boolean;
  status: "FETCHED" | "FAILED" | "SKIPPED";
  fetchedAt: string | null;
  via: "TINYFISH_SEARCH" | "TINYFISH_FETCH" | "TINYFISH_AGENT";
  note?: string;
}