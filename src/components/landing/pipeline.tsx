"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from "motion/react";
import { BadgeCheck, Gauge, Radio, Sparkles } from "lucide-react";

const STEPS = [
  {
    n: "01",
    icon: Radio,
    title: "Gather",
    lead: "Official sources, read live.",
    points: ["NDMA SACHET CAP alerts from IMD, CWC and state authorities", "TinyFish Search, Fetch and Agent read government pages as they are now", "OpenStreetMap, Overpass and terrain for places, buildings and routes"],
    tone: "var(--l-accent)",
  },
  {
    n: "02",
    icon: BadgeCheck,
    title: "Verify",
    lead: "No source, no claim.",
    points: ["Every extracted fact carries a quote found word-for-word in the fetched page", "Schema validation on every payload; outbound URLs pass an SSRF guard", "Untrusted page text is fenced off; prompt-injection attempts are flagged"],
    tone: "var(--l-teal)",
  },
  {
    n: "03",
    icon: Gauge,
    title: "Score",
    lead: "Explainable maths, shown in full.",
    points: ["Attention index: severity × urgency × certainty × relevance × recency", "Poisson surge detection on hourly alert rates by state and district", "Duplicates merged; conflicts and stale pages called out"],
    tone: "#7fb2ff",
  },
  {
    n: "04",
    icon: Sparkles,
    title: "Act",
    lead: "Next steps for your district.",
    points: ["A household plan in Hindi or English", "Documented shelters, nearby help and hazard-aware routes", "Watch areas that notify you when an alert touches them"],
    tone: "#b9a2ff",
  },
];

function StepCard({ step, i, total, progress, reduce }: { step: (typeof STEPS)[number]; i: number; total: number; progress: MotionValue<number>; reduce: boolean }) {
  const scale = useTransform(progress, [i / total, 1], [1, 1 - (total - 1 - i) * 0.045]);
  const dim = useTransform(progress, [i / total, Math.min(1, (i + 1) / total)], [0, i === total - 1 ? 0 : 0.35]);
  const Icon = step.icon;
  return (
    <div className="sticky top-0 flex h-[100svh] items-center justify-center px-5 sm:px-10">
      <motion.article
        style={reduce ? { top: `${i * 24}px` } : { scale, top: `${i * 24}px` }}
        className="relative w-full max-w-5xl origin-top overflow-hidden rounded-[32px] border border-white/10 bg-[var(--l-card)] p-7 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.8)] sm:p-12"
      >
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-20 size-72 rounded-full opacity-30 blur-3xl" style={{ background: step.tone }} />
        <div className="relative grid gap-8 md:grid-cols-[1fr_1.3fr] md:gap-12">
          <div>
            <div className="flex items-center gap-4">
              <span className="num text-sm text-[var(--l-mute)]">{step.n} / 0{total}</span>
              <span className="h-px flex-1 bg-white/10" aria-hidden />
            </div>
            <span className="mt-8 grid size-14 place-items-center rounded-2xl bg-white/[0.06]" style={{ color: step.tone }}>
              <Icon className="size-7" aria-hidden />
            </span>
            <h3 className="landing-display mt-6 text-[clamp(2.6rem,6vw,5rem)]">{step.title}</h3>
            <p className="mt-2 text-lg text-[var(--l-soft)]">{step.lead}</p>
          </div>
          <ul className="space-y-4 self-end">
            {step.points.map((p) => (
              <li key={p} className="flex gap-3 border-t border-white/10 pt-4 text-[var(--l-ink)]">
                <span className="mt-2 inline-block size-1.5 shrink-0 rounded-full" style={{ background: step.tone }} aria-hidden />
                {p}
              </li>
            ))}
          </ul>
        </div>
        {!reduce ? <motion.div aria-hidden style={{ opacity: dim }} className="pointer-events-none absolute inset-0 bg-black" /> : null}
      </motion.article>
    </div>
  );
}

/** How a warning becomes an action: four cards that stack as you scroll. */
export function Pipeline() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion() ?? false;
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  return (
    <section className="relative bg-[var(--l-bg)] text-[var(--l-ink)]" aria-labelledby="pipe-h">
      <div className="mx-auto max-w-7xl px-5 pt-28 sm:px-10">
        <p className="text-sm font-semibold text-[var(--l-accent)]">How it works</p>
        <h2 id="pipe-h" className="landing-display mt-4 max-w-[18ch] text-[clamp(2.4rem,5.6vw,4.8rem)]">From a government page to your next step.</h2>
      </div>
      <div ref={ref} className="relative">
        {STEPS.map((s, i) => (
          <StepCard key={s.n} step={s} i={i} total={STEPS.length} progress={scrollYProgress} reduce={reduce} />
        ))}
      </div>
    </section>
  );
}