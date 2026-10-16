"use client";

import { useEffect, useState } from "react";
import type { DataMode } from "@/lib/core/types";
import { relativeTime } from "@/lib/core/freshness";
import { cn } from "@/lib/utils";

/** Top status strip: live IST clock, feed health and live counters. All values come from the latest API responses. */
export function CommandStrip({
  placeLabel,
  dataMode,
  retrievedAt,
  stats,
}: {
  placeLabel: string;
  dataMode: DataMode | null;
  retrievedAt: string | null;
  stats: { label: string; value: number | string; tone?: "danger" | "warning" | "ok" }[];
}) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const feedTone = dataMode === "LIVE" ? "text-ok" : dataMode === "UNAVAILABLE" ? "text-danger" : "text-warning";

  return (
    <div className="panel mb-4 flex flex-wrap items-stretch divide-x divide-border overflow-hidden">
      <div className="min-w-[180px] flex-1 px-4 py-3">
        <p className="label-caps">Area of interest</p>
        <p className="truncate text-lg font-semibold">{placeLabel}</p>
      </div>
      <div className="px-4 py-3">
        <p className="label-caps">Local time · IST</p>
        <p className="num text-lg font-semibold" suppressHydrationWarning>
          {now ? now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }) : "--:--:--"}
        </p>
      </div>
      <div className="px-4 py-3">
        <p className="label-caps">Official feed</p>
        <p className={cn("flex items-center gap-2 text-sm font-semibold", feedTone)}>
          <span className="live-dot" aria-hidden />
          {dataMode ?? "connecting"}
          <span className="num text-xs font-normal text-muted-foreground">{retrievedAt ? `checked ${relativeTime(retrievedAt)}` : ""}</span>
        </p>
      </div>
      {stats.map((s) => (
        <div key={s.label} className="px-4 py-3">
          <p className="label-caps">{s.label}</p>
          <p className={cn("num text-lg font-semibold", s.tone === "danger" && "text-danger", s.tone === "warning" && "text-warning", s.tone === "ok" && "text-ok")}>{s.value}</p>
        </div>
      ))}
    </div>
  );
}