"use client";

import { useEffect } from "react";
import { useApi } from "@/hooks/use-api";
import type { NationalResponse } from "@/types/national";
import { ensureGsap } from "@/components/landing/gsap";
import { MotionConfig } from "motion/react";
import { Capabilities } from "@/components/landing/capabilities";
import { Evidence } from "@/components/landing/evidence";
import { FloodScene } from "@/components/landing/flood-scene";
import { Hero } from "@/components/landing/hero";
import { Journey } from "@/components/landing/journey";
import { LandingHeader } from "@/components/landing/landing-header";
import { LayerStack } from "@/components/landing/layer-stack";
import { LiveNow } from "@/components/landing/live-now";
import { Pipeline } from "@/components/landing/pipeline";
import { Problem } from "@/components/landing/problem";
import { StatsBand } from "@/components/landing/stats-band";

/**
 * The public landing page, told as a sequence of scenes:
 * a live 3D globe that flies into India → the numbers right now → the last-mile gap →
 * four capabilities → one place in layers → a labelled what-if → how it works →
 * six places → evidence → the live feed. Every number on it comes from the live official feed.
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
    <MotionConfig reducedMotion="user">
      <main className="landing landing-grain min-h-dvh bg-[var(--l-bg)]">
        <a href="#scenes" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-black">Skip to content</a>
        <LandingHeader />
        <Hero data={data} />
        <div id="scenes">
          <StatsBand data={data} />
          <Problem />
          <Capabilities data={data} />
          <LayerStack data={data} />
          <FloodScene />
          <Pipeline />
          <Journey data={data} />
          <Evidence />
          <LiveNow data={data} />
        </div>
      </main>
    </MotionConfig>
  );
}