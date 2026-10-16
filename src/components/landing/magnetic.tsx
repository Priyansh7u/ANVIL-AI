"use client";

import { useEffect, useRef } from "react";

/**
 * Lets a button lean a few pixels towards a fine pointer. Disabled for touch,
 * keyboard-only use and reduced motion; the click target never moves away.
 */
export function Magnetic({ children, strength = 6 }: { children: React.ReactNode; strength?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ok = window.matchMedia("(pointer: fine) and (prefers-reduced-motion: no-preference)").matches;
    if (!ok) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => (el.style.transform = `translate(${dx * strength}px, ${dy * strength}px)`));
    };
    const leave = () => {
      cancelAnimationFrame(raf);
      el.style.transform = "";
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      cancelAnimationFrame(raf);
    };
  }, [strength]);
  return (
    <span ref={ref} className="inline-block transition-transform duration-300 ease-out motion-reduce:transition-none">
      {children}
    </span>
  );
}