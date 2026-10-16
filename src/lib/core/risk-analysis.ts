import type { CapSeverity, HazardType, NormalizedAlert } from "./types";
import { SEVERITY_RANK } from "./cap";

export type RiskLevel = "SEVERE" | "ELEVATED" | "ADVISORY" | "NO_ACTIVE_ALERTS" | "UNKNOWN";

export interface RiskSummary {
  level: RiskLevel;
  activeLocal: number;
  activeState: number;
  expiredOrStale: number;
  byHazard: { hazard: HazardType; count: number }[];
  topAlert: NormalizedAlert | null;
  rationale: string[];
}

/**
 * Derive an at-a-glance level ONLY from official alerts. This is a display
 * aid, not a forecast: it never upgrades risk beyond what an official alert
 * states, and reports UNKNOWN when the feed is unavailable.
 */
export function summarizeRisk(alerts: NormalizedAlert[], feedAvailable: boolean): RiskSummary {
  if (!feedAvailable) {
    return {
      level: "UNKNOWN",
      activeLocal: 0,
      activeState: 0,
      expiredOrStale: 0,
      byHazard: [],
      topAlert: null,
      rationale: ["Official alert feed could not be reached — risk cannot be assessed. Check official channels."],
    };
  }
  const relevant = alerts.filter((a) => a.relevance !== "NONE");
  const active = relevant.filter((a) => a.freshness === "ACTIVE");
  const local = active.filter((a) => a.relevance === "DISTRICT");
  const state = active.filter((a) => a.relevance === "STATE");

  const counts = new Map<HazardType, number>();
  for (const a of active) counts.set(a.hazard, (counts.get(a.hazard) ?? 0) + 1);

  const sorted = [...active].sort(
    (a, b) =>
      (b.relevance === "DISTRICT" ? 1 : 0) - (a.relevance === "DISTRICT" ? 1 : 0) ||
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      Date.parse(b.issuedAt ?? "0") - Date.parse(a.issuedAt ?? "0"),
  );
  const top = sorted[0] ?? null;
  const maxLocal: CapSeverity | null = local.reduce<CapSeverity | null>(
    (m, a) => (m === null || SEVERITY_RANK[a.severity] > SEVERITY_RANK[m] ? a.severity : m),
    null,
  );

  let level: RiskLevel = "NO_ACTIVE_ALERTS";
  const rationale: string[] = [];
  if (maxLocal && SEVERITY_RANK[maxLocal] >= SEVERITY_RANK.Severe) {
    level = "SEVERE";
    rationale.push(`${local.length} active official alert(s) name your district; highest severity: ${maxLocal}.`);
  } else if (local.length > 0) {
    level = "ELEVATED";
    rationale.push(`${local.length} active official alert(s) name your district.`);
  } else if (state.length > 0) {
    level = "ADVISORY";
    rationale.push(`${state.length} active alert(s) for your state, none naming your district specifically.`);
  } else {
    rationale.push("No active official alerts matched your district or state in the latest SACHET feed.");
  }
  const expired = relevant.length - active.length;
  if (expired > 0) rationale.push(`${expired} older alert(s) are expired or stale and shown separately.`);

  return {
    level,
    activeLocal: local.length,
    activeState: state.length,
    expiredOrStale: expired,
    byHazard: Array.from(counts, ([hazard, count]) => ({ hazard, count })).sort((a, b) => b.count - a.count),
    topAlert: top,
    rationale,
  };
}
