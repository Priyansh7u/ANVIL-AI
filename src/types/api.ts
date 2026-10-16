import type { DataMode, NormalizedAlert, ResearchEvent, ResearchFlag, ResearchState, SourceVisit, VerifiedAdvisory, VerifiedContact, VerifiedRoadClosure, VerifiedShelter } from "@/lib/core/types";
import type { RiskSummary } from "@/lib/core/risk-analysis";

export interface AlertsResponse {
  dataMode: DataMode;
  feedPublishedAt: string | null;
  retrievedAt: string | null;
  sourceUrl: string;
  error: string | null;
  capFailures: number;
  alerts: NormalizedAlert[];
  risk: RiskSummary;
}

export interface ResearchTaskDto {
  id: string;
  place: { label: string; district: string | null; state: string | null };
  status: ResearchState;
  events: ResearchEvent[];
  sources: SourceVisit[];
  flags: ResearchFlag[];
  result?: {
    summary: string | null;
    summaryIsAiGenerated: boolean;
    contacts: VerifiedContact[];
    shelters: VerifiedShelter[];
    advisories: VerifiedAdvisory[];
    roadClosures?: VerifiedRoadClosure[];
  };
  capabilities?: { ai: boolean; agent: boolean };
  error?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface ShelterDto {
  id: string;
  name: string;
  address: string | null;
  district: string | null;
  state: string | null;
  capacity: number | null;
  accessibility: string | null;
  operationalStatus: string | null;
  location?: { lat?: number; lon?: number; precision: "GEOCODED_ADDRESS" | "NONE" };
  verification: { status: "SOURCE_DOCUMENTED"; evidence: VerifiedShelter["evidence"]; researchTaskId?: string };
  updatedAt?: string;
}

export interface ConfigResponse {
  capabilities: { database: boolean; tinyfish: boolean; tinyfishAgent: boolean; ai: boolean; webPush: boolean; scheduler?: boolean };
  storage: "MONGODB" | "EPHEMERAL";
  map: { tileUrl: string; attribution: string };
}

export interface HazardDto {
  id: string;
  headline: string;
  issuer: string;
  hazard: string;
  severity: "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown";
  relevance: "DISTRICT" | "STATE" | "NONE";
  issuedAt: string | null;
  expiresAt: string | null;
  instruction: string | null;
  capUrl: string;
  areaSource: "CAP_POLYGON" | "DISTRICT_BOUNDARY" | "NOT_MAPPED";
  polygons: [number, number][][];
}

export interface HazardMapResponse {
  generatedAt: string;
  feed: { dataMode: DataMode; retrievedAt: string | null; feedPublishedAt: string | null; sourceUrl: string };
  hazards: HazardDto[];
  boundary: { polygons: [number, number][][]; name: string; source: string } | null;
  shelters: ShelterDto[];
  roadClosures: VerifiedRoadClosure[];
  researchFinishedAt: string | null;
  storage: string;
}

export const SEVERITY_COLOR: Record<HazardDto["severity"], string> = {
  Extreme: "#ef4444",
  Severe: "#f97316",
  Moderate: "#f59e0b",
  Minor: "#38bdf8",
  Unknown: "#a1a1aa",
};