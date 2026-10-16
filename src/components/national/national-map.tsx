"use client";

import { useMemo } from "react";
import { HAZARD_LABEL } from "@/components/alerts/alert-card";
import { MapView, type MapCircle } from "@/components/maps/map-view";
import { Skeleton } from "@/components/ui/primitives";
import { useApi } from "@/hooks/use-api";
import { SEVERITY_COLOR, type ConfigResponse } from "@/types/api";
import type { NationalResponse } from "@/types/national";

/**
 * Live India situation map: one bubble per state with active official alerts.
 * Bubble area ∝ number of active alerts; colour = highest active severity.
 * Positions are the state's geographic centre (reference geography only).
 */
export function NationalMap({ data, className, interactive = true }: { data: NationalResponse | null; className?: string; interactive?: boolean }) {
  const config = useApi<ConfigResponse>("/api/config");
  const circles = useMemo<MapCircle[]>(
    () =>
      (data?.states ?? [])
        .filter((s) => s.active > 0)
        .map((s) => ({
          id: s.code,
          center: s.center,
          radiusKm: 28 + Math.sqrt(s.active) * 26,
          color: SEVERITY_COLOR[s.maxSeverity],
          fillOpacity: 0.35,
          dashed: false,
          label: `${s.name}: ${s.active} active alert${s.active === 1 ? "" : "s"}${s.escalation.escalating ? " — surging" : ""}`,
          detail: [
            `Highest severity: ${s.maxSeverity === "Unknown" ? "not stated" : s.maxSeverity}`,
            s.hazards.length ? `Hazards: ${s.hazards.map((h) => `${HAZARD_LABEL[h.hazard] ?? h.hazard} (${h.count})`).join(", ")}` : "",
            `Issued by: ${s.issuers.slice(0, 4).join(", ")}`,
            s.latest ? `Latest: ${s.latest.headline.slice(0, 120)}` : "",
          ]
            .filter(Boolean)
            .join(" · "),
        })),
    [data],
  );

  if (!config.data) return <Skeleton className={className ?? "h-[480px] w-full"} />;
  return (
    <MapView
      center={[22.8, 80.5]}
      zoom={interactive ? 5 : 4}
      circles={circles}
      tileUrl={config.data.map.tileUrl}
      attribution={config.data.map.attribution}
      fitToAreas={false}
      className={className ?? "h-[480px] w-full"}
    />
  );
}