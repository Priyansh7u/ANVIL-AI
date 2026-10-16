"use client";

import { useEffect } from "react";
import { useApi } from "@/hooks/use-api";
import type { NationalResponse } from "@/types/national";
import { ensureGsap } from "@/components/landing/gsap";
import { Evidence } from "@/components/landing/evidence";
import { FloodScene } from "@/components/landing/flood-scene";
import { Hero } from "@/components/landing/hero";
import { Journey } from "@/components/landing/journey";
import { LandingHeader } from "@/components/landing/landing-header";
import { LayerStack } from "@/components/landing/layer-stack";
import { LiveNow } from "@/components/landing/live-now";

/**
 * The public landing page, told as a sequence of scenes:
 * today over India → one place in layers → a labelled what-if → six places → evidence → live feed.
 * Every number on it comes from the live official feed.
 */
export default function LandingPage() {
  const { data } = useApi<NationalResponse>("/api/national", { refreshMs: 3 * 60_000 });

  // Re-measure scroll scenes once fonts and live data have changed the layout.
  useEffect(() => {
    const { ScrollTrigger } = ensureGsap();
    const t = setTimeout(() => ScrollTrigger.refresh(), 300);
    return () => clearTimeout(t);
  }, [data]);
  useEffect(() => {
    const { ScrollTrigger } = ensureGsap();
    void document.fonts?.ready.then(() => ScrollTrigger.refresh());
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = "auto";
    };
  }, []);

  return (
    <main className="landing min-h-dvh bg-[#0d1a26]">
      <a href="#scenes" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-black">Skip to content</a>
      <LandingHeader />
      <Hero data={data} />
      <div id="scenes">
        <LayerStack data={data} />
        <FloodScene />
        <Journey data={data} />
        <Evidence />
        <LiveNow data={data} />
      </div>
    </main>
  );
}