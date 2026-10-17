"use client";

import { motion, useReducedMotion } from "motion/react";
import { HAZARD_LABEL } from "@/components/alerts/alert-card";
import { relativeTime } from "@/lib/core/freshness";
import type { NationalResponse } from "@/types/national";
import { Counter, DUR, EASE_OUT, Reveal } from "./motion-kit";

/** The live numbers, straight from the official feed — nothing here is estimated. */
export function StatsBand({ data }: { data: NationalResponse | null }) {
  const reduce = useReducedMotion();
  const stats = [
    { label: "Active official alerts", value: data?.totals.active },
    { label: "States and UTs affected", value: data?.totals.statesAffected },
    { label: "Issuing authorities", value: data?.totals.issuers },
    { label: "Alerts in the last 48 hours", value: data?.totals.total48h },
  ];
  const hazards = (data?.hazards ?? []).slice(0, 6);
  const max = Math.max(1, ...hazards.map((h) => h.count));

  return (
    <section className="relative border-y border-white/10 bg-[var(--l-bg-2)] text-[var(--l-ink)]" aria-labelledby="stats-h">
      <div className="mx-auto max-w-7xl px-5 py-20 sm:px-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 id="stats-h" className="landing-display max-w-[18ch] text-[clamp(2rem,4.4vw,3.6rem)]">India right now, from the official feed.</h2>
          <p className="text-sm text-[var(--l-mute)]">
            NDMA SACHET · {data ? `retrieved ${relativeTime(data.feed.retrievedAt)}` : "connecting…"} · refreshes every 3 minutes
          </p>
        </div>

        <dl className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-white/10 bg-white/10 lg:grid-cols-4">
          {stats.map((s, i) => (
            <Reveal key={s.label} delay={i * 0.06} className="bg-[var(--l-bg-2)] p-6 sm:p-8">
              <dt className="text-sm text-[var(--l-soft)]">{s.label}</dt>
              <dd className="mt-3 text-[clamp(2.6rem,6vw,4.6rem)] leading-none text-[var(--l-ink)]">
                <Counter value={s.value} />
              </dd>
            </Reveal>
          ))}
        </dl>

        {hazards.length ? (
          <div className="mt-12 grid gap-8 lg:grid-cols-[1fr_2fr] lg:items-start">
            <p className="max-w-[34ch] text-[var(--l-soft)]">What the alerts in the current feed are about, by hazard type.</p>
            <ul className="space-y-3" aria-label="Alerts by hazard type">
              {hazards.map((h, i) => (
                <li key={h.hazard} className="grid grid-cols-[9rem_1fr_3rem] items-center gap-4 text-sm sm:grid-cols-[11rem_1fr_3rem]">
                  <span className="text-[var(--l-ink)]">{HAZARD_LABEL[h.hazard] ?? h.hazard}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
                    {reduce ? (
                      <span className="landing-bar block h-full origin-left rounded-full" style={{ transform: `scaleX(${h.count / max})` }} />
                    ) : (
                      <motion.span
                        className="landing-bar block h-full origin-left rounded-full"
                        initial={{ scaleX: 0 }}
                        whileInView={{ scaleX: h.count / max }}
                        viewport={{ once: true }}
                        transition={{ duration: DUR.slow, ease: EASE_OUT, delay: i * 0.05 }}
                      />
                    )}
                  </span>
                  <span className="num text-right text-[var(--l-soft)]">{h.count}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}