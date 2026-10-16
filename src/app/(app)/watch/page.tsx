"use client";

import { useEffect, useMemo, useState } from "react";
import { BellRing, Loader2, MapPin, Plus, Search, Trash2 } from "lucide-react";
import { matchWatchArea, type WatchArea } from "@/lib/core/geofence";
import { relativeTime } from "@/lib/core/freshness";
import type { CapSeverity } from "@/lib/core/types";
import { cn } from "@/lib/utils";
import { apiFetch, placeQuery, useApi, type ApiError } from "@/hooks/use-api";
import { getOrCreateClientId, usePlace, usePrefs } from "@/hooks/use-local-state";
import { useWatchAreas } from "@/hooks/use-watch-areas";
import { SEVERITY_COLOR, type ConfigResponse, type HazardDto, type HazardMapResponse } from "@/types/api";
import { MapView } from "@/components/maps/map-view";
import { EmptyState, ErrorState, PageHeader, SourceLink } from "@/components/shared/status";
import { Badge, Button, Input, Label, Select, Skeleton } from "@/components/ui/primitives";

interface Resolved {
  label: string;
  district: string | null;
  state: string | null;
  lat: number;
  lon: number;
}

const REASON: Record<string, string> = {
  INSIDE_ALERT_AREA: "Inside official alert area",
  DISTRICT_NAMED: "District named in alert",
  STATE_LEVEL: "State-level alert",
};

function AreaCard({ area, tile, onRemove }: { area: WatchArea; tile: ConfigResponse["map"] | undefined; onRemove: () => void }) {
  const { data, error, loading, reload } = useApi<HazardMapResponse>(`/api/hazard-map?${placeQuery(area)}`, { refreshMs: 5 * 60_000 });
  const matches = useMemo(() => (data ? matchWatchArea<HazardDto>(area, data.hazards) : []), [data, area]);
  const areas = matches
    .filter((m) => m.hazard.polygons.length)
    .map((m) => ({ id: m.hazard.id, polygons: m.hazard.polygons, color: SEVERITY_COLOR[m.hazard.severity], label: `${m.hazard.issuer}: ${m.hazard.severity}`, pulse: true, dashed: m.hazard.areaSource === "DISTRICT_BOUNDARY" }));
  const center: [number, number] | null = area.center ?? null;

  return (
    <div className={cn("panel overflow-hidden", matches.length ? "panel-danger" : "panel-ok")}>
      <div className="flex items-start justify-between gap-2 p-4">
        <div>
          <p className="label-caps">{area.center ? `Geofence · ${area.radiusKm} km radius` : "Whole district"} · min {area.minSeverity}</p>
          <h2 className="text-base font-semibold">{area.label}</h2>
          <p className="mt-1 flex items-center gap-2 text-sm">
            {loading && !data ? <Loader2 className="size-4 animate-spin" /> : <span className={cn("live-dot", matches.length ? "text-danger" : "text-ok")} />}
            {data ? (matches.length ? `${matches.length} matching official alert(s)` : "No matching official alerts") : "Checking…"}
            {data?.feed.retrievedAt ? <span className="text-xs text-muted-foreground">· checked {relativeTime(data.feed.retrievedAt)}</span> : null}
          </p>
        </div>
        <Button size="icon" variant="ghost" onClick={onRemove} aria-label={`Remove ${area.label}`}>
          <Trash2 />
        </Button>
      </div>
      {error ? <div className="px-4 pb-3"><ErrorState message={error.message} onRetry={reload} /></div> : null}
      {tile && center ? (
        <MapView
          center={center}
          markers={[{ id: "c", lat: center[0], lon: center[1], kind: "place", label: area.label }]}
          circles={[{ id: "g", center, radiusKm: area.radiusKm ?? 5, color: "#a78bfa", label: `${area.radiusKm} km watch area` }]}
          areas={areas}
          tileUrl={tile.tileUrl}
          attribution={tile.attribution}
          fitToAreas={false}
          className="h-[200px] w-full border-y"
        />
      ) : null}
      {matches.length ? (
        <ul className="space-y-2 p-4">
          {matches.map(({ hazard: h, reason }) => (
            <li key={h.id} className="rounded-md border bg-card/60 p-2.5 text-sm">
              <p className="flex flex-wrap items-center gap-1.5">
                <span className="inline-block size-2.5 rounded-full" style={{ background: SEVERITY_COLOR[h.severity] }} />
                <strong>{h.severity === "Unknown" ? "Severity not stated" : h.severity}</strong>
                <span>· {h.issuer}</span>
                <Badge>{REASON[reason]}</Badge>
              </p>
              <p className="mt-1">{h.headline}</p>
              {h.instruction ? <p className="mt-1 rounded bg-muted px-2 py-1 text-xs"><strong>Official guidance:</strong> {h.instruction}</p> : null}
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>Issued {relativeTime(h.issuedAt)}</span>
                <span>{h.expiresAt ? `Expires ${new Date(h.expiresAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST` : "No expiry stated"}</span>
                <SourceLink href={h.capUrl}>CAP record</SourceLink>
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default function WatchPage() {
  const [place] = usePlace();
  const [prefs, setPrefs] = usePrefs();
  const config = useApi<ConfigResponse>("/api/config");
  const { areas, add, remove, max } = useWatchAreas();
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Resolved[] | null>(null);
  const [picked, setPicked] = useState<Resolved | null>(null);
  const [kind, setKind] = useState<"district" | "radius">("radius");
  const [radius, setRadius] = useState(10);
  const [minSeverity, setMinSeverity] = useState<CapSeverity>("Moderate");
  const [includeState, setIncludeState] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPerm("Notification" in window ? Notification.permission : "unsupported");
  }, []);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      setResults((await apiFetch<{ results: Resolved[] }>(`/api/geo/search?q=${encodeURIComponent(query.trim())}`)).results);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const addArea = (base: { label: string; district: string | null; state: string | null; lat: number | null; lon: number | null }) => {
    const center = kind === "radius" && base.lat != null && base.lon != null ? ([base.lat, base.lon] as [number, number]) : undefined;
    add({
      id: `${Date.now().toString(36)}`,
      label: base.label,
      district: base.district,
      state: base.state,
      ...(center ? { center, radiusKm: radius } : {}),
      minSeverity,
      includeStateLevel: includeState,
    });
    setPicked(null);
    setResults(null);
    setQuery("");
  };

  const enableNotifications = async () => {
    if (!("Notification" in window)) return;
    const p = await Notification.requestPermission();
    setPerm(p);
    if (p === "granted") {
      getOrCreateClientId();
      setPrefs({ notifications: true });
    }
  };

  return (
    <>
      <PageHeader
        title="Smart geofenced alerts"
        description="Watch up to 5 areas — a whole district or a radius around any point. ANVIL matches live official alerts to each area using the alert's official polygon or the district it names, and notifies you with severity, source, time and official guidance."
      />

      <div className={cn("panel mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between", prefs.notifications && perm === "granted" ? "panel-ok" : "panel-warning")}>
        <div className="text-sm">
          <p className="flex items-center gap-2 font-semibold"><BellRing className="size-4" /> Notifications: {prefs.notifications && perm === "granted" ? "ON" : "OFF"} <Badge>{perm}</Badge></p>
          <p className="mt-1 text-xs text-muted-foreground">
            Checked every 5 minutes while ANVIL is open in a tab. Not delivered when the tab is closed, offline, or permission is denied — background push is not implemented. Watch areas never leave this browser.
          </p>
        </div>
        {prefs.notifications && perm === "granted" ? (
          <Button variant="outline" onClick={() => setPrefs({ notifications: false })}>Turn off</Button>
        ) : (
          <Button onClick={enableNotifications} disabled={perm === "unsupported" || perm === "denied"}>
            <BellRing /> {perm === "denied" ? "Blocked in browser settings" : "Enable notifications"}
          </Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="panel space-y-4 p-4 lg:col-span-4">
          <p className="label-caps flex items-center gap-1"><Plus className="size-3.5" /> Add a watch area ({areas.length}/{max})</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant={kind === "radius" ? "default" : "outline"} size="sm" onClick={() => setKind("radius")}>Radius</Button>
            <Button variant={kind === "district" ? "default" : "outline"} size="sm" onClick={() => setKind("district")}>Whole district</Button>
          </div>
          {kind === "radius" ? (
            <div className="space-y-1">
              <Label htmlFor="rad">Radius: {radius} km</Label>
              <input id="rad" type="range" min={2} max={50} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="w-full accent-[var(--primary)]" />
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="sev">Minimum severity</Label>
              <Select id="sev" value={minSeverity} onChange={(e) => setMinSeverity(e.target.value as CapSeverity)}>
                <option value="Extreme">Extreme</option>
                <option value="Severe">Severe+</option>
                <option value="Moderate">Moderate+</option>
                <option value="Minor">Minor+</option>
                <option value="Unknown">All</option>
              </Select>
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" className="size-4" checked={includeState} onChange={(e) => setIncludeState(e.target.checked)} />
              Include state-level
            </label>
          </div>

          {place ? (
            <Button variant="outline" className="w-full justify-start" onClick={() => addArea(place)} disabled={areas.length >= max}>
              <MapPin /> Watch my area ({place.label})
            </Button>
          ) : null}

          <form onSubmit={search} className="space-y-1" role="search">
            <Label htmlFor="wq">Or search a place (home, school, family)</Label>
            <div className="flex gap-2">
              <Input id="wq" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Danapur, Patna" />
              <Button type="submit" variant="outline" size="icon" aria-label="Search" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Search />}
              </Button>
            </div>
          </form>
          {results ? (
            results.length ? (
              <ul className="divide-y rounded-md border text-sm">
                {results.map((r) => (
                  <li key={`${r.label}-${r.lat}`}>
                    <button className={cn("w-full px-3 py-2 text-left hover:bg-muted", picked === r && "bg-muted")} onClick={() => setPicked(r)}>
                      {r.label}
                      <span className="block text-xs text-muted-foreground">{r.district ?? "?"}, {r.state ?? "?"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">No matches in India.</p>
            )
          ) : null}
          {picked ? (
            <Button className="w-full" onClick={() => addArea(picked)} disabled={areas.length >= max}>
              <Plus /> Watch {picked.label}
            </Button>
          ) : null}
          {error ? <ErrorState message={error} /> : null}
        </div>

        <div className="space-y-4 lg:col-span-8">
          {areas.length === 0 ? (
            <EmptyState icon={BellRing} title="No watch areas yet">
              Add your home, a relative&apos;s village or your child&apos;s school. ANVIL will check each one against live official alerts.
            </EmptyState>
          ) : config.data ? (
            <div className="grid gap-4 xl:grid-cols-2">
              {areas.map((a) => (
                <AreaCard key={a.id} area={a} tile={config.data?.map} onRemove={() => remove(a.id)} />
              ))}
            </div>
          ) : (
            <Skeleton className="h-64" />
          )}
        </div>
      </div>
    </>
  );
}