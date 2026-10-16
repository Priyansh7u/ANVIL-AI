/**
 * Algorithm E — data quality for each map layer: where it came from, how old
 * it is, how it is verified, how much of its geometry was usable, and what
 * is uncertain about it. No confidence percentages are invented.
 */

export type Verification = "OFFICIAL" | "OFFICIAL_APPROXIMATE" | "COMMUNITY_MAPPED" | "SIMULATED" | "UNAVAILABLE";
export type LayerFreshness = "LIVE" | "RECENT" | "STALE" | "UNKNOWN" | "NOT_APPLICABLE";

export interface LayerQuality {
  layer: string;
  source: string;
  verification: Verification;
  retrievedAt: string | null;
  ageMinutes: number | null;
  freshness: LayerFreshness;
  features: number;
  invalidGeometry: number;
  uncertainty: string[];
  isSimulated: boolean;
}

export function assessLayer(args: {
  layer: string;
  source: string;
  verification: Verification;
  retrievedAt: string | null;
  features: number;
  invalidGeometry?: number;
  /** Age up to which the layer counts as LIVE, and beyond which as STALE. */
  liveMinutes?: number;
  staleMinutes?: number;
  uncertainty?: string[];
  now?: Date;
}): LayerQuality {
  const now = args.now ?? new Date();
  const isSimulated = args.verification === "SIMULATED";
  const age = args.retrievedAt ? Math.max(0, Math.round((now.getTime() - Date.parse(args.retrievedAt)) / 60_000)) : null;
  const live = args.liveMinutes ?? 10;
  const stale = args.staleMinutes ?? 60;
  const freshness: LayerFreshness = isSimulated ? "NOT_APPLICABLE" : age === null ? "UNKNOWN" : age <= live ? "LIVE" : age <= stale ? "RECENT" : "STALE";
  const uncertainty = [...(args.uncertainty ?? [])];
  if (args.invalidGeometry) uncertainty.push(`${args.invalidGeometry} geometr${args.invalidGeometry === 1 ? "y was" : "ies were"} invalid and not drawn.`);
  if (!isSimulated && args.verification !== "UNAVAILABLE" && args.features === 0) uncertainty.push("No features in this area — absence of data is not evidence of absence of hazard.");
  return {
    layer: args.layer,
    source: args.source,
    verification: args.verification,
    retrievedAt: args.retrievedAt,
    ageMinutes: age,
    freshness,
    features: args.features,
    invalidGeometry: args.invalidGeometry ?? 0,
    uncertainty,
    isSimulated,
  };
}

export const VERIFICATION_LABEL: Record<Verification, string> = {
  OFFICIAL: "Official source",
  OFFICIAL_APPROXIMATE: "Official alert, approximate area",
  COMMUNITY_MAPPED: "Community-mapped (OpenStreetMap)",
  SIMULATED: "SIMULATED — not an observation",
  UNAVAILABLE: "No data source connected",
};