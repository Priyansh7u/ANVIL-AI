"use client";

import { useEffect, useRef, useState } from "react";
import { animate, motion, useInView, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";
import { cn } from "@/lib/utils";

/** Shared motion tokens: one easing family, durations by role. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
export const DUR = { quick: 0.25, base: 0.6, slow: 1.1 } as const;

/** Fades and lifts its children once they scroll into view. */
export function Reveal({ children, className, delay = 0, y = 28 }: { children: React.ReactNode; className?: string; delay?: number; y?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      transition={{ duration: DUR.base + 0.2, ease: EASE_OUT, delay }}
    >
      {children}
    </motion.div>
  );
}

/** Headline whose lines rise out of a mask, staggered. */
export function MaskLines({ lines, className, delay = 0 }: { lines: string[]; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <span className={className}>
      {lines.map((l, i) => (
        <span key={i} className="block overflow-hidden pb-[0.08em]">
          <motion.span
            className="block"
            initial={reduce ? false : { y: "110%" }}
            animate={{ y: "0%" }}
            transition={{ duration: DUR.slow, ease: EASE_OUT, delay: delay + i * 0.12 }}
          >
            {l}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

function Word({ word, progress, start, end }: { word: string; progress: MotionValue<number>; start: number; end: number }) {
  const opacity = useTransform(progress, [start, end], [0.16, 1]);
  return (
    <motion.span style={{ opacity }} className="inline-block whitespace-pre">
      {word}{" "}
    </motion.span>
  );
}

/** A paragraph that lights up word by word as it crosses the viewport. */
export function ScrollWords({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 85%", "end 45%"] });
  const words = text.split(/\s+/).filter(Boolean);
  if (reduce) return <p ref={ref} className={className}>{text}</p>;
  return (
    <p ref={ref} className={className} aria-label={text}>
      <span aria-hidden>
        {words.map((w, i) => (
          <Word key={i} word={w} progress={scrollYProgress} start={i / words.length} end={Math.min(1, (i + 1.5) / words.length)} />
        ))}
      </span>
    </p>
  );
}

/** A number that counts to its live value when seen, and re-animates when the value changes. */
export function Counter({ value, className, format = (n: number) => Math.round(n).toLocaleString("en-IN") }: { value: number | null | undefined; className?: string; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);
  const last = useRef(0);
  useEffect(() => {
    if (value == null || !inView) return;
    if (reduce) {
      last.current = value;
      setShown(value);
      return;
    }
    const controls = animate(last.current, value, {
      duration: 1.4,
      ease: EASE_OUT,
      onUpdate: (v) => {
        last.current = v;
        setShown(v);
      },
    });
    return () => controls.stop();
  }, [value, inView, reduce]);
  return (
    <span ref={ref} className={cn("num", className)}>
      {value == null ? "—" : format(shown)}
    </span>
  );
}

/**
 * A card that tilts toward a fine pointer and carries a soft spotlight under it.
 * Purely decorative motion: the card's content and link work without it.
 */
export function SpotlightCard({ children, className, glow = "rgba(240,163,58,0.18)" }: { children: React.ReactNode; className?: string; glow?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const rx = useSpring(useMotionValue(0), { stiffness: 180, damping: 18 });
  const ry = useSpring(useMotionValue(0), { stiffness: 180, damping: 18 });
  const [fine, setFine] = useState(false);
  useEffect(() => setFine(window.matchMedia("(pointer: fine)").matches), []);
  const active = fine && !reduce;

  return (
    <motion.div
      ref={ref}
      className={cn("group relative overflow-hidden [transform-style:preserve-3d]", className)}
      style={active ? { rotateX: rx, rotateY: ry, transformPerspective: 1000 } : undefined}
      onPointerMove={(e) => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        el.style.setProperty("--sx", `${px * 100}%`);
        el.style.setProperty("--sy", `${py * 100}%`);
        if (active) {
          rx.set((0.5 - py) * 6);
          ry.set((px - 0.5) * 8);
        }
      }}
      onPointerLeave={() => {
        rx.set(0);
        ry.set(0);
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: `radial-gradient(420px circle at var(--sx, 50%) var(--sy, 50%), ${glow}, transparent 60%)` }}
      />
      {children}
    </motion.div>
  );
}

/** Thin progress bar for the whole page, sprung so it never jitters. */
export function ScrollProgress({ className }: { className?: string }) {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.3 });
  return <motion.div aria-hidden className={cn("origin-left", className)} style={{ scaleX }} />;
}

/** True on viewports ≥ the given width; false during SSR and first paint. */
export function useMinWidth(px: number) {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${px}px)`);
    const on = () => setOk(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [px]);
  return ok;
}