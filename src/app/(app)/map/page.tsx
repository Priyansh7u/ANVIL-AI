"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, Flag, House, Loader2, LocateFixed, Navigation, Quote, Route, ShieldAlert, ShieldQuestion } from "lucide-react";
import { haversineKm } from "@/lib/core/geometry";
import { relativeTime } from "@/lib/core/freshness";
import { cn, formatDateTime } from "@/lib/utils";
import { apiFetch, placeQuery, useApi, type ApiError } from "@/hooks/use-api";
import { usePlace } from "@/hooks/use-local-state";
import type { ConfigResponse, HazardMapResponse } from "@/types/api";
import { SEVERITY_COLOR } from "@/types/api";
import { buildHazardLayers, HazardLegend } from "@/components/maps/hazard-layers";
import { MapView, type MapMarker } from "@/components/maps/map-view";
import { EmptyState, ErrorState, NeedsPlace, PageHeader, SourceLink } from "@/components/shared/status";
import { Badge, Button, Skeleton } from "@/components/ui/primitives";
import type { VerifiedRoadClosure } from "@/lib/core/types";

type Crossing = { alertId: string; atKm: number; headline: string; issuer: string; severity: keyof typeof SEVERITY_COLOR; expiresAt: string | null; capUrl: string; areaSource: string };

interface RouteAlternative {
  rank: number;
  distanceKm: number;
  durationMin: number;
  exposureKm: number;
  weightedExposure: number;
  path: [number, number][];
  provider: string;
  isProviderFastest: boolean;
  crossings: Crossing[];
}

interface RouteResponse {
  route: { distanceKm: number; durationMin: number; path: [number, number][]; provider: string };
  alternatives: RouteAlternative[];
  method: string;
  safetyVerified: false;
  crossings: { alertId: string; atKm: number; headline: string; issuer: string; severity: keyof typeof SEVERITY_COLOR; expiresAt: string | null; capUrl: string; areaSource: string }[];
  unmappedAlerts: { alertId: string; headline: string; issuer: string; capUrl: string }[];
  roadClosures: VerifiedRoadClosure[];
  warnings: string[];
  alertsRetrievedAt: string | null;
  researchFinishedAt: string | null;
  routedAt: string;
}

type Pt = { lat: number; lon: number; label: string };

export default function MapPage() {
  const [place] = usePlace();
  const config = useApi<ConfigResponse>("/api/config");
  const hm = useApi<HazardMapResponse>(place ? `/api/hazard-map?${placeQuery(place)}` : null, { refreshMs: 5 * 60_000 });
  const [mode, setMode] = useState<"origin" | "destination" | null>(null);
  const [origin, setOrigin] = useState<Pt | null>(null);
  const [destination, setDestination] = useState<Pt | null>(null);
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [selected, setSelected] = useState(0);
  const [routing, setRouting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const layers = useMemo(() => buildHazardLayers(hm.data, place), [hm.data, place]);
  const selAlt = route?.alternatives[selected] ?? route?.alternatives[0] ?? { distanceKm: route?.route.distanceKm ?? 0, durationMin: route?.route.durationMin ?? 0, crossings: route?.crossings ?? [] };
  const selCrossings = selAlt.crossings;
  const markers = useMemo<MapMarker[]>(() => {
    const m = [...layers.markers];
    if (origin) m.push({ id: "origin", ...origin, kind: "origin" });
    if (destination) m.push({ id: "dest", ...destination, kind: "destination" });
    return m;
  }, [layers.markers, origin, destination]);

  const mappedShelters = useMemo(() => {
    const list = (hm.data?.shelters ?? []).filter((s) => s.location?.precision === "GEOCODED_ADDRESS" && s.location.lat != null && s.location.lon != null);
    if (place?.lat == null || place.lon == null) return list.map((s) => ({ s, km: null as number | null }));
    return list
      .map((s) => ({ s, km: Math.round(haversineKm([place.lat as number, place.lon as number], [s.location!.lat as number, s.location!.lon as number]) * 10) / 10 }))
      .sort((a, b) => (a.km ?? 0) - (b.km ?? 0));
  }, [hm.data, place]);

  if (!place) {
    return (
      <>
        <PageHeader title="Hazard-aware routes & shelters" />
        <NeedsPlace what="The map" />
      </>
    );
  }

  const center: [number, number] = place.lat != null && place.lon != null ? [place.lat, place.lon] : [22.5, 79];

  const onMapClick = (lat: number, lon: number) => {
    const pt = { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4, label: mode === "origin" ? "Start" : "Destination" };
    if (mode === "origin") setOrigin(pt);
    if (mode === "destination") setDestination(pt);
    setMode(null);
    setRoute(null);
  };

  const plan = async (o = origin, d = destination) => {
    if (!o || !d) return;
    setRouting(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ fromLat: String(o.lat), fromLon: String(o.lon), toLat: String(d.lat), toLon: String(d.lon) });
      if (place.district) qs.set("district", place.district);
      if (place.state) qs.set("state", place.state);
      setRoute(await apiFetch<RouteResponse>(`/api/route?${qs}`));
      setSelected(0);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setRouting(false);
    }
  };

  const startFromMyArea = () => {
    if (place.lat == null || place.lon == null) return;
    const o = { lat: place.lat, lon: place.lon, label: "My area" };
    setOrigin(o);
    setRoute(null);
    return o;
  };

  const routeToShelter = (s: (typeof mappedShelters)[number]["s"]) => {
    const o = origin ?? startFromMyArea() ?? null;
    const d = { lat: s.location!.lat as number, lon: s.location!.lon as number, label: s.name };
    setDestination(d);
    if (o) void plan(o, d);
  };

  return (
    <>
      <PageHeader
        title="Hazard-aware routes & shelters"
        description="Live official alert areas, documented shelters and officially reported road closures on one map. Routes are checked against active alert areas — and never labelled safe."
      />

      {hm.error ? <div className="mb-4"><ErrorState message={hm.error.message} onRetry={hm.reload} /></div> : null}

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="space-y-3 lg:col-span-8">
          <div className="panel overflow-hidden">
            {config.data ? (
              <MapView
                center={center}
                areas={layers.areas}
                markers={markers}
                paths={(route?.alternatives ?? [])
                  .map((a, i) => ({
                    id: `alt-${i}`,
                    path: a.path,
                    color: i === selected ? (a.crossings.length ? "#f59e0b" : "#60a5fa") : "#64748b",
                    weight: i === selected ? 6 : 4,
                    dashed: i !== selected,
                    label: `${i === 0 ? "Lowest exposure" : `Alternative ${i + 1}`}: ${a.distanceKm} km, ~${a.durationMin} min, ${a.exposureKm} km in alert areas`,
                    onClick: () => setSelected(i),
                  }))
                  .sort((a, b) => (a.id === `alt-${selected}` ? 1 : 0) - (b.id === `alt-${selected}` ? 1 : 0))}
                tileUrl={config.data.map.tileUrl}
                attribution={config.data.map.attribution}
                onMapClick={mode ? onMapClick : undefined}
                className={cn("h-[380px] w-full sm:h-[520px]", mode && "cursor-crosshair")}
              />
            ) : (
              <Skeleton className="h-[520px] rounded-none" />
            )}
            <div className="space-y-1 border-t px-4 py-2">
              <HazardLegend data={hm.data} />
              <p className="text-[11px] text-muted-foreground">
                Alerts checked {hm.data?.feed.retrievedAt ? relativeTime(hm.data.feed.retrievedAt) : "—"} · shelters & closures verified {hm.data?.researchFinishedAt ? relativeTime(hm.data.researchFinishedAt) : "— (run the research agent)"}
              </p>
            </div>
          </div>

          {route && route.alternatives.length > 1 ? (
            <div className="panel p-4">
              <p className="label-caps mb-2">Route alternatives, ranked by exposure to live alert areas</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-left text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Route</th>
                      <th className="pr-3 font-medium">Distance</th>
                      <th className="pr-3 font-medium">Time</th>
                      <th className="pr-3 font-medium">In alert areas</th>
                      <th className="font-medium">Alert areas crossed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {route.alternatives.map((a, i) => (
                      <tr key={i} className={cn("cursor-pointer border-t hover:bg-muted", i === selected && "bg-muted")} onClick={() => setSelected(i)} aria-selected={i === selected}>
                        <td className="py-2 pr-3">
                          {i === 0 ? <Badge tone="ok">Lowest exposure</Badge> : `Alternative ${i + 1}`}
                          {a.isProviderFastest ? <span className="ml-1 text-xs text-muted-foreground">fastest</span> : null}
                        </td>
                        <td className="num pr-3">{a.distanceKm} km</td>
                        <td className="num pr-3">{a.durationMin} min</td>
                        <td className={cn("num pr-3", a.exposureKm > 0 ? "text-danger" : "text-ok")}>{a.exposureKm} km</td>
                        <td className="num">{a.crossings.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">{route.method} Lower exposure is not the same as safe.</p>
            </div>
          ) : null}

          {route ? (
            <div className={cn("panel p-4", selCrossings.length ? "panel-danger" : "panel-warning")}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="warning"><ShieldQuestion className="size-3" /> Safety not verified</Badge>
                <Badge><span className="num">{selAlt.distanceKm} km · ~{selAlt.durationMin} min</span></Badge>
                {selCrossings.length ? <Badge tone="danger"><ShieldAlert className="size-3" /> Enters {selCrossings.length} alert area(s)</Badge> : <Badge tone="ok">No mapped alert area on this route</Badge>}
              </div>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                {route.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
              {selCrossings.length ? (
                <ul className="mt-3 space-y-2">
                  {selCrossings.map((c) => (
                    <li key={c.alertId} className="rounded-md border bg-card/60 p-2 text-sm">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="inline-block size-2.5 rounded-full" style={{ background: SEVERITY_COLOR[c.severity] }} />
                        <strong>~{c.atKm} km:</strong> {c.issuer} — {c.severity}
                        <Badge>{c.areaSource === "CAP_POLYGON" ? "official area" : "district named (approx.)"}</Badge>
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{c.headline}</p>
                      <SourceLink href={c.capUrl}>Official CAP record</SourceLink>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-3 text-xs text-muted-foreground">
                Routed {formatDateTime(route.routedAt)} by {route.route.provider} (road network only). Alerts as of {formatDateTime(route.alertsRetrievedAt)}.
              </p>
            </div>
          ) : null}
        </div>

        <div className="space-y-4 lg:col-span-4">
          <div className="panel p-4">
            <p className="label-caps mb-2 flex items-center gap-1"><Route className="size-3.5" /> Plan a route</p>
            <div className="space-y-2">
              <div className="flex gap-2">
                <Button variant={mode === "origin" ? "default" : "outline"} className="flex-1 justify-start" onClick={() => setMode(mode === "origin" ? null : "origin")} aria-pressed={mode === "origin"}>
                  <Navigation /> {origin ? origin.label : "Start on map"}
                </Button>
                <Button variant="outline" size="icon" onClick={() => startFromMyArea()} aria-label="Start from my area" disabled={place.lat == null}>
                  <LocateFixed />
                </Button>
              </div>
              <Button variant={mode === "destination" ? "default" : "outline"} className="w-full justify-start" onClick={() => setMode(mode === "destination" ? null : "destination")} aria-pressed={mode === "destination"}>
                <Flag /> {destination ? destination.label : "Destination on map"}
              </Button>
              {mode ? <p className="text-xs text-primary">Tap the map to place the {mode === "origin" ? "start" : "destination"}.</p> : null}
              <Button className="w-full" onClick={() => plan()} disabled={!origin || !destination || routing}>
                {routing ? <Loader2 className="animate-spin" /> : <Route />} Check route against live alerts
              </Button>
              {error ? <ErrorState message={error} onRetry={() => plan()} /> : null}
            </div>
          </div>

          <div className="panel p-4">
            <p className="label-caps mb-2 flex items-center gap-1"><House className="size-3.5" /> Documented shelters</p>
            {hm.loading && !hm.data ? (
              <Skeleton className="h-24" />
            ) : !hm.data?.shelters.length ? (
              <EmptyState icon={House} title="No documented shelters yet">
                Run the <Link className="text-primary underline" href="/agent">research agent</Link> to find relief camps listed on official pages.
              </EmptyState>
            ) : (
              <ul className="max-h-80 space-y-2 overflow-auto text-sm">
                {mappedShelters.map(({ s, km }) => (
                  <li key={s.id} className="rounded-md border p-2">
                    <p className="font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {km != null ? `${km} km straight-line · ` : ""}verified {relativeTime(s.verification.evidence.retrievedAt)} · {s.capacity != null ? `capacity ${s.capacity} (published)` : "capacity not published"}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => routeToShelter(s)}>
                        <Route /> Route here
                      </Button>
                      <SourceLink href={s.verification.evidence.sourceUrl} />
                    </div>
                  </li>
                ))}
                {(hm.data.shelters.length - mappedShelters.length) > 0 ? (
                  <li className="text-xs text-muted-foreground">
                    {hm.data.shelters.length - mappedShelters.length} more documented shelter(s) have no map position — see the <Link className="text-primary underline" href="/shelters">shelter finder</Link>.
                  </li>
                ) : null}
              </ul>
            )}
          </div>

          <div className="panel p-4">
            <p className="label-caps mb-2 flex items-center gap-1"><AlertTriangle className="size-3.5" /> Official road closures</p>
            {!hm.data?.roadClosures.length ? (
              <p className="text-xs text-muted-foreground">
                No road closures found on official pages for this district{hm.data?.researchFinishedAt ? ` (checked ${relativeTime(hm.data.researchFinishedAt)})` : " — run the research agent to check"}. That does not mean roads are open.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {hm.data.roadClosures.map((r, i) => (
                  <li key={i} className="rounded-md border p-2">
                    <p><strong>{r.road}</strong> <Badge tone="warning">{r.status}</Badge></p>
                    <p className="mt-1 flex gap-1 text-xs text-muted-foreground"><Quote className="size-3 shrink-0" />{r.evidence.evidenceQuote}</p>
                    <p className="text-xs text-muted-foreground">Reported on an official page, verified {relativeTime(r.evidence.retrievedAt)} · text only, not mapped</p>
                    <SourceLink href={r.evidence.sourceUrl} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}