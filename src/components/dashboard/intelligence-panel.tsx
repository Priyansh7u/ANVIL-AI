"use client";

import { useState } from "react";
import { ChevronDown, Layers, TrendingUp } from "lucide-react";
import type { AttentionResult, CorroborationCluster, EscalationResult } from "@/lib/core/intelligence";
import type { Place } from "@/lib/core/types";
import { cn } from "@/lib/utils";
import { placeQuery, useApi } from "@/hooks/use-api";
import { EscalationChart, TREND_TEXT } from "@/components/national/escalation-chart";
import { ErrorState } from "@/components/shared/status";
import { Badge, Skeleton } from "@/components/ui/primitives";

interface IntelligenceResponse {
  generatedAt: string;
  attention: AttentionResult;
  corroboration: CorroborationCluster[];
  escalation: EscalationResult;
}

const BAND_COLOR: Record<AttentionResult["band"], string> = {
  CRITICAL: "var(--danger)",
  HIGH: "#f97316",
  ELEVATED: "var(--warning)",
  LOW: "var(--primary)",
  NONE: "var(--ok)",
  UNKNOWN: "var(--muted-foreground)",
};
const BAND_TEXT: Record<AttentionResult["band"], string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  ELEVATED: "Elevated",
  LOW: "Low",
  NONE: "No active alerts",
  UNKNOWN: "Feed unavailable",
};
const FAMILY: Record<string, string> = { water: "Rain and flooding", coastal: "Coastal hazards" };

/** Half-circle gauge drawn in SVG; the arc length is the score. */
function Gauge({ score, band }: { score: number; band: AttentionResult["band"] }) {
  const r = 52;
  const len = Math.PI * r;
  return (
    <svg viewBox="0 0 128 74" className="h-auto w-40" role="img" aria-label={`Attention index ${score} of 100, ${BAND_TEXT[band]}`}>
      <path d="M12 66 A52 52 0 0 1 116 66" fill="none" stroke="var(--muted)" strokeWidth="10" strokeLinecap="round" />
      <path
        d="M12 66 A52 52 0 0 1 116 66"
        fill="none"
        stroke={BAND_COLOR[band]}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={`${(score / 100) * len} ${len}`}
        style={{ transition: "stroke-dasharray 600ms ease" }}
      />
      <text x="64" y="58" textAnchor="middle" fontSize="28" fontWeight="800" fill="var(--foreground)" style={{ fontStretch: "75%" }}>
        {band === "UNKNOWN" ? "?" : score}
      </text>
      <text x="64" y="71" textAnchor="middle" fontSize="8" fill="var(--muted-foreground)">
        of 100
      </text>
    </svg>
  );
}

/**
 * Explainable attention index + escalation + multi-agency corroboration for
 * the selected area. Prioritisation aid only — never an official warning level.
 */
export function IntelligencePanel({ place }: { place: Place }) {
  const { data, error, loading, reload } = useApi<IntelligenceResponse>(`/api/intelligence?${placeQuery(place)}`, { refreshMs: 5 * 60_000 });
  const [open, setOpen] = useState(false);

  if (loading && !data) return <Skeleton className="h-56" />;
  if (error && !data) return <ErrorState message={error.message} onRetry={reload} />;
  if (!data) return null;
  const { attention, escalation, corroboration } = data;
  const trend = TREND_TEXT[escalation.trend];
  const multi = corroboration.filter((c) => c.issuers.length > 1);

  return (
    <section className="panel p-4" aria-labelledby="intel-title">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id="intel-title" className="text-sm font-semibold">Attention index</h2>
          <p className="text-xs text-muted-foreground">How much the current official alerts call for your attention</p>
        </div>
        <Badge tone={trend.tone}><TrendingUp className="size-3" /> {trend.label}</Badge>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <Gauge score={attention.score} band={attention.band} />
        <div className="min-w-0 text-sm">
          <p className="font-semibold" style={{ color: BAND_COLOR[attention.band] }}>{BAND_TEXT[attention.band]}</p>
          <p className="text-xs text-muted-foreground">
            {attention.contributions.length} active alert(s)
            {attention.corroborationBonus > 0 ? `, confirmed by ${Math.round(attention.corroborationBonus * 10) + 1} agencies (+${Math.round(attention.corroborationBonus * 100)}%)` : ""}
          </p>
        </div>
      </div>

      {attention.contributions.length ? (
        <div className="mt-2">
          <button className="flex w-full items-center justify-between rounded-md px-1 py-1 text-xs font-medium hover:bg-muted" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            Why this score
            <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
          </button>
          {open ? (
            <div className="mt-1 space-y-2">
              {attention.contributions.slice(0, 5).map((c) => (
                <div key={c.alertId} className="rounded-md border bg-card/50 p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{c.issuer}</span>
                    <span className="num text-sm">+{c.points}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded bg-muted">
                    <div className="h-full rounded" style={{ width: `${Math.min(100, c.points)}%`, background: BAND_COLOR[attention.band] }} />
                  </div>
                  <p className="mt-1 text-muted-foreground">{c.parts.map((p) => `${p.label} ${p.value}`).join(" · ")}</p>
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground">{attention.method}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3">
        <p className="mb-1 text-xs font-medium">Alerts per hour for your area, last 48 h</p>
        <EscalationChart escalation={escalation} height={90} />
      </div>

      {multi.length ? (
        <div className="mt-3">
          <p className="mb-1 flex items-center gap-1 text-xs font-medium"><Layers className="size-3.5" /> Confirmed by several agencies</p>
          <ul className="space-y-1 text-xs">
            {multi.slice(0, 3).map((c) => (
              <li key={c.alertIds[0]} className="rounded-md border px-2 py-1.5">
                <span className="font-medium">{FAMILY[c.family] ?? c.family}</span>: {c.issuers.join(", ")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="mt-3 text-[11px] text-muted-foreground">A prioritisation aid computed from official alerts. It never replaces an official warning level.</p>
    </section>
  );
}