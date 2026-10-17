"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FlaskConical, RotateCcw } from "lucide-react";
import type { SimPlan, SimScenario } from "@/lib/core/simulation";
import { ASSUMPTIONS } from "@/lib/core/simulation";
import { cn } from "@/lib/utils";
import { apiFetch, useApi, type ApiError } from "@/hooks/use-api";
import { ErrorState, SimulatedBanner } from "@/components/shared/status";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Label, Skeleton } from "@/components/ui/primitives";
import type { LiveShelter, LiveSimInputs } from "@/lib/core/live-sim";
import { SimLab } from "./sim-lab";

interface SimResponse {
  isSimulated: true;
  sessionId: string | null;
  plan: SimPlan;
  baseline: SimPlan;
  changes: string[];
}

function Schematic({ scenario, plan }: { scenario: SimScenario; plan: SimPlan }) {
  const sx = (x: number) => 20 + x * 28;
  const sy = (y: number) => 20 + y * 28;
  return (
    <svg viewBox="0 0 400 220" className="h-auto w-full" role="img" aria-label="Schematic of simulated zones, shelters and assignments">
      <rect x="0" y="0" width="400" height="220" fill="var(--muted)" rx="8" />
      {plan.allocations.map((a, i) => {
        const z = scenario.zones.find((zz) => zz.id === a.zoneId);
        const s = scenario.shelters.find((ss) => ss.id === a.shelterId);
        if (!z || !s) return null;
        return <line key={i} x1={sx(z.x)} y1={sy(z.y)} x2={sx(s.x)} y2={sy(s.y)} stroke="var(--sim)" strokeWidth={Math.max(1, a.people / 300)} opacity="0.6" />;
      })}
      {scenario.zones.map((z) => (
        <g key={z.id}>
          <circle cx={sx(z.x)} cy={sy(z.y)} r="12" fill={z.risk === "high" ? "var(--danger)" : z.risk === "medium" ? "var(--warning)" : "var(--ok)"} opacity="0.85" />
          <text x={sx(z.x)} y={sy(z.y) + 4} textAnchor="middle" fontSize="10" fill="white" fontWeight="600">{z.id}</text>
        </g>
      ))}
      {scenario.shelters.map((s) => {
        const closed = plan.inputs.closedShelterIds.includes(s.id);
        return (
          <g key={s.id}>
            <rect x={sx(s.x) - 11} y={sy(s.y) - 11} width="22" height="22" rx="4" fill={closed ? "var(--card)" : "var(--primary)"} stroke="var(--foreground)" strokeDasharray={closed ? "3 2" : undefined} />
            <text x={sx(s.x)} y={sy(s.y) + 4} textAnchor="middle" fontSize="10" fill={closed ? "var(--muted-foreground)" : "var(--primary-foreground)"} fontWeight="600">{s.id}</text>
          </g>
        );
      })}
      <text x="390" y="212" textAnchor="end" fontSize="10" fill="var(--sim)" fontWeight="700">SIMULATED</text>
    </svg>
  );
}

export function TrainingSimulator() {
  const init = useApi<{ scenario: SimScenario; baseline: SimPlan }>("/api/simulator");
  const [closed, setClosed] = useState<string[]>([]);
  const [multiplier, setMultiplier] = useState(1);
  const [result, setResult] = useState<SimResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!init.data) return;
    const c = new AbortController();
    const t = setTimeout(() => {
      apiFetch<SimResponse>("/api/simulator", {
        method: "POST",
        signal: c.signal,
        body: JSON.stringify({ scenarioId: init.data!.scenario.id, closedShelterIds: closed, demandMultiplier: multiplier }),
      })
        .then((r) => {
          setResult(r);
          setError(null);
        })
        .catch((e: ApiError) => {
          if (e.code !== "ABORTED") setError(e.message);
        });
    }, 250);
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, [init.data, closed, multiplier]);

  const scenario = init.data?.scenario;
  const plan = result?.plan ?? init.data?.baseline;
  const baseline = result?.baseline ?? init.data?.baseline;
  const chart = plan && baseline
    ? plan.utilization.map((u) => ({
        name: u.shelterId,
        Baseline: baseline.utilization.find((b) => b.shelterId === u.shelterId)?.used ?? 0,
        Scenario: u.used,
        Capacity: u.capacity,
      }))
    : [];
  const unmet = plan?.unmet.reduce((n, u) => n + u.people, 0) ?? 0;

  // The decision lab works on a flat list of shelters: use each shelter's population-weighted
  // grid distance from the fictional zones as its travel distance.
  const labShelters = useMemo<LiveShelter[]>(() => {
    if (!scenario) return [];
    const pop = scenario.zones.reduce((n, z) => n + z.population, 0) || 1;
    return scenario.shelters.map((sh) => ({
      id: sh.id,
      name: sh.name,
      publishedCapacity: sh.capacity,
      distanceKm: Math.round((scenario.zones.reduce((n, z) => n + Math.hypot(z.x - sh.x, z.y - sh.y) * z.population, 0) / pop) * 10) / 10,
      durationMin: null,
      sourceUrl: "",
    }));
  }, [scenario]);
  const labInputs = useMemo<LiveSimInputs>(
    () => ({ evacuees: init.data?.baseline.totalEvacuees ?? 0, assumedCapacity: 300, closedShelterIds: closed, blockedRouteIds: [], demandMultiplier: multiplier }),
    [init.data?.baseline.totalEvacuees, closed, multiplier],
  );

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button variant="outline" size="sm" onClick={() => { setClosed([]); setMultiplier(1); }}>
          <RotateCcw /> Reset scenario
        </Button>
      </div>
      <SimulatedBanner>Training scenario: a fictional district with invented shelters and populations, for practising decisions when your district has no documented shelters yet.</SimulatedBanner>

      {init.error ? <div className="mt-4"><ErrorState message={init.error.message} onRetry={init.reload} /></div> : null}
      {error ? <div className="mt-4"><ErrorState message={error} /></div> : null}

      {!scenario || !plan ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2"><Skeleton className="h-64" /><Skeleton className="h-64" /></div>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Card className="border-sim/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FlaskConical className="size-4 text-sim" /> {scenario.title}</CardTitle>
              <CardDescription>{scenario.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <fieldset>
                <legend className="mb-2 text-sm font-medium">Shelter availability</legend>
                <ul className="space-y-1">
                  {scenario.shelters.map((s) => {
                    const isClosed = closed.includes(s.id);
                    return (
                      <li key={s.id}>
                        <label className="flex min-h-10 items-center justify-between gap-2 rounded-md border px-3 text-sm">
                          <span>
                            <strong>{s.id}</strong> {s.name} <span className="text-xs text-muted-foreground">cap {s.capacity}{s.accessible ? " · step-free" : ""}</span>
                          </span>
                          <span className="flex items-center gap-2">
                            <span className={cn("text-xs", isClosed ? "text-danger" : "text-ok")}>{isClosed ? "Unavailable" : "Open"}</span>
                            <input
                              type="checkbox"
                              className="size-4"
                              checked={!isClosed}
                              onChange={(e) => setClosed((c) => (e.target.checked ? c.filter((x) => x !== s.id) : [...c, s.id]))}
                              aria-label={`${s.name} available`}
                            />
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
              <div className="space-y-1">
                <Label htmlFor="demand">Evacuation demand: ×{multiplier.toFixed(1)}</Label>
                <input id="demand" type="range" min={0.5} max={3} step={0.1} value={multiplier} onChange={(e) => setMultiplier(Number(e.target.value))} className="w-full accent-[var(--sim)]" />
                <p className="text-xs text-muted-foreground">1.0 = baseline evacuation rates (high-risk 60%, medium 25%, low 5% — illustrative assumptions).</p>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4 lg:col-span-2">
            <div className="grid gap-3 sm:grid-cols-4">
              {[
                ["Evacuees", plan.totalEvacuees.toLocaleString("en-IN")],
                ["Unsheltered", unmet.toLocaleString("en-IN")],
                ["Water / day", `${(plan.resources.waterLitresPerDay / 1000).toFixed(1)} kL`],
                ["Vehicle trips", String(plan.resources.vehiclesNeeded)],
              ].map(([k, v]) => (
                <div key={k} className={cn("rounded-lg border bg-card p-3", k === "Unsheltered" && unmet > 0 && "border-danger bg-danger-soft")}>
                  <p className="text-xs text-muted-foreground">{k} <Badge tone="sim" className="ml-1">sim</Badge></p>
                  <p className="text-xl font-semibold">{v}</p>
                </div>
              ))}
            </div>

            <Card>
              <CardHeader><CardTitle>Shelter load: baseline vs scenario</CardTitle></CardHeader>
              <CardContent>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chart}>
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
                      <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
                      <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="Capacity" fill="var(--muted-foreground)" fillOpacity={0.3} isAnimationActive={false} />
                      <Bar dataKey="Baseline" fill="var(--primary)" isAnimationActive={false} />
                      <Bar dataKey="Scenario" fill="var(--sim)" isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>Response actions</CardTitle><CardDescription>Generated by the simulator rules</CardDescription></CardHeader>
                <CardContent>
                  {plan.actions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Baseline plan: all evacuees placed within capacity.</p>
                  ) : (
                    <ul className="list-disc space-y-1 pl-5 text-sm">{plan.actions.map((a) => <li key={a}>{a}</li>)}</ul>
                  )}
                  {result?.changes.length ? (
                    <>
                      <p className="mt-3 text-sm font-medium">Changes vs baseline</p>
                      <ul className="list-disc space-y-1 pl-5 text-sm text-sim">{result.changes.map((c) => <li key={c}>{c}</li>)}</ul>
                    </>
                  ) : null}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Assignments map</CardTitle><CardDescription>Zones (circles) → shelters (squares)</CardDescription></CardHeader>
                <CardContent>
                  <Schematic scenario={scenario} plan={plan} />
                  <p className="mt-2 text-xs text-muted-foreground">
                    Planning assumptions: {ASSUMPTIONS.mealsPerPersonPerDay} meals and {ASSUMPTIONS.waterLitresPerPersonPerDay} L water per person/day, 1 medical team per {ASSUMPTIONS.peoplePerMedicalTeam} people, transport beyond {ASSUMPTIONS.maxWalkingKm} km.
                  </p>
                </CardContent>
              </Card>
            </div>
            {result?.sessionId ? <p className="text-xs text-muted-foreground">Simulation session {result.sessionId.slice(0, 8)} saved (expires in 7 days).</p> : null}
          </div>
        </div>
      )}
      {labShelters.length && labInputs.evacuees > 0 ? (
        <div className="mt-4">
          <SimLab shelters={labShelters} inputs={labInputs} onCloseShelter={(id) => setClosed((c) => (c.includes(id) ? c : [...c, id]))} />
        </div>
      ) : null}
    </>
  );
}