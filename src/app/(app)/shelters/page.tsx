"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Accessibility, AlertTriangle, Bot, Compass, House, List, Loader2, Map as MapIcon, MessageCircle, Navigation, Quote, Route, Users } from "lucide-react";
import { relativeTime } from "@/lib/core/freshness";
import { haversineKm, pointInAny, type LatLon } from "@/lib/core/geometry";
import { cn } from "@/lib/utils";
import { apiFetch, placeQuery, useApi, type ApiError } from "@/hooks/use-api";
import { usePlace } from "@/hooks/use-local-state";
import { SEVERITY_COLOR, type ConfigResponse, type ShelterDto } from "@/types/api";
import { MapView, type MapArea, type MapMarker, type MapPath } from "@/components/maps/map-view";
import { DataModeBadge, EmptyState, ErrorState, NeedsPlace, PageHeader, SourceLink, StorageNotice } from "@/components/shared/status";
import { Tabs, tabPanelProps } from "@/components/shared/tabs";
import { Badge, Button, buttonVariants, Input, Label, Select, Skeleton } from "@/components/ui/primitives";
import type { DataMode } from "@/lib/core/types";

interface HazardLayer {
  id: string;
  headline: string;
  issuer: string;
  hazard: string;
  severity: keyof typeof SEVERITY_COLOR;
  expiresAt: string | null;
  capUrl: string;
  areaSource: "CAP_POLYGON" | "DISTRICT_BOUNDARY" | "NOT_MAPPED";
  polygons: LatLon[][];
}

interface HazardMapResponse {
  feed: { dataMode: DataMode; retrievedAt: string | null };
  hazards: HazardLayer[];
  shelters: ShelterDto[];
  storage: string;
}

interface RouteResult {
  route: { distanceKm: number; durationMin: number; path: LatLon[] };
  crossings: { alertId: string; headline: string; severity: string; atKm: number }[];
  warnings: string[];
}

interface Enriched extends ShelterDto {
  pos: LatLon | null;
  km: number | null;
  inAlert: HazardLayer[];
}

type SortKey = "near" | "capacity" | "name";

export default function SheltersPage() {
  const [place] = usePlace();
  const config = useApi<ConfigResponse>("/api/config");
  const { data, error, loading, reload } = useApi<HazardMapResponse>(place ? `/api/hazard-map?${placeQuery(place)}` : null, { refreshMs: 3 * 60_000 });
  const [filter, setFilter] = useState("");
  const [onlyAccessible, setOnlyAccessible] = useState(false);
  const [onlyMapped, setOnlyMapped] = useState(false);
  const [avoidAlerts, setAvoidAlerts] = useState(false);
  const [sort, setSort] = useState<SortKey>("near");
  const [view, setView] = useState<"list" | "map">("list");
  const [selected, setSelected] = useState<string | null>(null);
  const [route, setRoute] = useState<{ id: string; data: RouteResult } | null>(null);
  const [routing, setRouting] = useState<string | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);

  const origin: LatLon | null = place?.lat != null && place?.lon != null ? [place.lat, place.lon] : null;
  const mappedAlerts = useMemo(() => (data?.hazards ?? []).filter((h) => h.areaSource === "CAP_POLYGON" && h.polygons.length), [data]);
  const districtAlerts = useMemo(() => (data?.hazards ?? []).filter((h) => h.areaSource === "DISTRICT_BOUNDARY"), [data]);

  const all = useMemo<Enriched[]>(
    () =>
      (data?.shelters ?? []).map((s) => {
        const pos: LatLon | null = s.location?.precision === "GEOCODED_ADDRESS" && typeof s.location.lat === "number" && typeof s.location.lon === "number" ? [s.location.lat, s.location.lon] : null;
        return {
          ...s,
          pos,
          km: pos && origin ? Math.round(haversineKm(origin, pos) * 10) / 10 : null,
          inAlert: pos ? mappedAlerts.filter((h) => pointInAny(pos, h.polygons)) : [],
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- origin is derived from place
    [data, mappedAlerts, place?.lat, place?.lon],
  );

  const list = useMemo(() => {
    const out = all.filter(
      (s) =>
        (!filter || `${s.name} ${s.address ?? ""}`.toLowerCase().includes(filter.toLowerCase())) &&
        (!onlyAccessible || Boolean(s.accessibility)) &&
        (!onlyMapped || s.pos) &&
        (!avoidAlerts || s.inAlert.length === 0),
    );
    const far = Number.POSITIVE_INFINITY;
    return out.sort((a, b) => (sort === "near" ? (a.km ?? far) - (b.km ?? far) : sort === "capacity" ? (b.capacity ?? -1) - (a.capacity ?? -1) : a.name.localeCompare(b.name)));
  }, [all, filter, onlyAccessible, onlyMapped, avoidAlerts, sort]);

  const nearestSafe = useMemo(() => all.filter((s) => s.km != null && s.inAlert.length === 0).sort((a, b) => (a.km as number) - (b.km as number))[0] ?? null, [all]);
  const stats = useMemo(
    () => ({
      total: all.length,
      mapped: all.filter((s) => s.pos).length,
      capacity: all.reduce((n, s) => n + (s.capacity ?? 0), 0),
      withCapacity: all.filter((s) => s.capacity != null).length,
      inAlert: all.filter((s) => s.inAlert.length).length,
    }),
    [all],
  );

  const planRoute = async (s: Enriched) => {
    if (!origin || !s.pos || !place) return;
    setRouting(s.id);
    setRouteError(null);
    try {
      const q = new URLSearchParams({ fromLat: String(origin[0]), fromLon: String(origin[1]), toLat: String(s.pos[0]), toLon: String(s.pos[1]) });
      if (place.district) q.set("district", place.district);
      if (place.state) q.set("state", place.state);
      const r = await apiFetch<RouteResult>(`/api/route?${q.toString()}`, { timeoutMs: 30_000 });
      setRoute({ id: s.id, data: r });
      setSelected(s.id);
      setView("map");
    } catch (e) {
      setRouteError((e as ApiError).message);
    } finally {
      setRouting(null);
    }
  };

  const markers = useMemo<MapMarker[]>(() => {
    const m: MapMarker[] = list
      .filter((s) => s.pos)
      .map((s) => ({
        id: s.id,
        lat: (s.pos as LatLon)[0],
        lon: (s.pos as LatLon)[1],
        kind: s.inAlert.length ? "closed" : "shelter",
        highlight: s.id === selected,
        label: s.name,
        detail: `${s.km != null ? `${s.km} km away (straight line)` : ""}${s.inAlert.length ? " · inside an active alert area" : ""}`,
        onClick: () => setSelected(s.id),
      }));
    if (origin) m.push({ id: "me", lat: origin[0], lon: origin[1], kind: "place", label: "Your area" });
    return m;
  }, [list, selected, origin]);
  const areas = useMemo<MapArea[]>(
    () => mappedAlerts.map((h) => ({ id: h.id, polygons: h.polygons, color: SEVERITY_COLOR[h.severity] ?? "#f59e0b", label: h.headline, detail: `${h.issuer} · ${h.severity}`, fillOpacity: 0.18, pulse: h.severity === "Extreme" || h.severity === "Severe" })),
    [mappedAlerts],
  );
  const paths = useMemo<MapPath[]>(() => (route ? [{ id: "route", path: route.data.route.path, color: "#60a5fa", weight: 5, label: "Lowest-exposure road route" }] : []), [route]);

  if (!place) {
    return (
      <>
        <PageHeader title="Verified shelter finder" />
        <NeedsPlace what="The shelter finder" />
      </>
    );
  }

  const share = (s: Enriched) => {
    const lines = [
      `Shelter listed on an official page: ${s.name}`,
      s.address ?? "",
      s.pos ? `Map: https://www.google.com/maps/search/?api=1&query=${s.pos[0]},${s.pos[1]}` : "",
      `Source: ${s.verification.evidence.sourceUrl}`,
      "Availability is not verified — confirm with the district control room. Emergency: 112",
    ];
    return `https://wa.me/?text=${encodeURIComponent(lines.filter(Boolean).join("\n"))}`;
  };

  return (
    <>
      <PageHeader
        title="Verified shelter finder"
        description="Relief camps that an official government page lists for your district, with the exact quote and link — now with distance, live alert-area checks and the lowest-exposure road route."
        actions={
          <>
            <Link href="/nearby" className={cn(buttonVariants({ size: "sm", variant: "outline" }))}>
              <House /> Nearby help
            </Link>
            <Link href="/agent" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              <Bot /> Research this area
            </Link>
          </>
        }
      />

      {/* Live summary */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { k: "Documented shelters", v: data ? String(stats.total) : null, icon: House },
          { k: "With a map position", v: data ? String(stats.mapped) : null, icon: MapIcon },
          { k: "Published capacity", v: data ? (stats.withCapacity ? stats.capacity.toLocaleString("en-IN") : "Not published") : null, icon: Users },
          { k: "Inside an alert area", v: data ? String(stats.inAlert) : null, icon: AlertTriangle, danger: stats.inAlert > 0 },
        ].map(({ k, v, icon: Icon, danger }) => (
          <div key={k} className={cn("panel p-3", danger && "panel-danger")}>
            <p className="label-caps flex items-center gap-1.5"><Icon className="size-3.5" aria-hidden />{k}</p>
            {v == null ? <Skeleton className="mt-1 h-7 w-16" /> : <p className="num text-2xl">{v}</p>}
          </div>
        ))}
      </div>

      {nearestSafe ? (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="panel panel-ok mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <Compass className="size-8 shrink-0 text-ok" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="label-caps">Nearest documented shelter outside mapped alert areas</p>
            <p className="font-semibold">{nearestSafe.name}</p>
            <p className="text-sm text-muted-foreground">~{nearestSafe.km} km straight-line{nearestSafe.address ? ` · ${nearestSafe.address}` : ""}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void planRoute(nearestSafe)} disabled={!!routing}>
              {routing === nearestSafe.id ? <Loader2 className="animate-spin" /> : <Route />} Lowest-exposure route
            </Button>
          </div>
        </motion.div>
      ) : null}

      {districtAlerts.length ? (
        <div className="mb-4 rounded-lg border border-danger/50 bg-danger-soft p-3 text-sm text-danger" role="status">
          {districtAlerts.length} active alert{districtAlerts.length === 1 ? "" : "s"} cover{districtAlerts.length === 1 ? "s" : ""} your whole district ({districtAlerts.map((h) => h.headline).slice(0, 2).join("; ")}). Follow official evacuation instructions first.
        </div>
      ) : null}
      <div className="mb-4 rounded-lg border border-warning/50 bg-warning-soft p-3 text-sm text-warning">
        Availability, capacity and safety change quickly during an emergency. Always confirm with the district control room or follow evacuation instructions from officials.
      </div>

      <div className="mb-4 grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_auto_auto_auto] lg:items-end">
        <div className="space-y-1">
          <Label htmlFor="sf">Filter by name or address</Label>
          <Input id="sf" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="e.g. school" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sort">Sort by</Label>
          <Select id="sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="near" disabled={!origin}>Nearest first</option>
            <option value="capacity">Largest published capacity</option>
            <option value="name">Name</option>
          </Select>
        </div>
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={avoidAlerts} onChange={(e) => setAvoidAlerts(e.target.checked)} />
          Outside alert areas
        </label>
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={onlyAccessible} onChange={(e) => setOnlyAccessible(e.target.checked)} />
          Accessibility documented
        </label>
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={onlyMapped} onChange={(e) => setOnlyMapped(e.target.checked)} />
          Has map position
        </label>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Tabs<"list" | "map">
          label="Shelter view"
          value={view}
          onChange={setView}
          items={[
            { id: "list", label: `List (${list.length})`, icon: List },
            { id: "map", label: "Map", icon: MapIcon },
          ]}
        />
        {data ? <DataModeBadge mode={data.feed.dataMode} at={data.feed.retrievedAt} /> : null}
      </div>

      {error ? <ErrorState message={error.message} onRetry={reload} /> : null}
      {routeError ? <ErrorState message={`Route: ${routeError}`} /> : null}

      <div {...tabPanelProps(view)}>
        {view === "map" ? (
          <div className="space-y-3">
            <div className="panel overflow-hidden">
              {config.data && (origin || markers.length) ? (
                <MapView
                  center={origin ?? [markers[0]!.lat, markers[0]!.lon]}
                  zoom={11}
                  markers={markers}
                  areas={areas}
                  paths={paths}
                  tileUrl={config.data.map.tileUrl}
                  attribution={config.data.map.attribution}
                  className="h-[460px] w-full"
                  fitToAreas={!route}
                />
              ) : (
                <Skeleton className="h-[460px] rounded-none" />
              )}
            </div>
            {route ? (
              <div className="panel p-4 text-sm">
                <p className="font-semibold">
                  Route to {all.find((s) => s.id === route.id)?.name}: <span className="num">{route.data.route.distanceKm} km · ~{route.data.route.durationMin} min</span>
                </p>
                {route.data.crossings.length ? (
                  <p className="mt-1 text-danger">Enters {route.data.crossings.length} active alert area(s), first after ~{route.data.crossings[0]!.atKm} km.</p>
                ) : (
                  <p className="mt-1 text-ok">Does not cross any mapped alert area.</p>
                )}
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                  {route.data.warnings.map((w) => <li key={w}>{w}</li>)}
                </ul>
              </div>
            ) : null}
          </div>
        ) : loading && !data ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
        ) : list.length === 0 ? (
          <EmptyState icon={House} title={all.length ? "No shelters match these filters" : "No documented shelters yet for this area"}>
            {all.length ? null : (
              <>
                Run the <Link href="/agent" className="text-primary underline">research agent</Link> to look for relief camps on official district and SDMA pages. If none are published, ANVIL will say so rather than guess.
              </>
            )}
          </EmptyState>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            <AnimatePresence initial={false}>
              {list.map((s, i) => (
                <motion.li
                  key={s.id}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 8) * 0.03 } }}
                  exit={{ opacity: 0, scale: 0.98 }}
                >
                  <article className={cn("h-full rounded-lg border bg-card p-4 shadow-sm sm:p-5", s.id === selected && "ring-2 ring-primary", s.inAlert.length && "border-danger/50")}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="ok">Listed on official page</Badge>
                      {s.km != null ? <Badge tone="outline" className="num">{s.km} km</Badge> : null}
                      {s.pos ? <Badge>Mapped (approx.)</Badge> : <Badge>No map position</Badge>}
                      {s.inAlert.length ? (
                        <Badge tone="danger"><AlertTriangle className="size-3" aria-hidden /> Inside {s.inAlert[0]!.severity.toLowerCase()} alert area</Badge>
                      ) : null}
                    </div>
                    <h2 className="mt-2 font-semibold">{s.name}</h2>
                    {s.address ? <p className="text-sm text-muted-foreground">{s.address}</p> : null}
                    <dl className="mt-2 grid grid-cols-2 gap-1 text-xs">
                      <dt className="text-muted-foreground">Capacity</dt>
                      <dd>{s.capacity != null ? `${s.capacity} (as published)` : "Not published"}</dd>
                      <dt className="text-muted-foreground">Status</dt>
                      <dd>{s.operationalStatus ?? "Not published — unverified"}</dd>
                      <dt className="text-muted-foreground"><Accessibility className="mr-1 inline size-3" aria-hidden />Accessibility</dt>
                      <dd>{s.accessibility ?? "Not documented"}</dd>
                    </dl>
                    <blockquote className="mt-2 flex gap-2 rounded-md bg-muted p-2 text-xs">
                      <Quote className="size-3 shrink-0" aria-hidden />
                      <span>{s.verification.evidence.evidenceQuote}</span>
                    </blockquote>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <SourceLink href={s.verification.evidence.sourceUrl} />
                      <span>Verified against page {relativeTime(s.verification.evidence.retrievedAt)}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" disabled={!s.pos || !origin || !!routing} onClick={() => void planRoute(s)}>
                        {routing === s.id ? <Loader2 className="animate-spin" /> : <Route />} Lowest-exposure route
                      </Button>
                      {s.pos ? (
                        <a className={cn(buttonVariants({ size: "sm", variant: "ghost" }))} href={`https://www.google.com/maps/dir/?api=1&destination=${s.pos[0]},${s.pos[1]}`} target="_blank" rel="noopener noreferrer">
                          <Navigation /> Directions
                        </a>
                      ) : null}
                      <a className={cn(buttonVariants({ size: "sm", variant: "ghost" }))} href={share(s)} target="_blank" rel="noopener noreferrer">
                        <MessageCircle /> Share
                      </a>
                    </div>
                  </article>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
      <div className="mt-4">
        <StorageNotice storage={data?.storage} />
      </div>
    </>
  );
}