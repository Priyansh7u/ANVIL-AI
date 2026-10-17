"use client";

import { MapPinned, ShieldQuestion, TimerReset } from "lucide-react";
import { Reveal, ScrollWords, SpotlightCard } from "./motion-kit";

const QUESTIONS = [
  {
    icon: MapPinned,
    q: "Does this apply to my district?",
    a: "Alerts name areas in official terms, spread across a national feed, in English and regional languages.",
  },
  {
    icon: ShieldQuestion,
    q: "Where is the nearest relief camp?",
    a: "Shelters and control-room numbers sit on dozens of district websites, often as PDFs or notices.",
  },
  {
    icon: TimerReset,
    q: "Is this still true?",
    a: "Pages go stale, numbers conflict, and generic chatbots answer confidently — inventing shelters and phone numbers.",
  },
];

/** The last-mile gap, told in one sentence that lights up as you read it. */
export function Problem() {
  return (
    <section className="relative bg-[var(--l-bg)] text-[var(--l-ink)]" aria-labelledby="problem-h">
      <div className="mx-auto max-w-7xl px-5 py-28 sm:px-10 sm:py-36">
        <h2 id="problem-h" className="text-sm font-semibold text-[var(--l-accent)]">The last-mile gap</h2>
        <ScrollWords
          className="landing-display mt-6 max-w-[22ch] text-[clamp(2.2rem,5.6vw,5rem)]"
          text="When an alert goes out, a family still has to answer three questions alone — at night, on a phone, with the power about to go."
        />
        <ul className="mt-20 grid gap-5 md:grid-cols-3">
          {QUESTIONS.map(({ icon: Icon, q, a }, i) => (
            <li key={q}>
            <Reveal delay={i * 0.08} className="h-full">
              <SpotlightCard className="h-full rounded-3xl border border-white/10 bg-[var(--l-card)] p-7 sm:p-8">
                <span className="grid size-12 place-items-center rounded-2xl bg-[var(--l-accent-soft)] text-[var(--l-accent)]">
                  <Icon className="size-6" aria-hidden />
                </span>
                <p className="landing-display mt-8 text-[clamp(1.7rem,2.6vw,2.3rem)]">“{q}”</p>
                <p className="mt-4 text-[var(--l-soft)]">{a}</p>
              </SpotlightCard>
            </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}