"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { loadElevationGrid } from "@/components/map3d/elevation";
import { hillshadeRGBA } from "@/lib/landing/hillshade";
import { IMAGERY_CREDIT, map3dLink, mosaicFor, positionIn } from "@/lib/landing/imagery";
import { SEVERITY_COLOR } from "@/types/api";
import type { NationalResponse } from "@/types/national";
import { refreshSoon, useScrollScene } from "./gsap";
import { TileMosaic } from "./tile-mosaic";

// The Ganga plain around Patna: one of the most flood-exposed stretches in India.
const MOSAIC = mosaicFor({ west: 84.75, south: 25.3, east: 85.65, north: 25.9 }, 10);
const PATNA = positionIn(MOSAIC, 85.14, 25.61);

const LAYERS = [
  { key: "alerts", title: "Official alerts", body: "Live CAP messages from NDMA SACHET, matched to the district." },
  { key: "roads", title: "Roads and places", body: "OpenStreetMap, used to measure routes and exposed streets." },
  { key: "terrain", title: "Terrain", body: "Real elevation, so low ground and river channels are visible." },
  { key: "imagery", title: "Satellite imagery", body: "Sentinel-2 cloudless, the ground as it looks from orbit." },
] as const;

export function LayerStack({ data }: { data: NationalResponse | null }) {
  const root = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [terrainOk, setTerrainOk] = useState<boolean | null>(null);
  const bihar = data?.states.find((s) => s.code === "BR") ?? null;

  // Terrain layer computed in the browser from real elevation tiles.
  useEffect(() => {
    const c = new AbortController();
    loadElevationGrid(MOSAIC.bounds, 288, Math.round((288 * MOSAIC.rows) / MOSAIC.cols), c.signal)
      .then(({ grid, failedTiles, tiles }) => {
        if (failedTiles === tiles) throw new Error("no elevation");
        const cv = canvas.current;
        if (!cv) return;
        cv.width = grid.cols;
        cv.height = grid.rows;
        cv.getContext("2d")?.putImageData(new ImageData(hillshadeRGBA(grid, 18), grid.cols, grid.rows), 0, 0);
        setTerrainOk(true);
        refreshSoon();
      })
      .catch(() => setTerrainOk(false));
    return () => c.abort();
  }, []);

  useScrollScene(root, ({ gsap, isDesktop }) => {
    const layers = gsap.utils.toArray<HTMLElement>(".stack-layer");
    const steps = gsap.utils.toArray<HTMLElement>(".stack-step");
    const gap = isDesktop ? 120 : 60;
    // Exploded view: each layer floats above the next.
    layers.forEach((l, i) => gsap.set(l, { z: (layers.length - 1 - i) * gap }));
    gsap.set(".stack-stage", { rotateX: 56, rotateZ: -32, scale: isDesktop ? 0.78 : 0.7 });
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: root.current,
        start: isDesktop ? "top top" : "top 70%",
        end: isDesktop ? "+=170%" : "bottom 30%",
        scrub: 0.8,
        pin: isDesktop ? ".stack-pin" : false,
        invalidateOnRefresh: true,
        onUpdate: (self) => {
          // Highlight the layer being described, top to bottom, as the stack settles.
          const idx = Math.min(steps.length - 1, Math.floor(self.progress * steps.length * 0.999));
          steps.forEach((s, i) => s.toggleAttribute("data-active", i === idx));
        },
      },
    });
    tl.to(".stack-stage", { rotateX: 0, rotateZ: 0, scale: 1, ease: "power2.inOut", duration: 1 }, 0);
    layers.forEach((l, i) => tl.to(l, { z: 0, ease: "power2.inOut", duration: 0.7 }, 0.1 + i * 0.07));
    tl.fromTo(".stack-label", { opacity: 0 }, { opacity: 1, duration: 0.2 }, 0.85);
  });

  return (
    <section ref={root} className="relative bg-[var(--l-bg)] text-[var(--l-ink)]" aria-labelledby="stack-h">
      <div className="stack-pin mx-auto grid min-h-[100svh] max-w-7xl items-center gap-10 px-5 py-20 sm:px-10 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div>
          <h2 id="stack-h" className="landing-display text-[clamp(2.4rem,5.5vw,4.6rem)]">One place, read in four layers.</h2>
          <p className="mt-4 max-w-[44ch] text-[#b8c4c1]">The 3D map stacks what is known about a place, so a warning is never read without the ground it falls on.</p>
          <ol className="mt-8 space-y-1">
            {LAYERS.map((l) => (
              <li key={l.key} className="stack-step group rounded-xl border-l-2 border-white/10 py-2.5 pl-4 transition-colors data-[active]:border-[#f0a33a]">
                <p className="text-lg font-semibold text-[#8fa0a0] transition-colors group-data-[active]:text-[#edf1ee]">{l.title}</p>
                <p className="text-sm text-[#7e8f8f] transition-colors group-data-[active]:text-[#b8c4c1]">{l.body}</p>
              </li>
            ))}
          </ol>
          <Link href={map3dLink({ lat: 25.61, lon: 85.14 }, 13.5)} className="landing-link mt-8 inline-block">Explore Patna in the 3D map</Link>
        </div>

        <div className="relative [perspective:1800px]">
          <div className="stack-stage relative mx-auto aspect-square w-full max-w-[560px] [transform-style:preserve-3d]">
            {/* Bottom to top: imagery, terrain, roads, alerts. */}
            <div className="stack-layer absolute inset-0 overflow-hidden rounded-2xl shadow-[0_40px_80px_-30px_rgba(0,0,0,0.8)]">
              <TileMosaic mosaic={MOSAIC} layer="s2" className="h-full w-full" alt="Sentinel-2 imagery of Patna and the Ganga" />
            </div>
            <div className="stack-layer absolute inset-0 overflow-hidden rounded-2xl opacity-90 mix-blend-luminosity">
              <canvas ref={canvas} className="h-full w-full" aria-hidden />
              {terrainOk === false ? <p className="absolute inset-0 grid place-items-center text-sm text-[#b8c4c1]">Elevation tiles unavailable right now.</p> : null}
            </div>
            <div className="stack-layer absolute inset-0 overflow-hidden rounded-2xl opacity-70 mix-blend-screen">
              <TileMosaic mosaic={MOSAIC} layer="osm" className="h-full w-full" imgClassName="[filter:invert(1)_hue-rotate(180deg)_saturate(0.4)_brightness(0.9)]" />
            </div>
            <div className="stack-layer absolute inset-0 rounded-2xl ring-1 ring-white/15">
              <span className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${PATNA.x * 100}%`, top: `${PATNA.y * 100}%` }}>
                <span className="landing-pulse block size-5 rounded-full" style={{ background: bihar && bihar.active ? SEVERITY_COLOR[bihar.maxSeverity] : "#5cc8be", color: bihar && bihar.active ? SEVERITY_COLOR[bihar.maxSeverity] : "#5cc8be" }} />
              </span>
              <p className="stack-label absolute bottom-4 left-4 right-4 rounded-xl bg-[#0d1a26]/85 px-3 py-2 text-sm backdrop-blur-sm">
                {data ? (bihar && bihar.active ? `Bihar now: ${bihar.active} active official alert${bihar.active === 1 ? "" : "s"}, highest severity ${bihar.maxSeverity.toLowerCase()}.` : "Bihar now: no active official alerts.") : "Loading live alerts…"}
              </p>
            </div>
          </div>
          <p className="mt-6 text-center text-xs text-[#7e8f8f]">{IMAGERY_CREDIT.s2}. Elevation © Mapterhorn. {IMAGERY_CREDIT.osm}.</p>
        </div>
      </div>
    </section>
  );
}