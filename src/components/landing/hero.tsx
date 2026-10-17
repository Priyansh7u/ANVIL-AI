"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { ArrowDown, ArrowRight } from "lucide-react";
import { relativeTime } from "@/lib/core/freshness";
import { lastPassDate } from "@/lib/landing/imagery";
import { SEVERITY_COLOR } from "@/types/api";
import type { NationalResponse } from "@/types/national";
import type { GlobeMarker, ImageryStatus } from "./globe/earth-globe";
import { Magnetic } from "./magnetic";
import { EASE_OUT, MaskLines } from "./motion-kit";

// WebGL is client-only and heavy: load it after first paint, never on the server.
const EarthGlobe = dynamic(() => import("./globe/earth-globe"), { ssr: false, loading: () => null });

const IMAGERY_NOTE: Record<ImageryStatus, string> = {
  loading: "Loading NASA satellite imagery…",
  live: "Earth: NASA Blue Marble with the VIIRS satellite pass of",
  base: "Earth: NASA Blue Marble (yesterday’s satellite pass unavailable)",
  none: "Satellite imagery unavailable; showing the globe outline",
};

export function Hero({ data }: { data: NationalResponse | null }) {
  const root = useRef<HTMLElement>(null);
  const reduce = useReducedMotion() ?? false;
  const passDate = useMemo(() => lastPassDate(), []);
  const [imagery, setImagery] = useState<ImageryStatus>("loading");
  const { scrollYProgress } = useScroll({ target: root, offset: ["start start", "end end"] });

  const markers = useMemo<GlobeMarker[]>(
    () =>
      (data?.states ?? [])
        .filter((s) => s.active > 0)
        .map((s) => ({ code: s.code, name: s.name, lat: s.center[0], lon: s.center[1], active: s.active, color: SEVERITY_COLOR[s.maxSeverity] })),
    [data],
  );
  const top = useMemo(() => [...(data?.states ?? [])].filter((s) => s.active > 0).sort((a, b) => b.active - a.active).slice(0, 5), [data]);
  const live = data?.feed.dataMode === "LIVE" || data?.feed.dataMode === "STALE";

  // Scroll choreography (the globe reads the same progress inside its render loop).
  const copyOpacity = useTransform(scrollYProgress, [0, 0.22], [1, 0]);
  const copyY = useTransform(scrollYProgress, [0, 0.22], [0, -80]);
  // Faded-out links must not stay clickable under the globe.
  const copyPointer = useTransform(scrollYProgress, (v) => (v > 0.18 ? "none" : "auto"));
  const cueOpacity = useTransform(scrollYProgress, [0, 0.06], [1, 0]);
  const capOpacity = useTransform(scrollYProgress, [0.5, 0.66], [0, 1]);
  const capY = useTransform(scrollYProgress, [0.5, 0.66], [40, 0]);
  const scrimOpacity = useTransform(scrollYProgress, [0, 0.3, 0.6], [1, 0.35, 0.7]);

  return (
    <section ref={root} className={reduce ? "relative h-[100svh]" : "relative h-[300svh]"} aria-label="Live alerts over India">
      <div className="sticky top-0 h-[100svh] overflow-hidden bg-[var(--l-bg)] text-[var(--l-ink)]">
        {/* Placeholder glow so the stage is never empty while WebGL loads (and if it can't). */}
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(60%_60%_at_68%_50%,rgba(60,120,200,0.22),transparent_70%)] md:bg-[radial-gradient(40%_55%_at_70%_50%,rgba(60,120,200,0.22),transparent_70%)]" />
        <EarthGlobe
          className="absolute inset-0"
          markers={markers}
          passDate={passDate}
          reducedMotion={reduce}
          getProgress={() => scrollYProgress.get()}
          onImagery={setImagery}
        />
        <motion.div
          aria-hidden
          style={{ opacity: scrimOpacity }}
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(7,15,24,0.85)_0%,rgba(7,15,24,0.2)_45%,rgba(7,15,24,0.75)_100%)] md:bg-[linear-gradient(90deg,rgba(7,15,24,0.92)_0%,rgba(7,15,24,0.55)_38%,transparent_62%)]"
        />

        {/* Phase 1: the promise */}
        <motion.div style={reduce ? undefined : { opacity: copyOpacity, y: copyY, pointerEvents: copyPointer }} className="relative z-10 mx-auto flex h-full max-w-7xl flex-col justify-start px-5 pt-28 sm:px-10 md:justify-center md:pt-0">
          <motion.p
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: EASE_OUT, delay: 0.1 }}
            className="mb-6 inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-[var(--l-soft)] backdrop-blur"
            aria-live="polite"
          >
            <span className={live ? "live-dot text-[var(--l-teal)]" : "inline-block size-2 rounded-full bg-[var(--l-mute)]"} aria-hidden />
            {data
              ? live
                ? `Live · ${data.totals.active} official alerts · updated ${relativeTime(data.feed.retrievedAt)}`
                : "Official feed unreachable · showing the last copy"
              : "Connecting to NDMA SACHET…"}
          </motion.p>
          <h1 className="landing-display max-w-[13ch] text-[clamp(3rem,9.6vw,8.6rem)]">
            <MaskLines lines={["Every warning,", "made usable."]} delay={0.2} />
          </h1>
          <motion.p
            initial={reduce ? false : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: EASE_OUT, delay: 0.7 }}
            className="mt-6 max-w-[44ch] text-base text-[var(--l-soft)] sm:text-lg"
          >
            ANVIL reads official alerts from IMD, CWC and state authorities, matches them to your district, checks every fact against its source and tells you what to do next.
          </motion.p>
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: EASE_OUT, delay: 0.85 }}
            className="mt-9 flex flex-wrap gap-3"
          >
            <Magnetic>
              <Link href="/onboarding" className="landing-btn landing-btn-primary group gap-2">
                Check my district <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </Magnetic>
            <Magnetic>
              <Link href="/dashboard" className="landing-btn landing-btn-ghost">Open command center</Link>
            </Magnetic>
          </motion.div>
        </motion.div>

        {/* Phase 2: the live picture over India */}
        {!reduce ? (
          <motion.div style={{ opacity: capOpacity, y: capY }} className="pointer-events-none absolute inset-x-0 bottom-[8svh] z-10 mx-auto max-w-7xl px-5 sm:px-10">
            <p className="landing-display max-w-[16ch] text-[clamp(2rem,4.8vw,4rem)]">
              {data ? `${data.totals.active} official alerts active across ${data.totals.statesAffected} states.` : "Connecting to the official alert feed…"}
            </p>
            {top.length ? (
              <ul className="mt-5 flex flex-wrap gap-2" aria-label="States with the most active alerts">
                {top.map((s) => (
                  <li key={s.code} className="flex items-center gap-2 rounded-full border border-white/15 bg-[rgba(7,15,24,0.6)] px-3 py-1.5 text-sm backdrop-blur">
                    <span className="inline-block size-2.5 rounded-full" style={{ background: SEVERITY_COLOR[s.maxSeverity] }} aria-hidden />
                    {s.name}
                    <span className="num text-[var(--l-soft)]">{s.active}</span>
                    <span className="sr-only">active alerts, highest severity {s.maxSeverity}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-4 max-w-[62ch] text-xs text-[var(--l-mute)]">
              Each beam is a state with active alerts — height by count, colour by highest severity.{" "}
              {IMAGERY_NOTE[imagery]}
              {imagery === "live" ? ` ${passDate}.` : ""}
            </p>
          </motion.div>
        ) : null}

        {!reduce ? (
          <motion.div style={{ opacity: cueOpacity }} className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center">
            <span className="flex flex-col items-center gap-2 text-xs text-[var(--l-mute)]">
              Scroll to fly in
              <motion.span animate={{ y: [0, 6, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}>
                <ArrowDown className="size-4" aria-hidden />
              </motion.span>
            </span>
          </motion.div>
        ) : null}
      </div>
    </section>
  );
}