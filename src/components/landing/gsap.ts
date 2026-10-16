"use client";

import { useEffect, useLayoutEffect, type RefObject } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

let registered = false;
export function ensureGsap() {
  if (!registered && typeof window !== "undefined") {
    gsap.registerPlugin(ScrollTrigger);
    registered = true;
  }
  return { gsap, ScrollTrigger };
}

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Runs GSAP setup inside a gsap.context scoped to `scope`, with a matchMedia
 * that only animates when the user hasn't asked for reduced motion. Everything
 * created inside is reverted on unmount or when deps change, so React and GSAP
 * never fight over the same elements.
 */
export function useScrollScene(
  scope: RefObject<HTMLElement | null>,
  setup: (ctx: { gsap: typeof gsap; ScrollTrigger: typeof ScrollTrigger; isDesktop: boolean }) => void | (() => void),
  deps: unknown[] = [],
) {
  useIsoLayoutEffect(() => {
    if (!scope.current) return;
    const { gsap: g, ScrollTrigger: st } = ensureGsap();
    const mm = g.matchMedia(scope.current);
    mm.add(
      { motion: "(prefers-reduced-motion: no-preference)", desktop: "(min-width: 768px)" },
      (c) => {
        const { motion, desktop } = c.conditions as { motion: boolean; desktop: boolean };
        if (!motion) return;
        return setup({ gsap: g, ScrollTrigger: st, isDesktop: desktop });
      },
    );
    return () => mm.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller controls deps
  }, deps);
}

/** Recalculate trigger positions once images have settled the layout. */
export function refreshSoon() {
  if (typeof window === "undefined") return;
  const { ScrollTrigger: st } = ensureGsap();
  clearTimeout((refreshSoon as unknown as { t?: number }).t);
  (refreshSoon as unknown as { t?: number }).t = window.setTimeout(() => st.refresh(), 150);
}