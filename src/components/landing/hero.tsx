"use client";

import Link from "next/link";
import { useMemo, useRef } from "react";
import { relativeTime } from "@/lib/core/freshness";
import { INDIA_BOUNDS, lastPassDate, mosaicFor, positionIn } from "@/lib/landing/imagery";
import { SEVERITY_COLOR } from "@/types/api";
import type { NationalResponse } from "@/types/national";
import { useScrollScene } from "./gsap";
import { Magnetic } from "./magnetic";
import { TileMosaic } from "./tile-mosaic";

const MOSAIC = mosaicFor(INDIA_BOUNDS, 6);
/** The camera starts low over the Bay of Bengal and pulls back to the whole subcontinent. */
const FOCUS = positionIn(MOSAIC, 88.4, 17.2);

export function Hero({ data }: { data: NationalResponse | null }) {
  const root = useRef<HTMLElement>(null);
  const date = useMemo(() => lastPassDate(), []);
  const live = data?.feed.dataMode === "LIVE" || data?.feed.dataMode === "STALE";
  const active = data?.states.filter((s) => s.active > 0) ?? [];

  useScrollScene(root, ({ gsap, isDesktop }) => {
    // One orchestrated opening: the image settles, then the headline arrives line by line.
    const intro = gsap.timeline({ defaults: { ease: "power3.out" } });
    intro
      .fromTo(".hero-settle", { scale: 1.12 }, { scale: 1, duration: 2.6, ease: "power2.out" }, 0)
      .from(".hero-line", { yPercent: 110, duration: 1.1, stagger: 0.12 }, 0.35)
      .from(".hero-sub, .hero-cta", { y: 24, opacity: 0, duration: 0.9, stagger: 0.1 }, 0.9);

    // Scroll: pull back from the cyclone basin to the whole country, then hand over to the next scene.
    const tl = gsap.timeline({
      scrollTrigger: { trigger: root.current, start: "top top", end: isDesktop ? "+=140%" : "+=90%", scrub: 0.7, pin: true, anticipatePin: 1, invalidateOnRefresh: true },
    });
    tl.fromTo(".hero-zoom", { scale: isDesktop ? 2.6 : 2.2 }, { scale: 1, ease: "none", duration: 1 }, 0)
      .to(".hero-copy", { yPercent: -18, opacity: 0, ease: "power1.in", duration: 0.45 }, 0.05)
      .fromTo(".hero-markers", { opacity: 0 }, { opacity: 1, duration: 0.25 }, 0.55)
      .fromTo(".hero-caption", { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.25 }, 0.62)
      .to(".hero-scrim", { opacity: 0.35, duration: 0.6 }, 0.2)
      .to(".hero-media", { clipPath: "inset(6% 4% 6% 4% round 28px)", duration: 0.25, ease: "power2.inOut" }, 0.82);
  });

  return (
    <section ref={root} className="relative h-[100svh] overflow-hidden bg-[#0d1a26] text-[#edf1ee]" aria-label="Today over India">
      <div className="hero-media absolute inset-0" style={{ clipPath: "inset(0% 0% 0% 0% round 0px)" }}>
        <div className="hero-settle absolute inset-0">
          <div
            className="hero-zoom absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 will-change-transform"
            style={{ width: `max(100vw, calc(100svh * ${MOSAIC.cols} / ${MOSAIC.rows}))`, transformOrigin: `${FOCUS.x * 100}% ${FOCUS.y * 100}%` }}
          >
            <TileMosaic mosaic={MOSAIC} layer="bluemarble" fallback="bluemarble-alt" eager alt="Satellite view of India" />
            {/* Yesterday's real satellite pass: clouds over the base map. Gaps between orbits stay transparent. */}
            <TileMosaic mosaic={MOSAIC} layer="viirs" date={date} eager className="!absolute inset-0 mix-blend-lighten" />
            <div className="hero-markers absolute inset-0 opacity-0">
              {active.map((s) => {
                const p = positionIn(MOSAIC, s.center[1], s.center[0]);
                const size = Math.min(34, 10 + Math.sqrt(s.active) * 5);
                return (
                  <span key={s.code} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} title={`${s.name}: ${s.active} active official alert(s)`}>
                    <span className="landing-pulse block rounded-full" style={{ width: size, height: size, background: SEVERITY_COLOR[s.maxSeverity], color: SEVERITY_COLOR[s.maxSeverity] }} />
                  </span>
                );
              })}
            </div>
          </div>
        </div>
        <div className="hero-scrim pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_20%_80%,rgba(13,26,38,0.92),rgba(13,26,38,0.35)_55%,rgba(13,26,38,0.1))]" />
      </div>

      <div className="hero-copy relative z-10 mx-auto flex h-full max-w-7xl flex-col justify-end px-5 pb-[12svh] sm:px-10">
        <h1 className="landing-display max-w-[14ch] text-[clamp(3.1rem,10.5vw,9.5rem)]">
          <span className="block overflow-hidden pb-[0.06em]"><span className="hero-line block">The warnings</span></span>
          <span className="block overflow-hidden pb-[0.06em]"><span className="hero-line block">already exist.</span></span>
          <span className="block overflow-hidden pb-[0.06em]"><span className="hero-line block">ANVIL makes them usable.</span></span>
        </h1>
        <p className="hero-sub mt-6 max-w-[46ch] text-base text-[#c9d3d0] sm:text-lg">
          Official alerts from IMD, CWC and state authorities, matched to your district, checked against their sources and turned into next steps.
        </p>
        <div className="hero-cta mt-8 flex flex-wrap gap-3">
          <Magnetic>
            <Link href="/onboarding" className="landing-btn landing-btn-primary">Check my district</Link>
          </Magnetic>
          <Magnetic>
            <Link href="/map3d" className="landing-btn landing-btn-ghost">Open the 3D map</Link>
          </Magnetic>
        </div>
      </div>

      <div className="hero-caption pointer-events-none absolute inset-x-0 bottom-[9svh] z-10 mx-auto max-w-7xl px-5 opacity-0 sm:px-10">
        <p className="landing-display max-w-[18ch] text-[clamp(2rem,5vw,4.2rem)]">
          {data ? `${data.totals.active} official alerts are active across ${data.totals.statesAffected} states.` : "Connecting to the official alert feed…"}
        </p>
        <p className="mt-3 max-w-[60ch] text-sm text-[#b8c4c1]">
          {live ? `Live from NDMA SACHET, updated ${relativeTime(data?.feed.retrievedAt ?? null)}.` : data ? "The official feed is unreachable right now; this is the last copy retrieved." : ""} Each dot is a state with active alerts, coloured by the highest severity. Clouds are the NASA VIIRS satellite pass of {date}.
        </p>
      </div>
    </section>
  );
}