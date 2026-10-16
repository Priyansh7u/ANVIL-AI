"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { EscalationResult } from "@/lib/core/intelligence";

/** Official alerts issued per hour over the last 48 h; the last 3 h (the "recent" window) are highlighted. */
export function EscalationChart({ escalation, height = 140 }: { escalation: EscalationResult; height?: number }) {
  const rows = escalation.hourly.map((h, i) => ({
    t: new Date(h.hourStart).toLocaleTimeString("en-IN", { hour: "2-digit", timeZone: "Asia/Kolkata" }),
    count: h.count,
    recent: i >= escalation.hourly.length - 3 ? h.count : 0,
    base: i >= escalation.hourly.length - 3 ? 0 : h.count,
  }));
  return (
    <div style={{ height }} role="img" aria-label={`Alerts per hour, last 48 hours. Recent ${escalation.recentPerHour}/h vs baseline ${escalation.baselinePerHour}/h.`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} barCategoryGap={1}>
          <XAxis dataKey="t" interval={7} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
          <YAxis allowDecimals={false} width={24} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            formatter={(v) => [`${v} alerts`, ""]}
            contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--foreground)" }}
          />
          <Bar dataKey="base" stackId="a" fill="var(--primary)" fillOpacity={0.55} isAnimationActive={false} />
          <Bar dataKey="recent" stackId="a" fill={escalation.escalating ? "var(--danger)" : "var(--warning)"} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export const TREND_TEXT: Record<EscalationResult["trend"], { label: string; tone: "danger" | "warning" | "ok" | "neutral" }> = {
  SURGING: { label: "Surging", tone: "danger" },
  RISING: { label: "Rising", tone: "warning" },
  STEADY: { label: "Steady", tone: "neutral" },
  EASING: { label: "Easing", tone: "ok" },
  QUIET: { label: "Quiet", tone: "ok" },
};