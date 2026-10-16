"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { HAZARD_LABEL } from "@/components/alerts/alert-card";

export function HazardChart({ data }: { data: { hazard: string; count: number }[] }) {
  const rows = data.map((d) => ({ name: HAZARD_LABEL[d.hazard] ?? d.hazard, count: d.count }));
  return (
    <div className="h-48 w-full" role="img" aria-label={`Active alerts by hazard: ${rows.map((r) => `${r.name} ${r.count}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
          <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--foreground)" }}
          />
          <Bar dataKey="count" name="Active alerts" fill="var(--primary)" radius={[0, 4, 4, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
