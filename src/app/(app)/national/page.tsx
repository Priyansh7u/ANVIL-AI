"use client";

import { RefreshCw, TrendingUp } from "lucide-react";
import { relativeTime } from "@/lib/core/freshness";
import { cn } from "@/lib/utils";
import { useApi } from "@/hooks/use-api";
import { SEVERITY_COLOR } from "@/types/api";
import type { NationalResponse } from "@/types/national";
import { HAZARD_LABEL } from "@/components/alerts/alert-card";
import { HazardChart } from "@/components/dashboard/hazard-chart";
import { EscalationChart, TREND_TEXT } from "@/components/national/escalation-chart";
import { NationalMap } from "@/components/national/national-map";
import { DataModeBadge, ErrorState, PageHeader, SourceLink } from "@/components/shared/status";
import { Badge, Button, Skeleton } from "@/components/ui/primitives";

export default function NationalPage() {
  const { data, error, loading, reload } = useApi<NationalResponse>("/api/national", { refreshMs: 3 * 60_000 });
  const trend = data ? TREND_TEXT[data.escalation.trend] : null;

  return (
    <>
      <PageHeader
        title="National situation room"
        description="Every official alert issued in India over the last 48 hours, from the NDMA SACHET feed, grouped by state and checked for surges."
        actions={
          <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
            <RefreshCw className={cn(loading && "animate-spin")} /> Refresh
          </Button>
        }
      />
      {error ? <div className="mb-4"><ErrorState message={error.message} onRetry={reload} /></div> : null}

      <div className="panel mb-4 grid grid-cols-2 divide-border overflow-hidden sm:grid-cols-5 sm:divide-x">
        {[
          ["Active alerts", data?.totals.active],
          ["Issued in 48 h", data?.totals.total48h],
          ["States with active alerts", data?.totals.statesAffected],
          ["Issuing agencies", data?.totals.issuers],
        ].map(([k, v]) => (
          <div key={k as string} className="px-4 py-3">
            <p className="label-caps">{k}</p>
            <p className="num display text-3xl">{v ?? "–"}</p>
          </div>
        ))}
        <div className="col-span-2 px-4 py-3 sm:col-span-1">
          <p className="label-caps">Alert rate, last 3 h</p>
          <p className="flex items-center gap-2">
            <span className="num display text-3xl">{data ? data.escalation.recentPerHour : "–"}</span>
            <span className="text-xs text-muted-foreground">per hour</span>
            {trend ? <Badge tone={trend.tone}><TrendingUp className="size-3" /> {trend.label}</Badge> : null}
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-8">
          <div className="panel overflow-hidden">
            <NationalMap data={data} className="h-[420px] w-full sm:h-[560px]" />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2 text-[11px] text-muted-foreground">
              {(["Extreme", "Severe", "Moderate", "Minor", "Unknown"] as const).map((s) => (
                <span key={s} className="flex items-center gap-1">
                  <span className="inline-block size-2.5 rounded-full" style={{ background: SEVERITY_COLOR[s] }} />
                  {s === "Unknown" ? "Severity not stated" : s}
                </span>
              ))}
              <span>Bubble size = number of active alerts</span>
              {data?.unassigned ? <span>{data.unassigned} alert(s) could not be placed in a state and are not drawn</span> : null}
              {data ? <DataModeBadge mode={data.feed.dataMode} at={data.feed.retrievedAt} /> : null}
            </div>
          </div>

          <div className="panel p-4">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <p className="label-caps">Official alerts issued per hour</p>
              {data ? (
                <p className="text-xs text-muted-foreground">
                  Last 3 h: <span className="num">{data.escalation.recentPerHour}</span>/h vs <span className="num">{data.escalation.baselinePerHour}</span>/h before · surge score z = <span className="num">{data.escalation.z}</span>
                </p>
              ) : null}
            </div>
            {data ? <EscalationChart escalation={data.escalation} height={170} /> : <Skeleton className="h-40" />}
            <p className="mt-1 text-[11px] text-muted-foreground">Surge test: recent count compared with the 45-hour baseline as a Poisson rate. A score of 2 or more with at least 2 recent alerts is flagged as surging.</p>
          </div>
        </div>

        <div className="space-y-4 xl:col-span-4">
          <div className="panel p-4">
            <p className="label-caps mb-2">States by active alerts</p>
            {!data ? (
              <Skeleton className="h-64" />
            ) : (
              <ol className="max-h-[420px] space-y-1.5 overflow-auto pr-1 text-sm">
                {data.states.map((s, i) => (
                  <li key={s.code} className="flex items-center gap-3 rounded-md border bg-card/50 px-3 py-2">
                    <span className="num w-5 text-muted-foreground">{i + 1}</span>
                    <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: SEVERITY_COLOR[s.maxSeverity] }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{s.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {s.hazards.slice(0, 3).map((h) => HAZARD_LABEL[h.hazard] ?? h.hazard).join(", ") || "no active hazards"}
                      </span>
                    </span>
                    {s.escalation.escalating ? <Badge tone="danger">Surging</Badge> : null}
                    <span className="num text-lg">{s.active}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="panel p-4">
            <p className="label-caps mb-2">Active alerts by hazard</p>
            {data ? <HazardChart data={data.hazards} /> : <Skeleton className="h-48" />}
          </div>

          <div className="panel p-4">
            <p className="label-caps mb-2">Most active issuing agencies, 48 h</p>
            <ul className="space-y-1 text-sm">
              {(data?.issuers ?? []).map((i) => (
                <li key={i.issuer} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{i.issuer}</span>
                  <span className="h-1.5 rounded bg-primary/70" style={{ width: `${Math.max(6, (i.count / (data?.issuers[0]?.count ?? 1)) * 90)}px` }} />
                  <span className="num w-8 text-right">{i.count}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="panel mt-4 p-4">
        <p className="label-caps mb-2">Latest active alerts, all India</p>
        <ul className="divide-y text-sm">
          {(data?.latest ?? []).slice(0, 12).map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="inline-block size-2.5 rounded-full" style={{ background: SEVERITY_COLOR[a.severity] }} />
              <span className="font-medium">{a.issuer}</span>
              <span className="min-w-0 flex-1">{a.headline}</span>
              <span className="text-xs text-muted-foreground">{relativeTime(a.issuedAt)}</span>
              <SourceLink href={a.capUrl}>CAP</SourceLink>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}