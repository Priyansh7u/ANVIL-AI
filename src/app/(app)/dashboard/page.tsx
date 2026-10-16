"use client";

import Link from "next/link";
import { Bot, BellRing, House, Map as MapIcon, Phone, RefreshCw, Route } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/utils";
import { placeQuery, useApi } from "@/hooks/use-api";
import { usePlace } from "@/hooks/use-local-state";
import type { AlertsResponse, ConfigResponse, HazardMapResponse, ResearchTaskDto } from "@/types/api";
import { AlertCard } from "@/components/alerts/alert-card";
import { ActionCenter } from "@/components/dashboard/action-center";
import { IntelligencePanel } from "@/components/dashboard/intelligence-panel";
import { AlertTimeline } from "@/components/dashboard/alert-timeline";
import { CommandStrip } from "@/components/dashboard/command-strip";
import { buildHazardLayers, HazardLegend } from "@/components/maps/hazard-layers";
import { MapView } from "@/components/maps/map-view";
import { EmptyState, ErrorState, NeedsPlace, PageHeader, SourceLink } from "@/components/shared/status";
import { Button, buttonVariants, Skeleton } from "@/components/ui/primitives";

const REFRESH_MS = 5 * 60_000;

export default function DashboardPage() {
  const [place] = usePlace();
  const q = placeQuery(place);
  const alerts = useApi<AlertsResponse>(place ? `/api/alerts?${q}&scope=local` : null, { refreshMs: REFRESH_MS });
  const hazardMap = useApi<HazardMapResponse>(place ? `/api/hazard-map?${q}` : null, { refreshMs: REFRESH_MS });
  const config = useApi<ConfigResponse>("/api/config");
  const research = useApi<{ tasks: Pick<ResearchTaskDto, "id" | "status" | "createdAt" | "finishedAt">[] }>(place ? `/api/research?${q}` : null);

  if (!place) {
    return (
      <>
        <PageHeader title="Command center" />
        <NeedsPlace what="The command center" />
      </>
    );
  }

  const all = alerts.data?.alerts ?? [];
  const active = all.filter((a) => a.freshness === "ACTIVE");
  const local = active.filter((a) => a.relevance === "DISTRICT");
  const { areas, markers } = buildHazardLayers(hazardMap.data, place);
  const center: [number, number] = place.lat != null && place.lon != null ? [place.lat, place.lon] : [22.5, 79];
  const lastTask = research.data?.tasks[0];
  const shelterCount = hazardMap.data?.shelters.length ?? 0;
  const closures = hazardMap.data?.roadClosures.length ?? 0;

  const refreshAll = () => {
    alerts.reload();
    hazardMap.reload();
  };

  return (
    <>
      <CommandStrip
        placeLabel={place.label}
        dataMode={alerts.data?.dataMode ?? null}
        retrievedAt={alerts.data?.retrievedAt ?? null}
        stats={[
          { label: "District alerts", value: alerts.data ? local.length : "–", tone: local.length ? "danger" : "ok" },
          { label: "State alerts", value: alerts.data ? active.length - local.length : "–", tone: active.length - local.length ? "warning" : undefined },
          { label: "Shelters (docs)", value: hazardMap.data ? shelterCount : "–" },
          { label: "Road closures", value: hazardMap.data ? closures : "–", tone: closures ? "warning" : undefined },
        ]}
      />

      {alerts.error ? <div className="mb-4"><ErrorState message={alerts.error.message} onRetry={alerts.reload} /></div> : null}

      <div className="grid gap-4 lg:grid-cols-12">
        {/* LEFT — decisions */}
        <div className="space-y-4 lg:col-span-4 xl:col-span-3">
          <IntelligencePanel place={place} />
          <ActionCenter place={place} compact />
          <a href="tel:112" className={cn(buttonVariants({ variant: "danger", size: "lg" }), "w-full text-lg lg:hidden")}>
            <Phone /> Call 112
          </a>
        </div>

        {/* CENTER — live map + timeline */}
        <div className="space-y-4 lg:col-span-8 xl:col-span-6">
          <div className="panel overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
              <p className="label-caps flex items-center gap-2"><MapIcon className="size-3.5" /> Live hazard map</p>
              <div className="flex items-center gap-2">
                <Link href="/map" className="text-xs text-primary underline">Routes & shelters</Link>
                <Button size="icon" variant="ghost" onClick={refreshAll} aria-label="Refresh live data" disabled={alerts.loading || hazardMap.loading}>
                  <RefreshCw className={cn((alerts.loading || hazardMap.loading) && "animate-spin")} />
                </Button>
              </div>
            </div>
            {config.data ? (
              <MapView center={center} areas={areas} markers={markers} tileUrl={config.data.map.tileUrl} attribution={config.data.map.attribution} className="h-[360px] w-full sm:h-[440px]" />
            ) : (
              <Skeleton className="h-[440px] rounded-none" />
            )}
            <div className="border-t px-4 py-2">
              <HazardLegend data={hazardMap.data} />
            </div>
          </div>

          <div className="panel p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="label-caps">Alert validity timeline · last 12 h → next 12 h</p>
              {alerts.data ? <SourceLink href={alerts.data.sourceUrl}>NDMA SACHET</SourceLink> : null}
            </div>
            {alerts.data ? <AlertTimeline alerts={all} /> : <Skeleton className="h-24" />}
          </div>
        </div>

        {/* RIGHT — live alerts stack */}
        <div className="space-y-4 lg:col-span-12 xl:col-span-3">
          <div className="panel p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="label-caps">Live official alerts</p>
              <Link href="/alerts" className="text-xs text-primary underline">All</Link>
            </div>
            <div className="space-y-2">
              {alerts.loading && !alerts.data ? (
                <>
                  <Skeleton className="h-24" />
                  <Skeleton className="h-24" />
                </>
              ) : active.length === 0 ? (
                <EmptyState title={alerts.data?.dataMode === "UNAVAILABLE" ? "Feed unavailable" : "No active alerts"}>
                  {alerts.data?.dataMode === "UNAVAILABLE"
                    ? "This does NOT mean there are no warnings. Check sachet.ndma.gov.in."
                    : "No current official alert names your district or state."}
                </EmptyState>
              ) : (
                active.slice(0, 4).map((a) => <AlertCard key={a.id} alert={a} compact />)
              )}
            </div>
          </div>

          <div className="panel p-4 text-sm">
            <p className="label-caps mb-2">Intelligence</p>
            <ul className="space-y-2">
              <li className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2"><Bot className="size-4 text-primary" /> Research</span>
                <span className="text-xs text-muted-foreground">{lastTask ? `${lastTask.status} · ${formatDateTime(lastTask.finishedAt ?? lastTask.createdAt)}` : "not run yet"}</span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2"><House className="size-4 text-ok" /> Shelters</span>
                <span className="num text-xs">{shelterCount} documented</span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2"><Route className="size-4 text-warning" /> Road closures</span>
                <span className="num text-xs">{closures} verified</span>
              </li>
            </ul>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Link href="/agent" className={cn(buttonVariants({ size: "sm", variant: "outline" }))}><Bot /> Research</Link>
              <Link href="/watch" className={cn(buttonVariants({ size: "sm", variant: "outline" }))}><BellRing /> Smart alerts</Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}