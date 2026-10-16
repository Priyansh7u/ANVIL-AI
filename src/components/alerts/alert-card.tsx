"use client";

import { Clock, MapPin } from "lucide-react";
import { ListenButton } from "@/components/shared/listen-button";
import type { NormalizedAlert } from "@/lib/core/types";
import { relativeTime } from "@/lib/core/freshness";
import { cn, formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/primitives";
import { FreshnessBadge, SeverityBadge, SourceLink } from "@/components/shared/status";

export const HAZARD_LABEL: Record<string, string> = {
  flood: "Flood",
  heavy_rain: "Heavy rain",
  thunderstorm: "Thunderstorm / lightning",
  cyclone: "Cyclone",
  heatwave: "Heatwave",
  cold_wave: "Cold wave",
  earthquake: "Earthquake",
  landslide: "Landslide",
  tsunami: "Tsunami",
  high_waves: "High waves",
  avalanche: "Avalanche",
  fire: "Fire",
  other: "Other",
};

export function AlertCard({ alert, compact = false }: { alert: NormalizedAlert; compact?: boolean }) {
  const inactive = alert.freshness !== "ACTIVE";
  return (
    <article
      className={cn(
        "rounded-lg border bg-card p-4",
        !inactive && (alert.severity === "Extreme" || alert.severity === "Severe") && "border-l-4 border-l-danger",
        !inactive && alert.severity === "Moderate" && "border-l-4 border-l-warning",
        inactive && "opacity-70",
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <SeverityBadge severity={alert.severity} />
        <Badge>{HAZARD_LABEL[alert.hazard] ?? alert.hazard}</Badge>
        <FreshnessBadge freshness={alert.freshness} />
        {alert.relevance === "DISTRICT" ? <Badge tone="danger">Your district</Badge> : alert.relevance === "STATE" ? <Badge tone="outline">Your state</Badge> : null}
        {alert.partial ? <Badge tone="warning" title="Full CAP document could not be retrieved">Summary only</Badge> : null}
      </div>
      <h3 className="mt-2 text-sm font-medium leading-snug sm:text-base">{alert.headline}</h3>
      {!compact && alert.areaDesc ? (
        <p className="mt-1.5 flex gap-1 text-xs text-muted-foreground">
          <MapPin className="mt-0.5 size-3 shrink-0" aria-hidden />
          {alert.areaDesc}
        </p>
      ) : null}
      {!compact && alert.instruction ? (
        <p className="mt-2 rounded-md bg-muted px-3 py-2 text-sm">
          <span className="font-medium">Official instruction: </span>
          {alert.instruction}
        </p>
      ) : null}
      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
        <div>
          <dt className="inline">Issued by </dt>
          <dd className="inline font-medium text-foreground">{alert.issuer}</dd>
        </div>
        <div title={formatDateTime(alert.issuedAt)}>
          <dt className="inline">Issued </dt>
          <dd className="inline">{relativeTime(alert.issuedAt)}</dd>
        </div>
        <div>
          <dt className="inline">
            <Clock className="mr-1 inline size-3" aria-hidden />
            Expires{" "}
          </dt>
          <dd className="inline">{alert.expiresAt ? formatDateTime(alert.expiresAt) : "not stated"}</dd>
        </div>
      </dl>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <SourceLink href={alert.capUrl}>Official CAP record</SourceLink>
        <ListenButton text={[alert.headline, alert.instruction ? `Official instruction: ${alert.instruction}` : ""].filter(Boolean).join(". ")} />
        <span>Retrieved {relativeTime(alert.retrievedAt)}</span>
      </div>
    </article>
  );
}