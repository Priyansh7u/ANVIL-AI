"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, Ban, Dices, Pause, Play, ShieldAlert } from "lucide-react";
import type { LiveShelter, LiveSimInputs } from "@/lib/core/live-sim";
import { planLive } from "@/lib/core/live-sim";
import { arrivalShare, arrivalTimeline, criticalShelters, monteCarlo, type MonteCarloResult } from "@/lib/core/sim-analytics";
import { cn } from "@/lib/utils";
import { Tabs, tabPanelProps } from "@/components/shared/tabs";
import { Badge, Button, Label, Select } from "@/components/ui/primitives";

type LabTab = "timeline" | "stress" | "monte";
const TIP = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 };
const n = (v: number) => v.toLocaleString("en-IN");

/**
 * Decision lab for the live-seeded simulator. All three views re-run the same
 * deterministic planner in the browser under hypothetical conditions.
 */
export function SimLab({ shelters, inputs, onCloseShelter }: { shelters: LiveShelter[]; inputs: LiveSimInputs; onCloseShelter: (id: string) => void }) {
  const [tab, setTab] = useState<LabTab>("timeline");

  return (
    <section className="panel p-4" aria-labelledby="lab-h">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="lab-h" className="flex items-center gap-2 font-semibold">
          Decision lab <Badge tone="sim">simulation</Badge>
        </h2>
        <Tabs<LabTab>
          label="Decision lab views"
          value={tab}
          onChange={setTab}
          items={[
            { id: "timeline", label: "Hour by hour", icon: Activity },
            { id: "stress", label: "Weakest link", icon: ShieldAlert },
            { id: "monte", label: "Risk odds", icon: Dices },
          ]}
        />
      </div>
      <div {...tabPanelProps(tab)}>
        {tab === "timeline" ? <Timeline shelters={shelters} inputs={inputs} /> : tab === "stress" ? <Stress shelters={shelters} inputs={inputs} onCloseShelter={onCloseShelter} /> : <Monte shelters={shelters} inputs={inputs} />}
      </div>
    </section>
  );
}

function Timeline({ shelters, inputs }: { shelters: LiveShelter[]; inputs: LiveSimInputs }) {
  const [hours, setHours] = useState(12);
  const [hour, setHour] = useState(0);
  const [playing, setPlaying] = useState(false);
  const series = useMemo(() => arrivalTimeline(shelters, inputs, { hours }), [shelters, inputs, hours]);

  useEffect(() => setHour((h) => Math.min(h, hours)), [hours]);
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setHour((h) => Math.min(hours, h + 1)), 650);
    return () => window.clearInterval(id);
  }, [playing, hours]);
  useEffect(() => {
    if (playing && hour >= hours) setPlaying(false);
  }, [playing, hour, hours]);

  const now = series[Math.min(hour, series.length - 1)];
  const atHour = useMemo(() => (now ? planLive(shelters, { ...inputs, evacuees: now.arrived, demandMultiplier: 1 }) : null), [shelters, inputs, now]);
  const firstShortfall = series.find((p) => p.unmet > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Button onClick={() => (hour >= hours ? (setHour(0), setPlaying(true)) : setPlaying((p) => !p))} aria-pressed={playing}>
          {playing ? <Pause /> : <Play />} {playing ? "Pause" : hour >= hours ? "Replay" : "Play"}
        </Button>
        <div className="min-w-48 flex-1 space-y-1">
          <Label htmlFor="hour">Hour {hour} of {hours}</Label>
          <input id="hour" type="range" min={0} max={hours} value={hour} onChange={(e) => { setPlaying(false); setHour(Number(e.target.value)); }} className="w-full accent-[var(--sim)]" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="hrs">Evacuation window</Label>
          <Select id="hrs" value={hours} onChange={(e) => setHours(Number(e.target.value))} className="w-32">
            {[6, 12, 24].map((h) => <option key={h} value={h}>{h} hours</option>)}
          </Select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Arrived", now ? n(now.arrived) : "–"],
          ["Sheltered", now ? n(now.sheltered) : "–"],
          ["Without a place", now ? n(now.unmet) : "–"],
          ["Busiest shelter", now ? `${Math.round(now.peakLoad * 100)}%` : "–"],
        ].map(([k, v]) => (
          <div key={k} className={cn("rounded-lg border p-3", k === "Without a place" && now && now.unmet > 0 && "panel-danger")}>
            <p className="label-caps">{k}</p>
            <motion.p key={v} initial={{ opacity: 0.4, y: 4 }} animate={{ opacity: 1, y: 0 }} className="num text-xl">{v}</motion.p>
          </div>
        ))}
      </div>

      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ left: 0, right: 8, top: 8 }}>
            <CartesianGrid stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
            <XAxis dataKey="hour" tickFormatter={(h) => `${h}h`} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
            <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--border)" width={44} />
            <Tooltip contentStyle={TIP} labelFormatter={(h) => `Hour ${h}`} />
            <Area type="monotone" dataKey="sheltered" name="Sheltered" stackId="1" stroke="var(--ok)" fill="var(--ok)" fillOpacity={0.35} isAnimationActive={false} />
            <Area type="monotone" dataKey="unmet" name="Without a place" stackId="1" stroke="var(--danger)" fill="var(--danger)" fillOpacity={0.35} isAnimationActive={false} />
            <ReferenceLine x={hour} stroke="var(--sim)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {atHour ? (
        <ul className="space-y-2" aria-label={`Shelter load at hour ${hour}`}>
          {atHour.utilization.map((u) => {
            const pct = u.capacity ? Math.min(1, u.used / u.capacity) : 0;
            return (
              <li key={u.shelterId} className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-3 text-sm">
                <div className="min-w-0">
                  <div className="flex justify-between gap-2">
                    <span className="truncate">{u.name}</span>
                    <span className="num shrink-0 text-xs text-muted-foreground">{u.state === "OPEN" ? `${n(u.used)} / ${n(u.capacity)}${u.capacityAssumed ? "*" : ""}` : u.state === "CLOSED" ? "unavailable" : "road closed"}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <motion.div className={cn("h-full origin-left rounded-full", pct >= 0.9 ? "bg-danger" : pct >= 0.7 ? "bg-warning" : "bg-ok")} animate={{ scaleX: u.state === "OPEN" ? pct : 0 }} transition={{ type: "spring", stiffness: 140, damping: 22 }} />
                  </div>
                </div>
                <span className="num text-right text-xs">{u.state === "OPEN" ? `${Math.round(pct * 100)}%` : "—"}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Assumption: people set out along an S-curve, half of them by hour {Math.round(hours / 3)} ({Math.round(arrivalShare(Math.round(hours / 3), hours / 3) * 100)}% have left by then).{" "}
        {firstShortfall ? <span className="text-danger">First shortfall at hour {firstShortfall.hour}.</span> : "No shortfall in this window."} * capacity assumed (not published).
      </p>
    </div>
  );
}

function Stress({ shelters, inputs, onCloseShelter }: { shelters: LiveShelter[]; inputs: LiveSimInputs; onCloseShelter: (id: string) => void }) {
  const ranked = useMemo(() => criticalShelters(shelters, inputs), [shelters, inputs]);
  const worst = Math.max(1, ...ranked.map((r) => r.extraUnmet));
  if (!ranked.length) return <p className="text-sm text-muted-foreground">Every shelter is already unavailable in this scenario.</p>;
  const top = ranked[0]!;
  return (
    <div className="space-y-4">
      <p className="text-sm">
        {top.extraUnmet > 0 ? (
          <>
            <span className="font-semibold">{top.name}</span> is the weakest link: if it became unavailable, <span className="num font-semibold text-danger">{n(top.extraUnmet)}</span> more people would have no shelter place.
          </>
        ) : (
          <>No single shelter failure leaves anyone without a place — the network has spare capacity for this scenario.</>
        )}
      </p>
      <ul className="space-y-2">
        {ranked.map((r) => (
          <li key={r.shelterId} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium">{r.name}</span>
              <Button size="sm" variant="outline" onClick={() => onCloseShelter(r.shelterId)}><Ban /> Simulate this failure</Button>
            </div>
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                <motion.div className="h-full origin-left rounded-full bg-danger" initial={{ scaleX: 0 }} animate={{ scaleX: r.extraUnmet / worst }} transition={{ duration: 0.6 }} />
              </div>
              <span className="num text-xs text-muted-foreground">
                +{n(r.extraUnmet)} unsheltered{r.extraAvgKm != null && r.extraAvgKm !== 0 ? ` · ${r.extraAvgKm > 0 ? "+" : ""}${r.extraAvgKm} km avg` : ""} · serves {n(r.serving)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Monte({ shelters, inputs }: { shelters: LiveShelter[]; inputs: LiveSimInputs }) {
  const [pFail, setPFail] = useState(0.15);
  const [runs, setRuns] = useState(500);
  const [result, setResult] = useState<MonteCarloResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = () => {
    setBusy(true);
    // Yield a frame so the button shows its busy state before the work starts.
    window.setTimeout(() => {
      setResult(monteCarlo(shelters, inputs, { runs, pFail, seed: Date.now() % 100000 }));
      setBusy(false);
    }, 30);
  };
  useEffect(() => setResult(null), [shelters, inputs]);

  const share = result ? Math.round(result.fullyShelteredShare * 100) : null;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        What if roads fail at random? Each run independently closes the road to each open shelter with the chance you set, then re-plans. The result is the odds that everyone still finds a place.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1 space-y-1">
          <Label htmlFor="pfail">Chance each road fails: {Math.round(pFail * 100)}%</Label>
          <input id="pfail" type="range" min={0.05} max={0.5} step={0.05} value={pFail} onChange={(e) => setPFail(Number(e.target.value))} className="w-full accent-[var(--sim)]" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="runs">Runs</Label>
          <Select id="runs" value={runs} onChange={(e) => setRuns(Number(e.target.value))} className="w-28">
            {[200, 500, 1000].map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        </div>
        <Button onClick={run} disabled={busy}>
          <Dices /> {busy ? "Running…" : "Run simulation"}
        </Button>
      </div>

      {result ? (
        <div className="grid gap-4 md:grid-cols-[14rem_1fr]">
          <div className={cn("rounded-xl border p-4 text-center", (share ?? 0) >= 90 ? "panel-ok" : (share ?? 0) >= 60 ? "panel-warning" : "panel-danger")}>
            <p className="label-caps">Everyone sheltered in</p>
            <motion.p key={share} initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="num text-5xl">{share}%</motion.p>
            <p className="text-xs text-muted-foreground">of {n(result.runs)} runs</p>
            <dl className="mt-3 grid grid-cols-2 gap-1 text-left text-xs">
              <dt className="text-muted-foreground">Typical shortfall</dt>
              <dd className="num text-right">{n(result.unmetP50)}</dd>
              <dt className="text-muted-foreground">Bad case (P90)</dt>
              <dd className="num text-right">{n(result.unmetP90)}</dd>
              <dt className="text-muted-foreground">Worst run</dt>
              <dd className="num text-right">{n(result.unmetMax)}</dd>
            </dl>
          </div>
          <div>
            <p className="label-caps mb-1">People without a place, across runs</p>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={result.histogram.map((h) => ({ bucket: h.from === h.to ? `${h.from}` : `${n(h.from)}–${n(h.to)}`, runs: h.runs }))}>
                  <XAxis dataKey="bucket" tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} stroke="var(--border)" interval={0} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--border)" width={32} />
                  <Tooltip contentStyle={TIP} />
                  <Bar dataKey="runs" name="Runs" fill="var(--sim)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {result.strain[0] && result.strain[0].overloadedShare > 0 ? (
              <p className="mt-2 text-sm">
                Most strained: <span className="font-semibold">{result.strain[0].name}</span> was over 90% full in {Math.round(result.strain[0].overloadedShare * 100)}% of runs — pre-position supplies there.
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Set the failure chance and run. Results are reproducible per run seed and are a simulation, not a forecast.</p>
      )}
    </div>
  );
}