"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, Building2, Construction, ExternalLink, Flame, HeartPulse, House, Loader2, LocateFixed, Navigation, Phone, Quote, RefreshCw, Shield, Stethoscope, Users } from "lucide-react";
import { FACILITY_LABEL, directionsUrl, type FacilityKind, type OsmFacility } from "@/lib/core/nearby";
import { pointInAny, type Polygon } from "@/lib/core/geometry";
import { relativeTime } from "@/lib/core/freshness";
import { cn, coarse, formatDateTime } from "@/lib/utils";
import { placeQuery, useApi } from "@/hooks/use-api";
import { usePlace } from "@/hooks/use-local-state";
import type { ConfigResponse, HazardMapResponse } from "@/types/api";
import { MapView, type MapCircle, type MapMarker } from "@/components/maps/map-view";
import { buildHazardLayers } from "@/components/maps/hazard-layers";
import { EmptyState, ErrorState, NeedsPlace, PageHeader, SourceLink } from "@/components/shared/status";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Select, Skeleton } from "@/components/ui/primitives";

interface OfficialShelter {
  id: string;
  name: string;
  address: string | null;
  district: string | null;
  lat: number | null;
  lon: number | null;
  distanceKm: number | null;
  capacity: number | null;
  operationalStatus: string | null;
  sourceUrl: string;
  evidenceQuote: string;
  verifiedAt: string;
  locationPrecision: "GEOCODED_ADDRESS" | "NONE";
}

interface NearbyResponse {
  radiusKm: number;
  facilities: OsmFacility[];
  osm: { status: "LIVE" | "STALE" | "UNAVAILABLE"; fetchedAt: string | null; cached: boolean; error: string | null; attribution: string; provenance: string };
  officialShelters: OfficialShelter[];
  officialNote: string;
}

const KINDS: { kind: FacilityKind; color: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { kind: "hospital", color: "#ef4444", icon: HeartPulse },
  { kind: "clinic", color: "#f472b6", icon: Stethoscope },
  { kind: "shelter", color: "#22c55e", icon: House },
  { kind: "assembly_point", color: "#a3e635", icon: Users },
  { kind: "fire_station", color: "#f97316", icon: Flame },
  { kind: "police", color: "#3b82f6", icon: Shield },
];
const KIND_META = Object.fromEntries(KINDS.map((k) => [k.kind, k])) as Record<FacilityKind, (typeof KINDS)[number]>;
const OFFICIAL_COLOR = "#2dd4bf";

const HELPLINES = [
  ["112", "Emergency (all services)"],
  ["108", "Ambulance"],
  ["101", "Fire"],
  ["100", "Police"],
  ["1078", "NDMA disaster helpline"],
] as const;

type Item =
  | { type: "official"; id: string; name: string; distanceKm: number | null; lat: number | null; lon: number | null; s: OfficialShelter }
  | { type: "osm"; id: string; name: string; distanceKm: number; lat: number; lon: number; f: OsmFacility };

export default function NearbyPage() {
  const [place] = usePlace();
  const config = useApi<ConfigResponse>("/api/config");
  const [point, setPoint] = useState<[number, number] | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [radius, setRadius] = useState(8);
  const [enabled, setEnabled] = useState<Set<FacilityKind>>(new Set(KINDS.map((k) => k.kind)));
  const [showOfficial, setShowOfficial] = useState(true);
  const [onlyPhone, setOnlyPhone] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const origin: [number, number] | null = point ?? (place?.lat != null && place.lon != null ? [place.lat, place.lon] : null);
  const kindsParam = Array.from(enabled).join(",");
  const url = origin && enabled.size
    ? `/api/nearby?lat=${origin[0]}&lon=${origin[1]}&radiusKm=${radius}&kinds=${kindsParam}${place ? `&${placeQuery(place)}` : ""}`
    : null;
  const { data, error, loading, reload } = useApi<NearbyResponse>(url, { refreshMs: 10 * 60_000 });
  const hm = useApi<HazardMapResponse>(place ? `/api/hazard-map?${placeQuery(place)}` : null, { refreshMs: 3 * 60_000 });
  const hazardLayers = useMemo(() => buildHazardLayers(hm.data, null), [hm.data]);
  const alertPolys: Polygon[] = useMemo(() => (hm.data?.hazards ?? []).filter((h) => h.areaSource === "CAP_POLYGON").flatMap((h) => h.polygons as Polygon[]), [hm.data]);

  const items: Item[] = useMemo(() => {
    const out: Item[] = [];
    if (showOfficial) for (const s of data?.officialShelters ?? []) out.push({ type: "official", id: `off-${s.id}`, name: s.name, distanceKm: s.distanceKm, lat: s.lat, lon: s.lon, s });
    for (const f of data?.facilities ?? []) if (enabled.has(f.kind)) out.push({ type: "osm", id: f.id, name: f.name, distanceKm: f.distanceKm, lat: f.lat, lon: f.lon, f });
    return out
      .filter((i) => !q || `${i.name} ${i.type === "osm" ? i.f.address ?? "" : i.s.address ?? ""}`.toLowerCase().includes(q.toLowerCase()))
      .filter((i) => !onlyPhone || (i.type === "osm" ? Boolean(i.f.phone) : false))
      .sort((a, b) => (a.type === "official" && b.type !== "official" ? -1 : b.type === "official" && a.type !== "official" ? 1 : (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9)));
  }, [data, enabled, showOfficial, q, onlyPhone]);

  const counts = useMemo(() => {
    const c: Partial<Record<FacilityKind, number>> = {};
    for (const f of data?.facilities ?? []) c[f.kind] = (c[f.kind] ?? 0) + 1;
    return c;
  }, [data]);

  const markers: MapMarker[] = useMemo(() => {
    const m: MapMarker[] = [];
    if (origin) m.push({ id: "origin", lat: origin[0], lon: origin[1], kind: "origin", label: point ? "Chosen point" : place?.label ?? "Your area", detail: "Search centre (~1 km precision)" });
    for (const i of items) {
      if (i.lat == null || i.lon == null) continue;
      if (i.type === "official") {
        m.push({ id: i.id, lat: i.lat, lon: i.lon, kind: "shelter", color: OFFICIAL_COLOR, highlight: selected === i.id, onClick: () => setSelected(i.id), label: i.name, detail: `Official page lists this shelter · retrieved ${relativeTime(i.s.verifiedAt)} · position geocoded from address (approx.) · availability not verified` });
      } else {
        m.push({ id: i.id, lat: i.lat, lon: i.lon, kind: "facility", color: KIND_META[i.f.kind].color, highlight: selected === i.id, onClick: () => setSelected(i.id), label: i.name, detail: `${FACILITY_LABEL[i.f.kind]} · ${i.distanceKm} km${i.f.phone ? ` · ${i.f.phone}` : ""} · OpenStreetMap, community-mapped` });
      }
    }
    return m;
  }, [items, origin, point, place, selected]);

  const circles: MapCircle[] = origin ? [{ id: "radius", center: origin, radiusKm: radius, color: "#60a5fa", label: `Search radius ${radius} km`, fillOpacity: 0.03 }] : [];

  const useGps = () => {
    setGeoErr(null);
    if (!("geolocation" in navigator)) return setGeoErr("Location is not supported in this browser. Click the map to choose a point.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPoint([coarse(pos.coords.latitude), coarse(pos.coords.longitude)]);
        setLocating(false);
      },
      (e) => {
        setLocating(false);
        setGeoErr(e.code === e.PERMISSION_DENIED ? "Location permission denied. Click the map to choose a point instead." : "Couldn't get your location. Click the map to choose a point.");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  };

  const toggle = (k: FacilityKind) =>
    setEnabled((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  if (!place && !point) {
    return (
      <>
        <PageHeader title="Nearby help" />
        <NeedsPlace what="Nearby help" />
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={useGps} disabled={locating}>
            {locating ? <Loader2 className="animate-spin" /> : <LocateFixed />} Use my approximate location instead
          </Button>
        </div>
        {geoErr ? <p className="mt-2 text-center text-sm text-danger">{geoErr}</p> : null}
      </>
    );
  }

  const inAlert = (lat: number | null, lon: number | null) => lat != null && lon != null && alertPolys.length > 0 && pointInAny([lat, lon], alertPolys);

  return (
    <>
      <PageHeader
        title="Nearby help"
        description="Hospitals, shelters, relief points, fire and police stations around you — each with its source, contact and when it was last verified or edited. Official documented shelters are listed first."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={useGps} disabled={locating}>
              {locating ? <Loader2 className="animate-spin" /> : <LocateFixed />} Use my location
            </Button>
            <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
              <RefreshCw className={cn(loading && "animate-spin")} /> Refresh
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-danger/40 bg-danger-soft p-2.5 text-sm">
        <Phone className="size-4 text-danger" aria-hidden />
        <span className="font-medium text-danger">National helplines:</span>
        {HELPLINES.map(([n, l]) => (
          <a key={n} href={`tel:${n}`} className="rounded-full border bg-background px-2.5 py-0.5 text-xs hover:bg-muted">
            <span className="num font-semibold">{n}</span> {l}
          </a>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3">
          <div className="relative overflow-hidden rounded-lg border">
            {config.data ? (
              <MapView
                center={origin ?? [22.5, 79]}
                zoom={12}
                markers={markers}
                areas={hazardLayers.areas}
                circles={circles}
                tileUrl={config.data.map.tileUrl}
                attribution={config.data.map.attribution}
                onMapClick={(la, lo) => setPoint([coarse(la), coarse(lo)])}
                className="h-[480px] w-full lg:h-[620px]"
              />
            ) : (
              <Skeleton className="h-[480px] w-full lg:h-[620px]" />
            )}
            {/* Legend, in the style of an emergency operations map */}
            <div className="pointer-events-auto absolute bottom-3 left-3 z-[500] max-w-[240px] rounded-md border bg-background/95 p-2.5 text-xs shadow-lg backdrop-blur">
              <p className="mb-1.5 font-semibold">Legend</p>
              <ul className="space-y-1">
                <li className="flex items-center gap-2">
                  <span className="inline-block size-3 rounded-full border-2 border-[#0b1220]" style={{ background: OFFICIAL_COLOR }} /> Shelter on official page ({data?.officialShelters.filter((s) => s.lat != null).length ?? 0})
                </li>
                {KINDS.map((k) => (
                  <li key={k.kind} className={cn("flex items-center gap-2", !enabled.has(k.kind) && "opacity-40")}>
                    <span className="inline-block size-3 rounded-full border-2 border-[#0b1220]" style={{ background: k.color }} /> {FACILITY_LABEL[k.kind]} ({counts[k.kind] ?? 0})
                  </li>
                ))}
                <li className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-4 rounded-sm bg-[#ef4444]/60" /> Official alert area
                </li>
                <li className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-4 rounded-sm border border-dashed border-[#f59e0b]" /> District named in alert
                </li>
              </ul>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Click anywhere on the map to search around that point. Locations are rounded to about 1 km and are not stored.</p>

          {hm.data ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="size-4 text-warning" /> Live hazards around this area
                </CardTitle>
                <CardDescription>
                  {hm.data.hazards.length} active official alert(s) from NDMA SACHET · retrieved {relativeTime(hm.data.feed.retrievedAt)}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {hm.data.hazards.slice(0, 4).map((h) => (
                  <div key={h.id} className="flex flex-wrap items-center gap-2">
                    <Badge tone={h.severity === "Extreme" || h.severity === "Severe" ? "danger" : "warning"}>{h.severity === "Unknown" ? "Severity not stated" : h.severity}</Badge>
                    <span className="min-w-0 flex-1">{h.headline}</span>
                    <SourceLink href={h.capUrl}>{h.issuer}</SourceLink>
                  </div>
                ))}
                {hm.data.roadClosures.length ? (
                  <div className="border-t pt-2">
                    <p className="mb-1 flex items-center gap-1 font-medium">
                      <Construction className="size-4" /> Road closures reported on official pages
                    </p>
                    <ul className="space-y-1">
                      {hm.data.roadClosures.slice(0, 6).map((r, i) => (
                        <li key={i} className="text-xs">
                          <span className="font-medium">{r.road}</span> — {r.status} · <SourceLink href={r.evidence.sourceUrl} /> · {relativeTime(r.evidence.retrievedAt)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No official road-closure information has been found for this district. That does not mean roads are open.</p>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="min-w-0 space-y-3">
          <Card>
            <CardContent className="space-y-3 pt-4 sm:pt-5">
              <div className="grid grid-cols-[1fr_120px] gap-2">
                <div className="space-y-1">
                  <Label htmlFor="nq">Search</Label>
                  <Input id="nq" placeholder="Name or address" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="nr">Radius</Label>
                  <Select id="nr" value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
                    {[2, 5, 8, 15, 25].map((r) => (
                      <option key={r} value={r}>
                        {r} km
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setShowOfficial((v) => !v)} className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", showOfficial ? "border-primary bg-primary/10 font-semibold" : "opacity-60")}>
                  <span className="inline-block size-2.5 rounded-full" style={{ background: OFFICIAL_COLOR }} /> Official shelters
                </button>
                {KINDS.map((k) => {
                  const Icon = k.icon;
                  return (
                    <button key={k.kind} type="button" onClick={() => toggle(k.kind)} aria-pressed={enabled.has(k.kind)} className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", enabled.has(k.kind) ? "border-primary bg-primary/10 font-semibold" : "opacity-60")}>
                      <Icon className="size-3.5" />
                      {FACILITY_LABEL[k.kind]} <span className="num">{counts[k.kind] ?? 0}</span>
                    </button>
                  );
                })}
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={onlyPhone} onChange={(e) => setOnlyPhone(e.target.checked)} /> Only places with a phone number
              </label>
              {data ? (
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge tone={data.osm.status === "LIVE" ? "ok" : data.osm.status === "STALE" ? "warning" : "danger"}>
                    OpenStreetMap {data.osm.status === "LIVE" ? "live" : data.osm.status === "STALE" ? "last good copy" : "unavailable"}
                  </Badge>
                  {data.osm.fetchedAt ? <span>queried {relativeTime(data.osm.fetchedAt)}{data.osm.cached ? " (shared 10-min cache)" : ""}</span> : null}
                  {data.osm.error ? <span className="text-danger">· {data.osm.error}</span> : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <div className="rounded-lg border border-warning/50 bg-warning-soft p-2.5 text-xs text-warning">
            {data?.osm.provenance || "OpenStreetMap entries are community-mapped and not officially verified."} Call ahead when you can: availability, capacity and safety change quickly in an emergency.
          </div>

          {error ? <ErrorState message={error.message} onRetry={reload} /> : null}
          {loading && !data ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : null}
          {data && !items.length ? (
            <EmptyState icon={Building2} title="Nothing found in this radius">
              Try a larger radius or other categories. Missing places may simply not be mapped in OpenStreetMap yet.{" "}
              <Link className="text-primary underline" href="/agent">
                Research official shelters
              </Link>
            </EmptyState>
          ) : null}

          <ul className="max-h-[900px] space-y-2 overflow-y-auto pr-1">
            {items.map((i) => (
              <li key={i.id}>
                {i.type === "official" ? (
                  <OfficialCard s={i.s} origin={origin} selected={selected === i.id} onSelect={() => setSelected(i.id)} inAlert={inAlert(i.lat, i.lon)} />
                ) : (
                  <OsmCard f={i.f} origin={origin} selected={selected === i.id} onSelect={() => setSelected(i.id)} inAlert={inAlert(i.lat, i.lon)} />
                )}
              </li>
            ))}
          </ul>
          {data ? <p className="text-[11px] text-muted-foreground">{data.osm.attribution}</p> : null}
        </div>
      </div>
    </>
  );
}

function AlertFlag() {
  return (
    <Badge tone="danger">
      <AlertTriangle className="size-3" /> Inside an active alert area
    </Badge>
  );
}

function OfficialCard({ s, origin, selected, onSelect, inAlert }: { s: OfficialShelter; origin: [number, number] | null; selected: boolean; onSelect: () => void; inAlert: boolean }) {
  return (
    <article onClick={onSelect} className={cn("cursor-pointer rounded-lg border-l-4 border bg-card p-3 text-sm transition-colors", selected ? "border-primary ring-1 ring-primary" : "hover:bg-muted/40")} style={{ borderLeftColor: OFFICIAL_COLOR }}>
      <div className="flex items-start gap-2">
        <House className="mt-0.5 size-4 shrink-0" style={{ color: OFFICIAL_COLOR }} />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold leading-snug">{s.name}</h3>
          <p className="text-xs text-muted-foreground">{s.address ?? "Address not stated on the source"}</p>
        </div>
        {s.distanceKm != null ? <span className="num shrink-0 text-sm font-semibold">{s.distanceKm} km</span> : <span className="shrink-0 text-xs text-muted-foreground">Not mapped</span>}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge tone="ok">Listed on official page</Badge>
        {s.capacity ? <Badge tone="outline">Capacity {s.capacity} (as stated)</Badge> : null}
        {s.operationalStatus ? <Badge tone="outline">Status on page: {s.operationalStatus}</Badge> : <Badge tone="neutral">Open/closed not stated</Badge>}
        {inAlert ? <AlertFlag /> : null}
      </div>
      {s.evidenceQuote ? (
        <blockquote className="mt-2 flex gap-1.5 rounded bg-muted/60 p-1.5 text-xs italic">
          <Quote className="size-3 shrink-0" /> {s.evidenceQuote}
        </blockquote>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          Source: <SourceLink href={s.sourceUrl} />
        </span>
        <span>Last verified: {formatDateTime(s.verifiedAt)} ({relativeTime(s.verifiedAt)})</span>
        {origin && s.lat != null && s.lon != null ? (
          <a href={directionsUrl(origin, [s.lat, s.lon])} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
            <Navigation className="size-3" /> Directions
          </a>
        ) : null}
      </div>
    </article>
  );
}

function OsmCard({ f, origin, selected, onSelect, inAlert }: { f: OsmFacility; origin: [number, number] | null; selected: boolean; onSelect: () => void; inAlert: boolean }) {
  const meta = KIND_META[f.kind];
  const Icon = meta.icon;
  return (
    <article onClick={onSelect} className={cn("cursor-pointer rounded-lg border bg-card p-3 text-sm transition-colors", selected ? "border-primary ring-1 ring-primary" : "hover:bg-muted/40")}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0" style={{ color: meta.color }} />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold leading-snug">{f.name}</h3>
          <p className="text-xs text-muted-foreground">
            {FACILITY_LABEL[f.kind]}
            {f.address ? ` · ${f.address}` : ""}
          </p>
        </div>
        <span className="num shrink-0 text-sm font-semibold">{f.distanceKm} km</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge tone="neutral">Community-mapped (OSM)</Badge>
        {f.emergencyDept ? <Badge tone="outline">Emergency department (per map)</Badge> : null}
        {f.beds ? <Badge tone="outline">{f.beds} beds (per map)</Badge> : null}
        {inAlert ? <AlertFlag /> : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {f.phone ? (
          <a href={`tel:${f.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
            <Phone className="size-3" /> {f.phone}
          </a>
        ) : (
          <span className="text-muted-foreground">No phone on the map</span>
        )}
        {origin ? (
          <a href={directionsUrl(origin, [f.lat, f.lon])} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
            <Navigation className="size-3" /> Directions
          </a>
        ) : null}
        {f.website && /^https?:\/\//.test(f.website) ? (
          <a href={f.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
            <ExternalLink className="size-3" /> Website
          </a>
        ) : null}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Source:{" "}
        <a href={f.osmUrl} target="_blank" rel="noopener noreferrer" className="underline" onClick={(e) => e.stopPropagation()}>
          OpenStreetMap {f.id}
        </a>{" "}
        · Last edited {f.lastEditedAt ? `${formatDateTime(f.lastEditedAt)} (${relativeTime(f.lastEditedAt)})` : "unknown"}
      </p>
    </article>
  );
}