"use client";

import Link from "next/link";
import { ArrowUpRight, Bell, ClipboardList, FlaskConical, Globe2, HeartHandshake, Hospital, Mountain, Radar, Route, TriangleAlert } from "lucide-react";
import type { NationalResponse } from "@/types/national";
import { SEVERITY_COLOR } from "@/types/api";
import { Counter, Reveal, SpotlightCard } from "./motion-kit";

type Feature = { href: string; label: string; icon: typeof Bell };

const VERBS: { id: string; verb: string; line: string; tone: string; glow: string; span: string; features: Feature[] }[] = [
  {
    id: "predict",
    verb: "Predict",
    line: "See what is coming, ranked by what matters to you.",
    tone: "var(--l-accent)",
    glow: "rgba(240,163,58,0.2)",
    span: "lg:col-span-4",
    features: [
      { href: "/alerts", label: "Live official alerts", icon: TriangleAlert },
      { href: "/national", label: "National situation room", icon: Globe2 },
      { href: "/research", label: "Live research agent", icon: Radar },
    ],
  },
  {
    id: "protect",
    verb: "Protect",
    line: "A household plan in Hindi or English, and watch areas for the people you love.",
    tone: "var(--l-teal)",
    glow: "rgba(92,200,190,0.2)",
    span: "lg:col-span-2",
    features: [
      { href: "/plan", label: "Safety plan", icon: ClipboardList },
      { href: "/watch", label: "Smart alerts", icon: Bell },
    ],
  },
  {
    id: "respond",
    verb: "Respond",
    line: "Documented shelters, nearby help and hazard-aware routes.",
    tone: "#7fb2ff",
    glow: "rgba(127,178,255,0.2)",
    span: "lg:col-span-2",
    features: [
      { href: "/nearby", label: "Nearby help", icon: Hospital },
      { href: "/map", label: "Map & routes", icon: Route },
      { href: "/map3d", label: "3D disaster map", icon: Mountain },
    ],
  },
  {
    id: "recover",
    verb: "Recover",
    line: "Know your family is safe, and test what-if scenarios — always labelled as simulations.",
    tone: "#b9a2ff",
    glow: "rgba(185,162,255,0.2)",
    span: "lg:col-span-4",
    features: [
      { href: "/family", label: "Family check-in", icon: HeartHandshake },
      { href: "/simulator", label: "What-if simulator", icon: FlaskConical },
    ],
  },
];

/** Predict · Protect · Respond · Recover — each card opens the real screen. */
export function Capabilities({ data }: { data: NationalResponse | null }) {
  const top = [...(data?.states ?? [])].filter((s) => s.active > 0).sort((a, b) => b.active - a.active).slice(0, 7);
  const peak = Math.max(1, ...top.map((s) => s.active));

  return (
    <section className="relative overflow-hidden bg-[var(--l-bg)] text-[var(--l-ink)]" aria-labelledby="cap-h">
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(240,163,58,0.12),transparent)]" />
      <div className="relative mx-auto max-w-7xl px-5 pb-28 sm:px-10 sm:pb-36">
        <Reveal>
          <p className="text-sm font-semibold text-[var(--l-accent)]">One app, four moments</p>
          <h2 id="cap-h" className="landing-display mt-4 max-w-[16ch] text-[clamp(2.4rem,5.6vw,4.8rem)]">Predict. Protect. Respond. Recover.</h2>
        </Reveal>

        <div className="mt-14 grid gap-5 lg:grid-cols-6">
          {VERBS.map((v, i) => (
            <Reveal key={v.id} delay={i * 0.07} className={v.span}>
              <SpotlightCard glow={v.glow} className="flex h-full flex-col rounded-[28px] border border-white/10 bg-[var(--l-card)] p-7 sm:p-9">
                <div className="flex items-start justify-between gap-6">
                  <div>
                    <h3 className="landing-display text-[clamp(2.2rem,3.6vw,3.2rem)]" style={{ color: v.tone }}>{v.verb}</h3>
                    <p className="mt-3 max-w-[36ch] text-[var(--l-soft)]">{v.line}</p>
                  </div>
                  {v.id === "predict" ? (
                    <div className="text-right">
                      <Counter value={data?.totals.active} className="block text-5xl leading-none" />
                      <span className="mt-1 block text-xs text-[var(--l-mute)]">active now</span>
                    </div>
                  ) : null}
                </div>

                {v.id === "predict" && top.length ? (
                  <ul className="mt-8 flex h-28 items-end gap-2" aria-label="States with the most active alerts">
                    {top.map((s) => (
                      <li key={s.code} className="flex flex-1 flex-col items-center gap-2" title={`${s.name}: ${s.active}`}>
                        <span
                          className="w-full origin-bottom rounded-t-lg transition-transform duration-500 group-hover:scale-y-105"
                          style={{ height: `${Math.max(8, (s.active / peak) * 88)}px`, background: SEVERITY_COLOR[s.maxSeverity] }}
                          aria-hidden
                        />
                        <span className="w-full truncate text-center text-[11px] text-[var(--l-mute)]">{s.name}</span>
                        <span className="sr-only">{s.active} active alerts</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {v.id === "protect" ? (
                  <p className="mt-8 flex gap-2 text-sm" aria-hidden>
                    <span className="rounded-full bg-white/10 px-3 py-1.5">English</span>
                    <span className="rounded-full bg-[var(--l-teal-soft)] px-3 py-1.5 text-[var(--l-teal)]">हिन्दी</span>
                  </p>
                ) : null}

                <ul className="mt-auto grid gap-2 pt-8 sm:grid-cols-2">
                  {v.features.map(({ href, label, icon: Icon }) => (
                    <li key={href}>
                      <Link
                        href={href}
                        className="flex min-h-12 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm transition-colors hover:border-white/25 hover:bg-white/[0.07] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--l-accent)]"
                      >
                        <Icon className="size-4 shrink-0" style={{ color: v.tone }} aria-hidden />
                        <span className="flex-1">{label}</span>
                        <ArrowUpRight className="size-4 text-[var(--l-mute)]" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </SpotlightCard>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}