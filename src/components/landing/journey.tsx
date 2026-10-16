"use client";

import Link from "next/link";
import { useRef } from "react";
import { IMAGERY_CREDIT, JOURNEY, map3dLink, mosaicFor } from "@/lib/landing/imagery";
import type { NationalResponse } from "@/types/national";
import { useScrollScene } from "./gsap";
import { TileMosaic } from "./tile-mosaic";

const PANELS = JOURNEY.map((p) => ({ ...p, mosaic: mosaicFor({ west: p.lon - 0.07, east: p.lon + 0.07, south: p.lat - 0.05, north: p.lat + 0.05 }, 12) }));

export function Journey({ data }: { data: NationalResponse | null }) {
  const root = useRef<HTMLElement>(null);

  useScrollScene(root, ({ gsap, isDesktop }) => {
    const panels = gsap.utils.toArray<HTMLElement>(".journey-panel");
    if (isDesktop) {
      // Vertical scroll drives a horizontal journey across the country.
      const track = root.current?.querySelector<HTMLElement>(".journey-track");
      if (!track) return;
      const distance = () => track.scrollWidth - window.innerWidth;
      const move = gsap.to(track, {
        x: () => -distance(),
        ease: "none",
        scrollTrigger: { trigger: root.current, start: "top top", end: () => `+=${distance()}`, scrub: 0.6, pin: true, invalidateOnRefresh: true, anticipatePin: 1 },
      });
      panels.forEach((p) => {
        const img = p.querySelector(".journey-img");
        const frame = p.querySelector(".journey-frame");
        // The image drifts inside its frame and the frame opens as it enters.
        if (img) gsap.fromTo(img, { xPercent: -8, scale: 1.15 }, { xPercent: 8, scale: 1.05, ease: "none", scrollTrigger: { trigger: p, containerAnimation: move, start: "left right", end: "right left", scrub: true } });
        if (frame) gsap.fromTo(frame, { clipPath: "inset(0 0 0 100% round 20px)" }, { clipPath: "inset(0 0 0 0% round 20px)", ease: "power2.out", scrollTrigger: { trigger: p, containerAnimation: move, start: "left 95%", end: "left 45%", scrub: true } });
      });
    } else {
      panels.forEach((p) => {
        const img = p.querySelector(".journey-img");
        if (img) gsap.fromTo(img, { yPercent: -6 }, { yPercent: 6, ease: "none", scrollTrigger: { trigger: p, start: "top bottom", end: "bottom top", scrub: true } });
      });
    }
  });

  return (
    <section ref={root} className="relative overflow-hidden bg-[#edf1ee] text-[#0d1a26]" aria-labelledby="journey-h">
      <div className="journey-track flex flex-col gap-14 px-5 py-20 sm:px-10 md:h-[100svh] md:w-max md:flex-row md:items-center md:gap-[6vw] md:py-0 md:pl-[8vw] md:pr-[10vw]">
        <div className="md:w-[34vw] md:shrink-0">
          <h2 id="journey-h" className="landing-display text-[clamp(2.4rem,5vw,4.4rem)]">Six places India already knows the cost of.</h2>
          <p className="mt-4 max-w-[40ch] text-[#3f5157]">Each is a live link: open it in the 3D map to see today&apos;s official alerts, terrain and buildings there.</p>
          <p className="mt-6 text-xs text-[#5f7176]">{IMAGERY_CREDIT.s2}.</p>
        </div>
        {PANELS.map((p) => {
          const st = data?.states.find((s) => s.name.toLowerCase() === p.region.toLowerCase());
          return (
            <article key={p.name} className="journey-panel md:w-[min(46vw,620px)] md:shrink-0">
              <div className="journey-frame relative aspect-[4/3] overflow-hidden rounded-[20px] bg-[#c9d3d0]">
                <div className="journey-img absolute inset-[-6%] will-change-transform">
                  <TileMosaic mosaic={p.mosaic} layer="s2" className="!absolute left-1/2 top-1/2 w-[112%] -translate-x-1/2 -translate-y-1/2" alt={`Satellite image of ${p.name}`} />
                </div>
              </div>
              <div className="mt-5 flex items-baseline justify-between gap-4">
                <h3 className="landing-display text-[clamp(2rem,3.4vw,3rem)]">{p.name}</h3>
                <span className="text-sm text-[#3f5157]">{p.region}</span>
              </div>
              <p className="mt-2 max-w-[44ch] text-[#2c3c42]">{p.note}</p>
              <p className="mt-3 text-sm text-[#3f5157]">
                {data ? (st && st.active > 0 ? `${p.region} now: ${st.active} active official alert${st.active === 1 ? "" : "s"}.` : `${p.region} now: no active official alerts.`) : "Checking live alerts…"}
              </p>
              <Link href={map3dLink(p)} className="landing-link landing-link-dark mt-4 inline-block">Open {p.name} in the 3D map</Link>
            </article>
          );
        })}
      </div>
    </section>
  );
}