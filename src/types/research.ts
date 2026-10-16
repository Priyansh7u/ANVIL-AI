import type { Conflict, EventOrigin, Freshness, GeoRelevance, HazardStage, IntelReport, ResearchHazard, SourceCategory } from "@/lib/core/hazard-intel";

export interface LiveEvent {
  at: string;
  stage: HazardStage;
  origin: EventOrigin;
  message: string;
  url?: string;
}

export interface LiveTaskDto {
  id: string;
  place: { label: string; district: string | null; state: string | null };
  hazard: ResearchHazard;
  status: string;
  stage: HazardStage;
  trigger?: "USER" | "MONITOR";
  events: LiveEvent[];
  counts?: Record<string, number>;
  providerRuns?: { runId: string; status: string; startedAt: string }[];
  report?: IntelReport & { citations?: Record<string, string> };
  gaps?: string[];
  capabilities?: { ai: boolean; agent: boolean };
  error?: string | null;
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface FindingDto {
  id: string;
  itemKey: string;
  title: string;
  summary: string;
  hazard: string;
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
  alertLevel: "RED" | "ORANGE" | "YELLOW" | "GREEN" | null;
  withdrawal?: boolean;
  origin: "SACHET_FEED" | "TINYFISH_FETCH" | "TINYFISH_AGENT";
  corroboratedBy: { sourceName: string; sourceUrl: string; category: SourceCategory }[];
  conflictsWith: string[];
  instruction?: string | null;
  areaDesc?: string | null;
}

export interface SourceDto {
  id: string;
  url: string;
  host: string;
  title: string | null;
  sourceName: string;
  category: SourceCategory;
  discoveredVia: "SACHET_FEED" | "TINYFISH_SEARCH" | "TINYFISH_AGENT";
  providerDate: string | null;
  status: "DISCOVERED" | "FETCHED" | "FAILED" | "SKIPPED";
  note?: string;
  retrievedAt?: string;
  publishedAt?: string | null;
  findingCount?: number;
  injectionSuspected?: boolean;
}

export interface ResultsResponse {
  task: LiveTaskDto;
  findings: FindingDto[];
  sources: SourceDto[];
  storage: string;
}

export interface HistoryResponse {
  tasks: { id: string; place: LiveTaskDto["place"]; hazard: ResearchHazard; status: string; stage: HazardStage; trigger: string; counts: Record<string, number>; insufficientEvidence: boolean | null; createdAt: string; finishedAt: string | null }[];
  latestUsableTaskId: string | null;
  capabilities: { database: boolean; tinyfish: boolean; tinyfishAgent: boolean; ai: boolean; scheduler?: boolean };
  storage: string;
}

export interface MonitorDto {
  id: string;
  place: LiveTaskDto["place"];
  hazard: ResearchHazard;
  intervalMinutes: number;
  active: boolean;
  nextRunAt?: string;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastTaskId?: string;
  lastStatus?: string;
  lastError?: string | null;
  consecutiveFailures?: number;
  running?: boolean;
  knownCount: number;
  changes: { at: string; taskId: string; kind: "NEW" | "CHANGED"; title: string; sourceName: string; sourceUrl: string; category: string; publishedAt: string | null }[];
}

export interface MonitorsResponse {
  monitors: MonitorDto[];
  scheduler: { configured: boolean; note: string };
  storage: string;
}

export type { Conflict };