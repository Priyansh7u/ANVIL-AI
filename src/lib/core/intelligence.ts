import { SEVERITY_RANK } from "./cap";
import { assignState, type StateRef } from "./india-states";
import type { CapSeverity, HazardType, NormalizedAlert } from "./types";

/**
 * ANVIL intelligence layer. Every number here is derived ONLY from official
 * CAP alerts (severity, urgency, certainty, timestamps, issuer). These are
 * prioritisation aids with full factor breakdowns — they never replace or
 * upgrade an official warning.
 */

const HOUR = 3_600_000;

// ── 1. Explainable Attention Index ──────────────────────────────────────────

export const SEVERITY_WEIGHT: Record<CapSeverity, number> = { Extreme: 45, Severe: 32, Moderate: 18, Minor: 7, Unknown: 10 };
const URGENCY_MULT: Record<string, number> = { immediate: 1.25, expected: 1.1, future: 0.9, past: 0.4 };
const CERTAINTY_MULT: Record<string, number> = { observed: 1.2, likely: 1.1, possible: 0.9, unlikely: 0.6 };
const RELEVANCE_MULT = { DISTRICT: 1, STATE: 0.5, NONE: 0 } as const;
/** Alert influence halves every 6 hours after issue. */
export const RECENCY_HALF_LIFE_H = 6;

export interface AttentionContribution {
  alertId: string;
  issuer: string;
  headline: string;
  hazard: HazardType;
  points: number;
  severity: CapSeverity;
  parts: { label: string; value: string }[];
}

export interface AttentionResult {
  score: number; // 0–100
  band: "CRITICAL" | "HIGH" | "ELEVATED" | "LOW" | "NONE" | "UNKNOWN";
  contributions: AttentionContribution[];
  corroborationBonus: number;
  method: string;
}

function recencyDecay(issuedAt: string | null, now: number): number {
  if (!issuedAt) return 0.5;
  const ageH = Math.max(0, (now - Date.parse(issuedAt)) / HOUR);
  return Math.pow(0.5, ageH / RECENCY_HALF_LIFE_H);
}

export function attentionIndex(alerts: NormalizedAlert[], feedAvailable: boolean, now: Date = new Date()): AttentionResult {
  const method =
    "Each active official alert scores severity weight × urgency × certainty × area relevance × recency (6 h half-life). " +
    "Scores combine like independent probabilities (1 − Π(1 − pᵢ)), then +10% per extra agency reporting the same hazard (max +30%).";
  if (!feedAvailable) return { score: 0, band: "UNKNOWN", contributions: [], corroborationBonus: 0, method };
  const t = now.getTime();
  const active = alerts.filter((a) => a.freshness === "ACTIVE" && a.relevance !== "NONE");

  const contributions: AttentionContribution[] = active.map((a) => {
    const sev = SEVERITY_WEIGHT[a.severity];
    const urg = URGENCY_MULT[(a.urgency ?? "").toLowerCase()] ?? 1;
    const cer = CERTAINTY_MULT[(a.certainty ?? "").toLowerCase()] ?? 1;
    const rel = RELEVANCE_MULT[a.relevance];
    const rec = recencyDecay(a.issuedAt, t);
    const points = Math.min(95, sev * urg * cer * rel * rec);
    return {
      alertId: a.id,
      issuer: a.issuer,
      headline: a.headline,
      hazard: a.hazard,
      severity: a.severity,
      points: Math.round(points * 10) / 10,
      parts: [
        { label: "Severity", value: `${a.severity} (${sev})` },
        { label: "Urgency", value: `${a.urgency ?? "n/s"} ×${urg}` },
        { label: "Certainty", value: `${a.certainty ?? "n/s"} ×${cer}` },
        { label: "Area", value: `${a.relevance === "DISTRICT" ? "your district" : "your state"} ×${rel}` },
        { label: "Recency", value: `×${rec.toFixed(2)}` },
      ],
    };
  });
  contributions.sort((a, b) => b.points - a.points);

  const combined = 1 - contributions.reduce((p, c) => p * (1 - c.points / 100), 1);
  const issuersByHazard = new Map<string, Set<string>>();
  for (const a of active) {
    const fam = hazardFamily(a.hazard);
    issuersByHazard.set(fam, (issuersByHazard.get(fam) ?? new Set()).add(a.issuer));
  }
  const maxIssuers = Math.max(0, ...Array.from(issuersByHazard.values(), (s) => s.size));
  const corroborationBonus = Math.min(0.3, Math.max(0, maxIssuers - 1) * 0.1);
  const score = Math.min(100, Math.round(combined * 100 * (1 + corroborationBonus)));
  const band = score >= 70 ? "CRITICAL" : score >= 45 ? "HIGH" : score >= 20 ? "ELEVATED" : score > 0 ? "LOW" : "NONE";
  return { score, band, contributions, corroborationBonus, method };
}

// ── 2. Multi-agency corroboration clusters ──────────────────────────────────

export function hazardFamily(h: HazardType): string {
  if (h === "flood" || h === "heavy_rain") return "water";
  if (h === "cyclone" || h === "high_waves" || h === "tsunami") return "coastal";
  return h;
}

export interface CorroborationCluster {
  family: string;
  hazards: HazardType[];
  issuers: string[];
  alertIds: string[];
  maxSeverity: CapSeverity;
  firstIssued: string | null;
  lastIssued: string | null;
}

/** Groups active alerts of the same hazard family whose issue times are within `windowH` of each other. */
export function corroborate(alerts: NormalizedAlert[], windowH = 12): CorroborationCluster[] {
  const active = alerts
    .filter((a) => a.freshness === "ACTIVE" && a.relevance !== "NONE" && a.issuedAt)
    .sort((a, b) => Date.parse(a.issuedAt as string) - Date.parse(b.issuedAt as string));
  const clusters: (CorroborationCluster & { _last: number })[] = [];
  for (const a of active) {
    const fam = hazardFamily(a.hazard);
    const t = Date.parse(a.issuedAt as string);
    const c = clusters.find((x) => x.family === fam && t - x._last <= windowH * HOUR);
    if (c) {
      if (!c.issuers.includes(a.issuer)) c.issuers.push(a.issuer);
      if (!c.hazards.includes(a.hazard)) c.hazards.push(a.hazard);
      c.alertIds.push(a.id);
      if (SEVERITY_RANK[a.severity] > SEVERITY_RANK[c.maxSeverity]) c.maxSeverity = a.severity;
      c.lastIssued = a.issuedAt;
      c._last = t;
    } else {
      clusters.push({ family: fam, hazards: [a.hazard], issuers: [a.issuer], alertIds: [a.id], maxSeverity: a.severity, firstIssued: a.issuedAt, lastIssued: a.issuedAt, _last: t });
    }
  }
  return clusters
    .map(({ _last, ...c }) => c)
    .sort((a, b) => b.issuers.length - a.issuers.length || SEVERITY_RANK[b.maxSeverity] - SEVERITY_RANK[a.maxSeverity]);
}

// ── 3. Escalation detection (Poisson surge test) ────────────────────────────

export interface EscalationResult {
  hourly: { hourStart: string; count: number }[];
  recentPerHour: number;
  baselinePerHour: number;
  z: number;
  escalating: boolean;
  trend: "SURGING" | "RISING" | "STEADY" | "EASING" | "QUIET";
}

/**
 * Counts official alerts per hour over the last `windowH` hours, compares the
 * last `recentH` hours with the earlier baseline and computes a Poisson
 * z-score. Escalating = z ≥ 2 with at least 2 recent alerts.
 */
export function detectEscalation(alerts: { issuedAt: string | null }[], now: Date = new Date(), windowH = 48, recentH = 3): EscalationResult {
  const end = Math.floor(now.getTime() / HOUR) * HOUR + HOUR;
  const start = end - windowH * HOUR;
  const counts = new Array<number>(windowH).fill(0);
  for (const a of alerts) {
    if (!a.issuedAt) continue;
    const t = Date.parse(a.issuedAt);
    if (Number.isNaN(t) || t < start || t >= end) continue;
    const idx = Math.floor((t - start) / HOUR);
    counts[idx] = (counts[idx] ?? 0) + 1;
  }
  const recent = counts.slice(-recentH).reduce((s, n) => s + n, 0);
  const base = counts.slice(0, -recentH).reduce((s, n) => s + n, 0);
  const baselinePerHour = base / (windowH - recentH);
  const recentPerHour = recent / recentH;
  const expected = baselinePerHour * recentH;
  const z = (recent - expected) / Math.sqrt(Math.max(expected, 0.5));
  const escalating = z >= 2 && recent >= 2;
  const trend =
    recent === 0 && base === 0 ? "QUIET" : escalating ? "SURGING" : z >= 1 ? "RISING" : z <= -1 ? "EASING" : "STEADY";
  return {
    hourly: counts.map((count, i) => ({ hourStart: new Date(start + i * HOUR).toISOString(), count })),
    recentPerHour: Math.round(recentPerHour * 100) / 100,
    baselinePerHour: Math.round(baselinePerHour * 100) / 100,
    z: Math.round(z * 100) / 100,
    escalating,
    trend,
  };
}

// ── 4. National aggregation ─────────────────────────────────────────────────

export interface StateSummary {
  code: string;
  name: string;
  center: [number, number];
  active: number;
  total48h: number;
  maxSeverity: CapSeverity;
  hazards: { hazard: HazardType; count: number }[];
  issuers: string[];
  escalation: Pick<EscalationResult, "z" | "trend" | "escalating">;
  latest: { id: string; headline: string; issuer: string; issuedAt: string | null; capUrl: string } | null;
}

export interface NationalPicture {
  states: StateSummary[];
  unassigned: number;
  totals: { active: number; total48h: number; statesAffected: number; issuers: number };
  hazards: { hazard: HazardType; count: number }[];
  issuers: { issuer: string; count: number }[];
  escalation: EscalationResult;
}

export function aggregateNational(alerts: NormalizedAlert[], now: Date = new Date()): NationalPicture {
  const byState = new Map<string, { ref: StateRef; alerts: NormalizedAlert[] }>();
  let unassigned = 0;
  for (const a of alerts) {
    const ref = assignState(a);
    if (!ref) {
      unassigned++;
      continue;
    }
    const e = byState.get(ref.code) ?? { ref, alerts: [] };
    e.alerts.push(a);
    byState.set(ref.code, e);
  }
  const countBy = <K extends string>(list: NormalizedAlert[], key: (a: NormalizedAlert) => K) => {
    const m = new Map<K, number>();
    for (const a of list) m.set(key(a), (m.get(key(a)) ?? 0) + 1);
    return Array.from(m, ([k, count]) => ({ k, count })).sort((x, y) => y.count - x.count);
  };

  const states: StateSummary[] = Array.from(byState.values()).map(({ ref, alerts: list }) => {
    const active = list.filter((a) => a.freshness === "ACTIVE");
    const maxSeverity = active.reduce<CapSeverity>((m, a) => (SEVERITY_RANK[a.severity] > SEVERITY_RANK[m] ? a.severity : m), "Unknown");
    const esc = detectEscalation(list, now);
    const latest = [...list].sort((x, y) => Date.parse(y.issuedAt ?? "0") - Date.parse(x.issuedAt ?? "0"))[0];
    return {
      code: ref.code,
      name: ref.name,
      center: ref.center,
      active: active.length,
      total48h: list.length,
      maxSeverity,
      hazards: countBy(active, (a) => a.hazard).map(({ k, count }) => ({ hazard: k, count })),
      issuers: Array.from(new Set(list.map((a) => a.issuer))),
      escalation: { z: esc.z, trend: esc.trend, escalating: esc.escalating },
      latest: latest ? { id: latest.id, headline: latest.headline, issuer: latest.issuer, issuedAt: latest.issuedAt, capUrl: latest.capUrl } : null,
    };
  });
  states.sort((a, b) => b.active - a.active || SEVERITY_RANK[b.maxSeverity] - SEVERITY_RANK[a.maxSeverity]);

  const active = alerts.filter((a) => a.freshness === "ACTIVE");
  return {
    states,
    unassigned,
    totals: {
      active: active.length,
      total48h: alerts.length,
      statesAffected: states.filter((s) => s.active > 0).length,
      issuers: new Set(alerts.map((a) => a.issuer)).size,
    },
    hazards: countBy(active, (a) => a.hazard).map(({ k, count }) => ({ hazard: k, count })),
    issuers: countBy(alerts, (a) => a.issuer).map(({ k, count }) => ({ issuer: k, count })).slice(0, 12),
    escalation: detectEscalation(alerts, now),
  };
}