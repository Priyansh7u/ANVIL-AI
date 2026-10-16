"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { loadElevationGrid } from "@/components/map3d/elevation";
import { connectedInundation, DEPTH_BANDS, depthBand, SIMULATION_LABEL, type ElevationGrid } from "@/lib/core/geo3d/inundation";
import { IMAGERY_CREDIT, map3dLink, mosaicFor } from "@/lib/landing/imagery";
import { useScrollScene } from "./gsap";
import { TileMosaic } from "./tile-mosaic";

// Patna's riverfront on the Ganga.
const MOSAIC = mosaicFor({ west: 85.05, south: 25.56, east: 85.25, north: 25.68 }, 12);
const MAX_RISE = 8;

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const BAND_RGB = DEPTH_BANDS.map((b) => hexToRgb(b.color));

export function FloodScene() {
  const root = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef<{ grid: ElevationGrid; seed: { col: number; row: number }; ground: number } | null>(null);
  const levelRef = useRef(0);
  const readout = useRef<HTMLSpanElement>(null);
  const area = useRef<HTMLSpanElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const draw = (rise: number) => {
    const g = gridRef.current;
    const cv = canvas.current;
    if (!g || !cv) return;
    const res = connectedInundation(g.grid, g.seed, g.ground + rise);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(g.grid.cols, g.grid.rows);
    for (let i = 0; i < res.mask.length; i++) {
      if (!res.mask[i]) continue;
      const [r, gg, b] = BAND_RGB[depthBand(res.depth[i] as number)] ?? [29, 78, 216];
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = gg;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 170;
    }
    ctx.putImageData(img, 0, 0);
    if (readout.current) readout.current.textContent = `+${rise.toFixed(1)} m`;
    if (area.current) area.current.textContent = `${res.areaKm2.toFixed(1)} km² of connected low ground under water`;
  };

  // Real elevation for this exact view; the water starts from the lowest cell in it.
  useEffect(() => {
    const c = new AbortController();
    const cols = 180;
    const rows = Math.round((cols * MOSAIC.rows) / MOSAIC.cols);
    loadElevationGrid(MOSAIC.bounds, cols, rows, c.signal)
      .then(({ grid, failedTiles, tiles }) => {
        if (failedTiles === tiles) throw new Error("no elevation");
        let best = -1;
        for (let i = 0; i < grid.values.length; i++) {
          const v = grid.values[i] as number;
          if (!Number.isNaN(v) && (best < 0 || v < (grid.values[best] as number))) best = i;
        }
        if (best < 0) throw new Error("no elevation");
        gridRef.current = { grid, seed: { col: best % cols, row: Math.floor(best / cols) }, ground: grid.values[best] as number };
        if (canvas.current) {
          canvas.current.width = cols;
          canvas.current.height = rows;
        }
        setState("ready");
        draw(levelRef.current);
      })
      .catch(() => setState("error"));
    return () => c.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draw only reads refs
  }, []);

  useScrollScene(root, ({ gsap, isDesktop }) => {
    let raf = 0;
    const o = { rise: 0 };
    const tl = gsap.timeline({
      scrollTrigger: { trigger: root.current, start: isDesktop ? "top top" : "top 60%", end: isDesktop ? "+=160%" : "bottom 40%", scrub: 0.6, pin: isDesktop ? ".flood-pin" : false, invalidateOnRefresh: true },
    });
    tl.fromTo(".flood-image", { scale: 1.18 }, { scale: 1, ease: "none", duration: 1 }, 0)
      .to(o, {
        rise: MAX_RISE,
        ease: "none",
        duration: 1,
        onUpdate: () => {
          levelRef.current = o.rise;
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(() => draw(o.rise));
        },
      }, 0)
      .from(".flood-copy > *", { y: 30, opacity: 0, stagger: 0.06, duration: 0.25 }, 0);
    return () => cancelAnimationFrame(raf);
  });

  return (
    <section ref={root} className="relative bg-[#0b1621] text-[#edf1ee]" aria-labelledby="flood-h">
      <div className="flood-pin relative min-h-[100svh] overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
          <div className="flood-image absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 will-change-transform" style={{ width: `max(100vw, calc(100svh * ${MOSAIC.cols} / ${MOSAIC.rows}))` }}>
            <TileMosaic mosaic={MOSAIC} layer="s2" alt="Sentinel-2 imagery of Patna's riverfront" />
            <canvas ref={canvas} className="absolute inset-0 h-full w-full [image-rendering:pixelated]" aria-hidden />
          </div>
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(11,22,33,0.94)_0%,rgba(11,22,33,0.7)_38%,rgba(11,22,33,0.05)_70%)]" />
        </div>

        <div className="flood-copy relative z-10 mx-auto flex min-h-[100svh] max-w-7xl flex-col justify-center px-5 py-20 sm:px-10">
          <p className="w-fit rounded-full border border-[#b794f6]/50 bg-[#2a1d45]/80 px-3 py-1 text-xs font-semibold tracking-wide text-[#d9c6ff]">{SIMULATION_LABEL}</p>
          <h2 id="flood-h" className="landing-display mt-5 max-w-[13ch] text-[clamp(2.4rem,6vw,5rem)]">What if the Ganga rose here?</h2>
          <p className="mt-4 max-w-[46ch] text-[#b8c4c1]">
            Scroll to raise the water. It spreads from the lowest ground in view to every connected cell below its surface, using real elevation for Patna. There is no rainfall, flow or embankment in this model — it shows which ground is low and connected, not what will happen.
          </p>
          <p className="mt-8 flex items-baseline gap-4">
            <span ref={readout} className="landing-display num text-[clamp(3rem,8vw,6rem)] text-[#9ec9ff]">+0.0 m</span>
            <span className="text-sm text-[#b8c4c1]">above the lowest ground</span>
          </p>
          <p className="mt-1 text-sm text-[#d6dedb]">
            <span ref={area}>{state === "loading" ? "Loading real elevation…" : state === "error" ? "Elevation tiles are unavailable right now, so the water can't be modelled." : ""}</span>
          </p>
          <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1">
            {DEPTH_BANDS.map((b) => (
              <span key={b.label} className="flex items-center gap-1.5 text-xs text-[#b8c4c1]">
                <span className="inline-block size-2.5 rounded-sm" style={{ background: b.color }} /> {b.label}
              </span>
            ))}
          </div>
          <Link href={map3dLink({ lat: 25.61, lon: 85.15 }, 13)} className="landing-link mt-8 w-fit">Run your own scenario in the 3D map</Link>
          <p className="mt-10 text-xs text-[#7e8f8f]">{IMAGERY_CREDIT.s2}. Elevation © Mapterhorn, about 30 m resolution.</p>
        </div>
      </div>
    </section>
  );
}