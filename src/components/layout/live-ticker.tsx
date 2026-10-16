"use client";

import { useApi } from "@/hooks/use-api";
import { relativeTime } from "@/lib/core/freshness";
import { SEVERITY_COLOR } from "@/types/api";
import type { NationalResponse } from "@/types/national";

/**
 * Thin live strip under the header: the latest active official alerts from
 * anywhere in India. Pauses on hover/focus; static under reduced motion.
 */
export function LiveTicker() {
  const { data } = useApi<NationalResponse>("/api/national", { refreshMs: 3 * 60_000 });
  const items = data?.latest.slice(0, 14) ?? [];
  if (!data) return <div className="h-8 border-b bg-panel" aria-hidden />;
  if (items.length === 0) {
    return (
      <div className="flex h-8 items-center border-b bg-panel px-4 text-xs text-muted-foreground">
        {data.feed.dataMode === "UNAVAILABLE" ? "Official feed unavailable — check sachet.ndma.gov.in" : "No active official alerts in India right now."}
      </div>
    );
  }
  const row = (key: string) => (
    <span key={key} className="flex items-center" aria-hidden={key === "b" ? true : undefined}>
      {items.map((a) => (
        <a key={`${key}-${a.id}`} href={a.capUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-5 hover:underline" tabIndex={key === "b" ? -1 : 0}>
          <span className="inline-block size-2 rounded-full" style={{ background: SEVERITY_COLOR[a.severity] }} />
          <span className="font-semibold">{a.issuer}</span>
          <span className="max-w-[46ch] truncate text-muted-foreground">{a.headline}</span>
          <span className="num text-[11px] text-muted-foreground">{relativeTime(a.issuedAt)}</span>
        </a>
      ))}
    </span>
  );
  return (
    <div className="ticker relative flex h-8 items-center overflow-hidden border-b bg-panel text-xs" role="region" aria-label="Latest official alerts across India">
      <span className="z-10 flex h-full shrink-0 items-center gap-2 border-r bg-panel px-3 font-semibold text-danger">
        <span className="live-dot" aria-hidden /> Live
        <span className="num font-normal text-muted-foreground">{data.totals.active}</span>
      </span>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="ticker-track">
          {row("a")}
          {row("b")}
        </div>
      </div>
    </div>
  );
}