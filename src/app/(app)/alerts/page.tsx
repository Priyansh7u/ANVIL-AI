"use client";

import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { placeQuery, useApi } from "@/hooks/use-api";
import { usePlace } from "@/hooks/use-local-state";
import type { AlertsResponse } from "@/types/api";
import { AlertCard, HAZARD_LABEL } from "@/components/alerts/alert-card";
import { DataModeBadge, EmptyState, ErrorState, PageHeader, SourceLink } from "@/components/shared/status";
import { Button, Label, Select, Skeleton } from "@/components/ui/primitives";

export default function AlertsPage() {
  const [place] = usePlace();
  const [scopeChoice, setScope] = useState<"local" | "all">("local");
  const scope = place ? scopeChoice : "all";
  const [hazard, setHazard] = useState("all");
  const [showInactive, setShowInactive] = useState(false);

  const url = scope === "local" && place ? `/api/alerts?${placeQuery(place)}&scope=local` : `/api/alerts?scope=all`;
  const { data, error, loading, reload } = useApi<AlertsResponse>(url, { refreshMs: 5 * 60_000 });

  const visible = useMemo(
    () =>
      (data?.alerts ?? []).filter(
        (a) => (hazard === "all" || a.hazard === hazard) && (showInactive || a.freshness === "ACTIVE" || a.freshness === "UNKNOWN"),
      ),
    [data, hazard, showInactive],
  );
  const hazards = useMemo(() => Array.from(new Set((data?.alerts ?? []).map((a) => a.hazard))), [data]);
  const hidden = (data?.alerts.length ?? 0) - visible.length;

  return (
    <>
      <PageHeader
        title="Live official alerts"
        description="Common Alerting Protocol (CAP) messages from NDMA SACHET, issued by IMD, CWC, SDMAs and other authorised agencies. Last 48 hours."
        actions={
          <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
            <RefreshCw className={cn(loading && "animate-spin")} /> Refresh
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-4 sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="scope">Area</Label>
          <Select id="scope" value={scope} onChange={(e) => setScope(e.target.value as "local" | "all")}>
            {place ? <option value="local">{place.label}</option> : null}
            <option value="all">All India</option>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="hazard">Hazard</Label>
          <Select id="hazard" value={hazard} onChange={(e) => setHazard(e.target.value)}>
            <option value="all">All hazards</option>
            {hazards.map((h) => (
              <option key={h} value={h}>{HAZARD_LABEL[h] ?? h}</option>
            ))}
          </Select>
        </div>
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show expired / stale
        </label>
        <div className="flex flex-col gap-1 text-xs sm:items-end">
          {data ? <DataModeBadge mode={data.dataMode} at={data.retrievedAt} /> : null}
          {data ? <SourceLink href={data.sourceUrl}>SACHET RSS</SourceLink> : null}
        </div>
      </div>

      {error ? <ErrorState message={error.message} onRetry={reload} /> : null}
      {data?.dataMode === "CACHED" ? (
        <ErrorState message={`SACHET is unreachable right now (${data.error ?? "error"}). Showing the last copy ANVIL retrieved — it may be out of date.`} onRetry={reload} />
      ) : null}

      <div className="space-y-3">
        {loading && !data ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="h-32" />)
        ) : visible.length === 0 ? (
          <EmptyState title={data?.dataMode === "UNAVAILABLE" ? "Official feed unavailable" : "No alerts match these filters"}>
            {data?.dataMode === "UNAVAILABLE"
              ? "ANVIL could not reach the SACHET feed. Please check sachet.ndma.gov.in directly."
              : hidden > 0
                ? `${hidden} expired or stale alert(s) are hidden.`
                : "No alerts were issued for this selection in the last 48 hours."}
          </EmptyState>
        ) : (
          visible.map((a) => <AlertCard key={a.id} alert={a} />)
        )}
      </div>
      {hidden > 0 && visible.length > 0 ? <p className="mt-3 text-xs text-muted-foreground">{hidden} alert(s) hidden by filters.</p> : null}
    </>
  );
}
