"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Ban, CloudLightning, FlaskConical, Loader2, RotateCcw, RouteOff, Sun, Waves, Wind } from "lucide-react";
import type { LiveShelter, LiveSimInputs, LiveSimPlan } from "@/lib/core/live-sim";
import { LIVE_ASSUMPTIONS } from "@/lib/core/live-sim";
import type { Place } from "@/lib/core/types";
import { cn } from "@/lib/utils";
import { apiFetch, useApi, type ApiError } from "@/hooks/use-api";
import type { ConfigResponse } from "@/types/api";
import { MapView, type MapMarker } from "@/components/maps/map-view";
import { EmptyState, ErrorState, SimulatedBanner, SourceLink } from "@/components/shared/status";
import { Badge, Button, Input, Label, Skeleton } from "@/components/ui/primitives";
import { SimLab } from "./sim-lab";

/** Starting points for practice. Every number is a hypothetical input the user can change. */
const PRESETS = [
  { id: "cyclone", label: "Cyclone landfall", icon: Wind, evacuees: 5000, multiplier: 2.5, note: "large pre-emptive coastal evacuation" },
  { id: "flash", label: "Flash flood at night", icon: Waves, evacuees: 2000, multiplier: 1.8, note: "fast surge, little warning" },
  { id: "storm", label: "Severe thunderstorm", icon: CloudLightning, evacuees: 800, multiplier: 1.2, note: "short-lived, local damage" },
  { id: "heat", label: "Heatwave cooling", icon: Sun, evacuees: 1500, multiplier: 1.3, note: "people seeking cool shelter by day" },
] as const;

interface LiveShelterView {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lon: number;
  publishedCapacity: number | null;
  distanceKm: number | null;
  durationMin: number | null;
  sourceUrl: string;
  verifiedAt: string | null;
}

interface LiveResponse {
  isSimulated: true;
  sessionId: string | null;
  shelters: LiveShelterView[];
  baseline: LiveSimPlan;
  plan: LiveSimPlan;
  changes: string[];
  routingNote: string | null;
}

/**
 * Live-seeded what-if simulator: real documented shelters and real road
 * distances for the user's district; evacuee numbers and closures are
 * hypothetical inputs. Everything shown is labelled SIMULATION.
 */
export function LiveSimulator({ place, onNeedTraining }: { place: Place; onNeedTraining: () => void }) {
  const config = useApi<ConfigResponse>("/api/config");
  const [evacuees, setEvacuees] = useState(1000);
  const [assumedCapacity, setAssumedCapacity] = useState(300);
  const [multiplier, setMultiplier] = useState(1);
  const [closed, setClosed] = useState<string[]>([]);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [data, setData] = useState<LiveResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [preset, setPreset] = useState<string | null>(null);
  const simInputs = useMemo<LiveSimInputs>(
    () => ({ evacuees, assumedCapacity, closedShelterIds: closed, blockedRouteIds: blocked, demandMultiplier: multiplier }),
    [evacuees, assumedCapacity, closed, blocked, multiplier],
  );
  const labShelters = useMemo<LiveShelter[]>(
    () => (data?.shelters ?? []).map((s) => ({ id: s.id, name: s.name, publishedCapacity: s.publishedCapacity, distanceKm: s.distanceKm, durationMin: s.durationMin, sourceUrl: s.sourceUrl })),
    [data?.shelters],
  );

  useEffect(() => {
    if (place.lat == null || place.lon == null) return;
    const c = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      apiFetch<LiveResponse>("/api/simulator/live", {
        method: "POST",
        signal: c.signal,
        timeoutMs: 30_000,
        body: JSON.stringify({
          place: { label: place.label, district: place.district, state: place.state },
          origin: { lat: place.lat, lon: place.lon },
          evacuees,
          assumedCapacity,
          closedShelterIds: closed,
          blockedRouteIds: blocked,
          demandMultiplier: multiplier,
        }),
      })
        .then((r) => {
          setData(r);
          setError(null);
        })
        .catch((e: ApiError) => {
          if (e.code !== "ABORTED") setError(e);
        })
        .finally(() => setLoading(false));
    }, 300);
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, [place.label, place.district, place.state, place.lat, place.lon, evacuees, assumedCapacity, multiplier, closed, blocked]);

  const markers = useMemo<MapMarker[]>(() => {
    const m: MapMarker[] = (data?.shelters ?? []).map((s) => {
      const state = closed.includes(s.id) ? "CLOSED" : blocked.includes(s.id) ? "ROUTE BLOCKED" : "OPEN";
      const used = data?.plan.utilization.find((u) => u.shelterId === s.id);
      return {
        id: s.id,
        lat: s.lat,
        lon: s.lon,
        kind: state === "OPEN" ? "shelter" : "closed",
        label: `${s.name} — ${state} (simulated)`,
        detail: `${used ? `${used.used}/${used.capacity}${used.capacityAssumed ? " (assumed capacity)" : ""}` : ""}${s.distanceKm != null ? ` · ${s.distanceKm} km by road` : ""}`,
      };
    });
    if (place.lat != null && place.lon != null) m.push({ id: "origin", lat: place.lat, lon: place.lon, kind: "place", label: "Evacuation origin (your area)" });
    return m;
  }, [data, closed, blocked, place.lat, place.lon]);

  if (place.lat == null || place.lon == null) {
    return <ErrorState message="Live simulation needs an approximate location for your area. Set your location using GPS or search." />;
  }
  if (error?.code === "NO_DOCUMENTED_SHELTERS") {
    return (
      <EmptyState icon={FlaskConical} title="No documented shelters for this district yet">
        <p>{error.message}</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <Link href="/agent" className="text-primary underline">Run the research agent</Link>
          <button className="text-sim underline" onClick={onNeedTraining}>Use the training scenario instead</button>
        </div>
      </EmptyState>
    );
  }

  const plan = data?.plan;
  const chart = (data?.shelters ?? []).map((s) => {
    const b = data?.baseline.utilization.find((u) => u.shelterId === s.id);
    const p = plan?.utilization.find((u) => u.shelterId === s.id);
    return { name: s.name.length > 16 ? `${s.name.slice(0, 15)}…` : s.name, Capacity: p?.capacity ?? 0, Baseline: b?.used ?? 0, Scenario: p?.used ?? 0 };
  });
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <div className="space-y-4">
      <SimulatedBanner>
        Live-seeded simulation for {place.label}: shelters are real (documented on official pages) and distances are real road distances. Evacuee numbers, closures and assumed capacities are hypothetical inputs — this is decision practice, not a prediction.
      </SimulatedBanner>
      {error && error.code !== "NO_DOCUMENTED_SHELTERS" ? <ErrorState message={error.message} /> : null}

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="panel space-y-4 p-4 lg:col-span-4">
          <div className="flex items-center justify-between">
            <p className="label-caps">Scenario inputs</p>
            <Button size="sm" variant="ghost" onClick={() => { setClosed([]); setBlocked([]); setMultiplier(1); setPreset(null); }}>
              <RotateCcw /> Reset
            </Button>
          </div>
          <div>
            <p className="mb-2 text-xs text-muted-foreground">Start from a practice scenario</p>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={preset === p.id}
                  title={p.note}
                  onClick={() => { setPreset(p.id); setEvacuees(p.evacuees); setMultiplier(p.multiplier); }}
                  className={cn("flex min-h-11 items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors hover:bg-muted", preset === p.id && "border-sim bg-sim-soft text-sim")}
                >
                  <p.icon className="size-4 shrink-0" aria-hidden />
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="evac">People to shelter</Label>
              <Input id="evac" type="number" inputMode="numeric" min={0} max={1000000} value={evacuees} onChange={(e) => { setPreset(null); setEvacuees(Math.max(0, Number(e.target.value) || 0)); }} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cap">Capacity if not published</Label>
              <Input id="cap" type="number" inputMode="numeric" min={1} max={100000} value={assumedCapacity} onChange={(e) => setAssumedCapacity(Math.max(1, Number(e.target.value) || 1))} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="mult">Demand surge: ×{multiplier.toFixed(1)}</Label>
            <input id="mult" type="range" min={0.5} max={3} step={0.1} value={multiplier} onChange={(e) => setMultiplier(Number(e.target.value))} className="w-full accent-[var(--sim)]" />
          </div>
          <div>
            <p className="label-caps mb-2">Shelters & routes — tap to simulate failures</p>
            {!data ? (
              <Skeleton className="h-32" />
            ) : (
              <ul className="space-y-2">
                {data.shelters.map((s) => {
                  const isClosed = closed.includes(s.id);
                  const isBlocked = blocked.includes(s.id);
                  return (
                    <li key={s.id} className={cn("rounded-md border p-2 text-sm", (isClosed || isBlocked) && "border-danger/60 bg-danger-soft/40")}>
                      <p className="font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.distanceKm != null ? `${s.distanceKm} km · ~${s.durationMin} min by road` : "road distance unavailable"} · {s.publishedCapacity != null ? `capacity ${s.publishedCapacity} (published)` : `capacity ${assumedCapacity} (assumed)`}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <Button size="sm" variant={isClosed ? "danger" : "outline"} onClick={() => toggle(closed, setClosed, s.id)} aria-pressed={isClosed}>
                          <Ban /> {isClosed ? "Unavailable" : "Make unavailable"}
                        </Button>
                        <Button size="sm" variant={isBlocked ? "danger" : "outline"} onClick={() => toggle(blocked, setBlocked, s.id)} aria-pressed={isBlocked}>
                          <RouteOff /> {isBlocked ? "Road closed" : "Close road"}
                        </Button>
                        <SourceLink href={s.sourceUrl} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-4 lg:col-span-8">
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              ["People to shelter", plan ? plan.totalEvacuees.toLocaleString("en-IN") : "–"],
              ["Without shelter", plan ? plan.unmet.toLocaleString("en-IN") : "–"],
              ["Avg. road distance", plan?.avgTravelKm != null ? `${plan.avgTravelKm} km` : "–"],
              ["Water / day", plan ? `${(plan.resources.waterLitresPerDay / 1000).toFixed(1)} kL` : "–"],
            ].map(([k, v]) => (
              <div key={k} className={cn("panel p-3", k === "Without shelter" && plan && plan.unmet > 0 && "panel-danger")}>
                <p className="label-caps flex items-center justify-between">{k} <Badge tone="sim">sim</Badge></p>
                <p className="num text-xl font-semibold">{v}</p>
              </div>
            ))}
          </div>

          <div className="panel overflow-hidden">
            {config.data ? (
              <MapView center={[place.lat, place.lon]} markers={markers} tileUrl={config.data.map.tileUrl} attribution={config.data.map.attribution} className="h-[300px] w-full" />
            ) : (
              <Skeleton className="h-[300px] rounded-none" />
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="panel p-4">
              <p className="label-caps mb-2 flex items-center gap-2">Response plan {loading ? <Loader2 className="size-3 animate-spin" /> : null}</p>
              {plan && plan.actions.length ? (
                <ul className="list-disc space-y-1 pl-5 text-sm">{plan.actions.map((a) => <li key={a}>{a}</li>)}</ul>
              ) : (
                <p className="text-sm text-muted-foreground">Baseline: everyone fits in the nearest documented shelters.</p>
              )}
              {data?.changes.length ? (
                <>
                  <p className="label-caps mb-1 mt-3">Changes vs baseline</p>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-sim">{data.changes.map((c) => <li key={c}>{c}</li>)}</ul>
                </>
              ) : null}
              {data?.routingNote ? <p className="mt-2 text-xs text-warning">{data.routingNote}</p> : null}
            </div>
            <div className="panel p-4">
              <p className="label-caps mb-2">Shelter load · baseline vs scenario</p>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart}>
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
                    <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
                    <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Capacity" fill="var(--muted-foreground)" fillOpacity={0.3} isAnimationActive={false} />
                    <Bar dataKey="Baseline" fill="var(--primary)" isAnimationActive={false} />
                    <Bar dataKey="Scenario" fill="var(--sim)" isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Assumptions: {LIVE_ASSUMPTIONS.mealsPerPersonPerDay} meals and {LIVE_ASSUMPTIONS.waterLitresPerPersonPerDay} L water per person/day; transport beyond {LIVE_ASSUMPTIONS.walkableKm} km at {LIVE_ASSUMPTIONS.peoplePerVehicleTrip} people per trip.
              </p>
            </div>
          </div>
          {labShelters.length ? <SimLab shelters={labShelters} inputs={simInputs} onCloseShelter={(id) => setClosed((c) => (c.includes(id) ? c : [...c, id]))} /> : null}
        </div>
      </div>
    </div>
  );
}