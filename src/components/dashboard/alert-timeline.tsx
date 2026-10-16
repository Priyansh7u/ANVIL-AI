"use client";

import { useEffect, useState } from "react";
import type { NormalizedAlert } from "@/lib/core/types";
import { SEVERITY_COLOR } from "@/types/api";

/**
 * Live alert validity timeline: each official alert is drawn from its issue
 * time to its expiry (open-ended alerts fade out). The red line is "now" and
 * moves every 30 s. Window: 12 h back, 12 h ahead. Real timestamps only.
 */
export function AlertTimeline({ alerts }: { alerts: NormalizedAlert[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const start = now - 12 * 3_600_000;
  const end = now + 12 * 3_600_000;
  const W = 1000;
  const rowH = 18;
  const rows = alerts
    .filter((a) => a.issuedAt && Date.parse(a.issuedAt) < end && (!a.expiresAt || Date.parse(a.expiresAt) > start))
    .slice(0, 12);
  const H = Math.max(56, rows.length * (rowH + 6) + 34);
  const x = (t: number) => ((Math.min(Math.max(t, start), end) - start) / (end - start)) * W;
  const ticks = Array.from({ length: 9 }, (_, i) => start + i * 3 * 3_600_000);
  const fmt = (t: number) => new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

  if (rows.length === 0) {
    return <p className="py-4 text-center text-xs text-muted-foreground">No official alerts with timestamps in the last 12 hours for this area.</p>;
  }

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[560px]" role="img" aria-label={`Timeline of ${rows.length} official alerts: issue to expiry, with the current time marked`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={0} y2={H - 18} stroke="var(--border)" strokeDasharray="2 4" />
            <text x={x(t)} y={H - 4} fontSize="11" textAnchor="middle" fill="var(--muted-foreground)" className="num">
              {fmt(t)}
            </text>
          </g>
        ))}
        {rows.map((a, i) => {
          const y = 8 + i * (rowH + 6);
          const s = Date.parse(a.issuedAt as string);
          const e = a.expiresAt ? Date.parse(a.expiresAt) : Math.min(end, s + 6 * 3_600_000);
          const color = SEVERITY_COLOR[a.severity];
          const id = `fade-${i}`;
          return (
            <a key={a.id} href={a.capUrl} target="_blank" rel="noopener noreferrer">
              <title>{`${a.issuer}: ${a.headline}\nIssued ${fmt(s)}${a.expiresAt ? ` · expires ${fmt(e)}` : " · no expiry stated"}`}</title>
              {!a.expiresAt ? (
                <defs>
                  <linearGradient id={id}>
                    <stop offset="0%" stopColor={color} stopOpacity="0.9" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                  </linearGradient>
                </defs>
              ) : null}
              <rect
                x={x(s)}
                y={y}
                width={Math.max(4, x(e) - x(s))}
                height={rowH}
                rx="4"
                fill={a.expiresAt ? color : `url(#${id})`}
                opacity={a.freshness === "ACTIVE" ? 0.9 : 0.35}
              />
              <text x={x(s) + 6} y={y + 13} fontSize="11" fill="#0b1220" fontWeight="600">
                {`${a.issuer} · ${a.severity === "Unknown" ? "severity n/s" : a.severity}`.slice(0, 40)}
              </text>
            </a>
          );
        })}
        <line x1={x(now)} x2={x(now)} y1={0} y2={H - 18} stroke="var(--danger)" strokeWidth="2" />
        <rect x={x(now) - 24} y={0} width="48" height="16" rx="3" fill="var(--danger)" />
        <text x={x(now)} y={12} fontSize="10" textAnchor="middle" fill="white" fontWeight="700">
          NOW
        </text>
      </svg>
    </div>
  );
}