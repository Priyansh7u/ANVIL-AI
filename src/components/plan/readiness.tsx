"use client";

import { motion, useReducedMotion } from "motion/react";
import { CheckCircle2, Circle } from "lucide-react";
import type { ReadinessResult } from "@/lib/core/readiness";
import { cn } from "@/lib/utils";

function tone(score: number) {
  if (score >= 80) return { color: "var(--ok)", label: "Well prepared" };
  if (score >= 50) return { color: "var(--warning)", label: "Getting there" };
  return { color: "var(--danger)", label: "Needs attention" };
}

/** A ring that fills to the household's readiness score, with the working shown underneath. */
export function ReadinessRing({ result, size = 148 }: { result: ReadinessResult; size?: number }) {
  const reduce = useReducedMotion();
  const r = (size - 16) / 2;
  const c = 2 * Math.PI * r;
  const t = tone(result.score);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" strokeWidth={12} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={t.color}
          strokeWidth={12}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={reduce ? false : { strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - result.score / 100) }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="num text-4xl leading-none">{result.score}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">of 100</p>
        </div>
      </div>
    </div>
  );
}

export function ReadinessPanel({ result, status }: { result: ReadinessResult; status?: React.ReactNode }) {
  const t = tone(result.score);
  return (
    <section className="panel mb-4 flex flex-col gap-5 p-4 sm:flex-row sm:items-center sm:p-5" aria-labelledby="ready-h">
      <ReadinessRing result={result} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="ready-h" className="text-lg font-semibold">Household readiness</h2>
          <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ color: t.color, background: `color-mix(in oklch, ${t.color} 14%, transparent)` }}>
            {t.label}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Scored only from what you have done here. Kept in this browser.</p>
        {status ? <div className="mt-3">{status}</div> : null}
        <ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {result.parts.map((p) => {
            const done = p.points === p.max;
            return (
              <li key={p.id} className="flex items-start gap-2 text-sm">
                {done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
                <span className="min-w-0">
                  <span className={cn(done && "text-muted-foreground")}>{p.label}</span>{" "}
                  <span className="num text-xs text-muted-foreground">{p.points}/{p.max}</span>
                  {p.tip ? <span className="block text-xs text-muted-foreground">{p.tip}</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}