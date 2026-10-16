"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BadgeCheck, CircleAlert, Clock3, Eye, Landmark, Loader2, Phone, RefreshCw, Route, Sparkles, Siren } from "lucide-react";
import type { NextAction, NextSteps } from "@/lib/core/next-steps";
import type { Place } from "@/lib/core/types";
import { cn } from "@/lib/utils";
import { apiFetch, type ApiError } from "@/hooks/use-api";
import { usePrefs } from "@/hooks/use-local-state";
import { ListenButton } from "@/components/shared/listen-button";
import { ErrorState, SourceLink } from "@/components/shared/status";
import { Badge, Button, Skeleton } from "@/components/ui/primitives";

export const HOUSEHOLD_KEY = "anvil.household.v1";

const PRIORITY_STYLE: Record<NextSteps["priority"], { panel: string; label: string; icon: React.ComponentType<{ className?: string }> }> = {
  ACT_NOW: { panel: "panel panel-danger", label: "ACT NOW", icon: Siren },
  PREPARE: { panel: "panel panel-warning", label: "PREPARE", icon: CircleAlert },
  STAY_INFORMED: { panel: "panel panel-ok", label: "STAY INFORMED", icon: BadgeCheck },
  UNKNOWN: { panel: "panel", label: "STATUS UNKNOWN", icon: CircleAlert },
};

const AUTH: Record<NextAction["authority"], { tone: "danger" | "ok" | "neutral"; label: string; icon: React.ComponentType<{ className?: string }> }> = {
  OFFICIAL: { tone: "danger", label: "Official instruction", icon: Landmark },
  VERIFIED: { tone: "ok", label: "Verified official page", icon: BadgeCheck },
  GUIDANCE: { tone: "neutral", label: "ANVIL guidance", icon: Sparkles },
};

const WHEN_LABEL: Record<NextAction["when"], string> = { now: "Do now", next_hours: "Next few hours", today: "Today" };

/**
 * Practical next steps, recomputed from the live feed every 5 minutes.
 * Official instructions always come first; ANVIL guidance never overrides them.
 */
export function ActionCenter({ place, compact = false }: { place: Place; compact?: boolean }) {
  const [prefs] = usePrefs();
  const [data, setData] = useState<NextSteps | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [showAll, setShowAll] = useState(!compact);

  useEffect(() => {
    let household: unknown = null;
    try {
      household = JSON.parse(localStorage.getItem(HOUSEHOLD_KEY) ?? "null");
    } catch {
      household = null;
    }
    const c = new AbortController();
    setLoading(true);
    apiFetch<{ steps: NextSteps }>("/api/next-steps", {
      method: "POST",
      signal: c.signal,
      body: JSON.stringify({ place: { label: place.label, district: place.district, state: place.state }, household, language: prefs.language }),
    })
      .then((r) => {
        setData(r.steps);
        setError(null);
      })
      .catch((e: ApiError) => {
        if (e.code !== "ABORTED") setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    const t = setTimeout(() => setTick((n) => n + 1), 5 * 60_000);
    return () => {
      c.abort();
      clearTimeout(t);
    };
  }, [place.label, place.district, place.state, prefs.language, tick]);

  const grouped = useMemo(() => {
    const g: Record<NextAction["when"], NextAction[]> = { now: [], next_hours: [], today: [] };
    for (const a of data?.actions ?? []) g[a.when].push(a);
    return g;
  }, [data]);

  if (loading && !data) return <Skeleton className="h-64" />;
  if (error && !data) return <ErrorState message={error} onRetry={() => setTick((n) => n + 1)} />;
  if (!data) return null;

  const P = PRIORITY_STYLE[data.priority];
  const visibleActions = showAll ? data.actions : data.actions.slice(0, 5);

  return (
    <section className={cn(P.panel, "p-4")} aria-labelledby="ac-title">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="label-caps">Next steps · {P.label}</p>
          <h2 id="ac-title" className="mt-1 flex items-start gap-2 text-base font-semibold leading-snug">
            <P.icon className="mt-0.5 size-5 shrink-0" />
            {data.headline}
          </h2>
        </div>
        <Button size="icon" variant="ghost" aria-label="Recompute next steps" onClick={() => setTick((n) => n + 1)} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        </Button>
      </div>
      {data.basis.length ? <p className="mt-1 text-xs text-muted-foreground">{data.basis.join(" ")}</p> : null}

      <ol className="mt-3 space-y-2">
        {(showAll ? (["now", "next_hours", "today"] as const) : (["now", "next_hours", "today"] as const)).map((when) => {
          const list = visibleActions.filter((a) => a.when === when);
          if (!list.length) return null;
          return (
            <li key={when}>
              <p className="label-caps mb-1 flex items-center gap-1"><Clock3 className="size-3" /> {WHEN_LABEL[when]}</p>
              <ul className="space-y-1.5">
                {list.map((a) => {
                  const A = AUTH[a.authority];
                  return (
                    <li key={a.id} className={cn("rounded-md border bg-card/60 p-2.5 text-sm", a.authority === "OFFICIAL" && "border-danger/50")}>
                      <div className="flex items-start gap-2">
                        <input type="checkbox" className="mt-0.5 size-4 shrink-0" aria-label={`Mark done: ${a.text}`} />
                        <div className="min-w-0 flex-1">
                          <p className={cn(a.authority === "OFFICIAL" && "font-medium")}>{a.text}</p>
                          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <Badge tone={A.tone}><A.icon className="size-3" /> {A.label}</Badge>
                            <span>{a.why}</span>
                            {a.sourceUrl ? <SourceLink href={a.sourceUrl} /> : null}
                          </p>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>
      {data.actions.length > 5 ? (
        <Button size="sm" variant="ghost" className="mt-1" onClick={() => setShowAll((s) => !s)}>
          {showAll ? "Show fewer" : `Show all ${data.actions.length} steps`}
        </Button>
      ) : null}

      {!compact ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <p className="label-caps mb-1 flex items-center gap-1"><Eye className="size-3" /> What to monitor next</p>
            <ul className="space-y-1 text-sm">
              {data.monitor.map((m, i) => (
                <li key={i} className="flex flex-wrap gap-1.5">
                  <span>• {m.text}</span>
                  {m.sourceUrl ? <SourceLink href={m.sourceUrl} /> : null}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="label-caps mb-1 flex items-center gap-1"><Phone className="size-3" /> Emergency contacts</p>
            <ul className="space-y-1 text-sm">
              {data.contacts.map((c, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0">{c.label}</span>
                  <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="num font-semibold text-primary">{c.phone}</a>
                </li>
              ))}
            </ul>
            {data.roadClosures.length ? (
              <>
                <p className="label-caps mb-1 mt-3 flex items-center gap-1"><Route className="size-3" /> Official road closures</p>
                <ul className="space-y-1 text-sm">
                  {data.roadClosures.map((r, i) => (
                    <li key={i}>
                      <strong>{r.road}</strong> — {r.status} <SourceLink href={r.sourceUrl} />
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <Link href="/plan" className="text-primary underline">Full plan & household checklist</Link>
          <ListenButton text={[data.headline, ...data.actions.slice(0, 3).map((a) => a.text)].join(". ")} label="Listen" />
        </div>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">
        Generated {new Date(data.generatedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} IST from live official data. Official instructions always override ANVIL guidance. Emergency: <a href="tel:112" className="font-semibold text-danger">112</a>.
      </p>
    </section>
  );
}