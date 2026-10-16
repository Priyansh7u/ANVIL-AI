"use client";

import Link from "next/link";
import { BadgeCheck, Bot, FlaskConical, MapPinned, MessagesSquare, Route } from "lucide-react";
import { relativeTime } from "@/lib/core/freshness";
import { cn } from "@/lib/utils";
import { useApi } from "@/hooks/use-api";
import { SEVERITY_COLOR } from "@/types/api";
import type { NationalResponse } from "@/types/national";
import { NationalMap } from "@/components/national/national-map";
import { buttonVariants } from "@/components/ui/primitives";

const CAPABILITIES = [
  { icon: BadgeCheck, title: "Official alerts, matched to your district", body: "Common Alerting Protocol messages from NDMA SACHET — issued by IMD, CWC and state authorities — with issue, retrieval and expiry times on every one." },
  { icon: Bot, title: "Research that has to show its source", body: "An agent reads only government websites. A shelter or phone number is kept only if the exact sentence is found on the page." },
  { icon: Route, title: "Routes measured against live alert areas", body: "Alternative roads are ranked by how many kilometres pass through active alert areas. None is ever called safe." },
  { icon: MessagesSquare, title: "Ask in Hindi or English, by voice", body: "Answers come only from cited official sources. An answer with a number that isn't in the sources is discarded." },
  { icon: FlaskConical, title: "Rehearse decisions before they're real", body: "Close a shelter or a road in your own district and watch the response plan rebalance. Always labelled as a simulation." },
  { icon: MapPinned, title: "Watch the places you care about", body: "Draw a radius around home, a school or a parent's village and get notified when an official alert covers it." },
];

export default function LandingPage() {
  const { data } = useApi<NationalResponse>("/api/national", { refreshMs: 3 * 60_000 });
  const top = data?.states.filter((s) => s.active > 0).slice(0, 5) ?? [];
  const live = data?.feed.dataMode === "LIVE" || data?.feed.dataMode === "STALE";

  return (
    <main className="min-h-dvh">
      {/* Hero: the live national picture is the first thing you see. */}
      <section className="relative isolate min-h-[92dvh] overflow-hidden border-b" aria-label="Live national situation">
        <div className="absolute inset-0 -z-10">
          <NationalMap data={data} interactive={false} className="h-full min-h-[92dvh] w-full" />
        </div>
        <div className="hero-scrim pointer-events-none absolute inset-0 -z-0" aria-hidden />

        <div className="pointer-events-none relative mx-auto flex min-h-[92dvh] max-w-7xl flex-col justify-between px-4 py-6 sm:px-8">
          <header className="pointer-events-auto flex items-center justify-between">
            <span className="flex items-center gap-2">
              <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
                <rect width="32" height="32" rx="8" fill="var(--primary)" />
                <path d="M6 11h17c0 2.8 1.6 4.4 3 5v1h-6l-1.5 3H21v3H11v-3h2.5L12 17H9c-1.7 0-3-1.3-3-3z" fill="var(--primary-foreground)" />
              </svg>
              <span className="text-xl font-extrabold" style={{ fontStretch: "80%" }}>ANVIL</span>
            </span>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/national" className="hidden text-muted-foreground hover:text-foreground sm:inline">National picture</Link>
              <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">Open command center</Link>
            </nav>
          </header>

          <div className="pointer-events-auto max-w-xl py-10">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className={cn("live-dot", live ? "text-danger" : "text-warning")} aria-hidden />
              {data ? (live ? `Live from NDMA SACHET · updated ${relativeTime(data.feed.retrievedAt)}` : "Official feed unreachable — showing what was last retrieved") : "Connecting to the official alert feed…"}
            </p>
            <h1 className="display mt-4 text-[clamp(3rem,9vw,6.5rem)]">
              <span className="num">{data ? data.totals.active : "—"}</span> official alerts
              <br />
              active across <span className="num">{data ? data.totals.statesAffected : "—"}</span> states
            </h1>
            <p className="mt-5 max-w-md text-base text-muted-foreground sm:text-lg">
              ANVIL turns India&apos;s official warnings into next steps for your district — with the source behind every line, and a plain “we don&apos;t know” when there isn&apos;t one.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/onboarding" className={cn(buttonVariants({ size: "lg" }))}>Check my district</Link>
              <Link href="/national" className={cn(buttonVariants({ size: "lg", variant: "outline" }), "bg-background/60")}>See every state</Link>
            </div>
          </div>

          <div className="pointer-events-auto grid gap-2 sm:max-w-xl">
            {top.length ? (
              <>
                <p className="text-xs text-muted-foreground">Most alerts right now</p>
                <ul className="flex flex-wrap gap-2">
                  {top.map((s) => (
                    <li key={s.code} className="flex items-center gap-2 rounded-full border bg-background/75 px-3 py-1 text-sm backdrop-blur">
                      <span className="inline-block size-2.5 rounded-full" style={{ background: SEVERITY_COLOR[s.maxSeverity] }} />
                      {s.name}
                      <span className="num">{s.active}</span>
                      {s.escalation.escalating ? <span className="text-xs font-semibold text-danger">surging</span> : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <p className="text-xs text-muted-foreground">
              In an emergency call <a className="font-semibold text-danger" href="tel:112">112</a>. ANVIL supports official instructions and never overrides them.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-8" aria-labelledby="what-h">
        <h2 id="what-h" className="display max-w-2xl text-4xl sm:text-5xl">What ANVIL does with the warnings</h2>
        <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="border-t pt-5">
              <Icon className="size-5 text-primary" aria-hidden />
              <h3 className="mt-3 text-lg font-semibold leading-snug">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:justify-between sm:px-8">
          <span>Alert data: NDMA SACHET public CAP feed. Maps © OpenStreetMap contributors.</span>
          <span>ANVIL is a hackathon prototype, not an official government service.</span>
        </div>
      </footer>
    </main>
  );
}