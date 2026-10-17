"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Flag, Pause, Play, RotateCcw, Timer, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives";

export interface DrillRecord {
  at: string;
  seconds: number;
}

const STEPS = [
  "Everyone hears the call and stops what they are doing",
  "Grab the emergency bag and phones",
  "Switch off electricity and gas at the mains",
  "Help children, elderly and anyone with limited mobility",
  "Lock up and leave by the planned route",
  "Everyone reaches the meeting point near home",
];

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** A timed practice evacuation. Best and recent times are kept in this browser. */
export function Drill({ history, onRecord, onClear }: { history: DrillRecord[]; onRecord: (r: DrillRecord) => void; onClear: () => void }) {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState<number[]>([]);
  const start = useRef<number | null>(null);
  const base = useRef(0);

  useEffect(() => {
    if (!running) return;
    start.current = performance.now();
    const id = window.setInterval(() => {
      if (start.current != null) setElapsed(base.current + (performance.now() - start.current) / 1000);
    }, 200);
    return () => window.clearInterval(id);
  }, [running]);

  const pause = () => {
    if (start.current != null) base.current += (performance.now() - start.current) / 1000;
    start.current = null;
    setRunning(false);
  };
  const reset = () => {
    pause();
    base.current = 0;
    setElapsed(0);
    setDone([]);
  };
  const finish = () => {
    pause();
    if (base.current > 1) onRecord({ at: new Date().toISOString(), seconds: Math.round(base.current) });
    base.current = 0;
    setElapsed(0);
    setDone([]);
  };

  const best = history.length ? Math.min(...history.map((h) => h.seconds)) : null;
  const last = history[0] ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
      <div className="panel p-5 text-center">
        <h2 className="flex items-center justify-center gap-2 text-lg font-semibold"><Timer className="size-5 text-primary" aria-hidden /> Evacuation drill</h2>
        <p className="mt-1 text-sm text-muted-foreground">Practise leaving home with your household. Tick steps as you go; stop the clock when everyone is at the meeting point.</p>
        <p className={cn("num mt-6 text-[clamp(3.5rem,12vw,6rem)] leading-none", running && "text-primary")} aria-live="off">{fmt(elapsed)}</p>
        <p className="sr-only" aria-live="polite">{running ? "Drill running" : elapsed > 0 ? `Paused at ${fmt(elapsed)}` : "Drill ready"}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {running ? (
            <Button size="lg" variant="outline" onClick={pause}><Pause /> Pause</Button>
          ) : (
            <Button size="lg" onClick={() => setRunning(true)}><Play /> {elapsed > 0 ? "Resume" : "Start drill"}</Button>
          )}
          <Button size="lg" variant="default" className="bg-ok text-white hover:bg-ok/90" disabled={elapsed < 1} onClick={finish}><Flag /> Everyone is out</Button>
          <Button size="lg" variant="ghost" disabled={elapsed === 0} onClick={reset}><RotateCcw /> Reset</Button>
        </div>
        <ol className="mx-auto mt-6 max-w-md space-y-2 text-left">
          {STEPS.map((s, i) => {
            const on = done.includes(i);
            return (
              <li key={s}>
                <label className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm", on && "border-ok/50 bg-ok-soft/40")}>
                  <input type="checkbox" className="size-4 accent-[var(--ok)]" checked={on} onChange={() => setDone((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i]))} />
                  <span className="num w-5 text-muted-foreground">{i + 1}</span>
                  <span className={cn(on && "text-muted-foreground")}>{s}</span>
                </label>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="panel p-5">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-semibold"><Trophy className="size-4 text-warning" aria-hidden /> Your drills</h3>
          <Button variant="ghost" size="sm" onClick={onClear} disabled={!history.length}>Clear</Button>
        </div>
        {best != null ? (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs text-muted-foreground">Best time</p>
              <p className="num text-2xl">{fmt(best)}</p>
            </div>
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs text-muted-foreground">Last drill</p>
              <p className="num text-2xl">{last ? fmt(last.seconds) : "—"}</p>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">No drills yet. Families who practise leave faster when it matters.</p>
        )}
        <ul className="mt-4 space-y-1.5">
          <AnimatePresence initial={false}>
            {history.slice(0, 8).map((h) => (
              <motion.li
                key={h.at}
                layout
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <span className="text-muted-foreground">{new Date(h.at).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                <span className={cn("num", h.seconds === best && "font-semibold text-ok")}>{fmt(h.seconds)}{h.seconds === best ? " · best" : ""}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>
    </div>
  );
}