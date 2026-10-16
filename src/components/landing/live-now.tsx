"use client";

import Link from "next/link";
import { useRef } from "react";
import { relativeTime } from "@/lib/core/freshness";
import { SEVERITY_COLOR } from "@/types/api";
import type { NationalResponse } from "@/types/national";
import { useScrollScene } from "./gsap";
import { Magnetic } from "./magnetic";

/** The closing scene: what is actually in the official feed right now, then the way in. */
export function LiveNow({ data }: { data: NationalResponse | null }) {
  const root = useRef<HTMLElement>(null);
  useScrollScene(root, ({ gsap }) => {
    gsap.from(".live-row", { y: 40, opacity: 0, stagger: 0.08, duration: 0.7, ease: "power3.out", scrollTrigger: { trigger: ".live-list", start: "top 80%" } });
    gsap.fromTo(".live-bg", { scale: 1.2 }, { scale: 1, ease: "none", scrollTrigger: { trigger: root.current, start: "top bottom", end: "bottom bottom", scrub: true } });
  });
  const latest = data?.latest.slice(0, 5) ?? [];

  return (
    <section ref={root} className="relative overflow-hidden bg-[#0d1a26] text-[#edf1ee]" aria-labelledby="live-h">
      <div className="live-bg pointer-events-none absolute inset-0 bg-[radial-gradient(80%_60%_at_80%_100%,rgba(240,163,58,0.18),transparent_70%)]" />
      <div className="relative mx-auto max-w-7xl px-5 py-28 sm:px-10">
        <h2 id="live-h" className="landing-display max-w-[16ch] text-[clamp(2.4rem,6vw,5rem)]">Issued by the authorities, in the last few hours.</h2>
        <p className="mt-4 max-w-[52ch] text-[#b8c4c1]">The newest messages in the NDMA SACHET feed as this page loaded. Open one to read the official record.</p>
        <ul className="live-list mt-10 divide-y divide-white/10 border-y border-white/10">
          {latest.length ? (
            latest.map((a) => (
              <li key={a.id} className="live-row">
                <a href={a.capUrl} target="_blank" rel="noopener noreferrer" className="group grid gap-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)_8rem] sm:items-baseline sm:gap-6">
                  <span className="flex items-center gap-2 text-sm text-[#b8c4c1]">
                    <span className="inline-block size-2.5 rounded-full" style={{ background: SEVERITY_COLOR[a.severity] }} aria-hidden />
                    {a.issuer}
                  </span>
                  <span className="text-[#edf1ee] underline-offset-4 group-hover:underline">{a.headline}</span>
                  <span className="text-sm text-[#7e8f8f] sm:text-right">{a.issuedAt ? relativeTime(a.issuedAt) : "time not stated"}</span>
                </a>
              </li>
            ))
          ) : (
            <li className="py-6 text-[#b8c4c1]">{data ? "The official feed returned no recent messages." : "Connecting to the official alert feed…"}</li>
          )}
        </ul>
        <div className="mt-14 flex flex-wrap items-center gap-3">
          <Magnetic>
            <Link href="/onboarding" className="landing-btn landing-btn-primary">Check my district</Link>
          </Magnetic>
          <Magnetic>
            <Link href="/national" className="landing-btn landing-btn-ghost">See every state</Link>
          </Magnetic>
          <p className="ml-1 text-sm text-[#b8c4c1]">
            In an emergency call <a href="tel:112" className="font-semibold text-[#ff8a8f]">112</a>.
          </p>
        </div>
      </div>
      <footer className="relative border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-6 text-xs text-[#7e8f8f] sm:flex-row sm:justify-between sm:px-10">
          <span>Alerts: NDMA SACHET public CAP feed. Imagery: NASA GIBS, Sentinel-2 cloudless by EOX. Maps © OpenStreetMap contributors.</span>
          <span>ANVIL is a hackathon prototype, not an official government service.</span>
        </div>
      </footer>
    </section>
  );
}