"use client";

import { motion, useReducedMotion } from "motion/react";
import { Backpack, RotateCcw } from "lucide-react";
import { GO_BAG_ASSUMPTIONS, type GoBagItem } from "@/lib/core/readiness";
import { cn } from "@/lib/utils";
import { Badge, Button, Label, Select } from "@/components/ui/primitives";

/** Emergency-bag packing list sized to the household. Ticks are kept in this browser. */
export function GoBag({
  items,
  packed,
  onToggle,
  onReset,
  days,
  onDays,
  language,
}: {
  items: GoBagItem[];
  packed: string[];
  onToggle: (id: string) => void;
  onReset: () => void;
  days: number;
  onDays: (d: number) => void;
  language: "en" | "hi";
}) {
  const reduce = useReducedMotion();
  const done = items.filter((i) => packed.includes(i.id)).length;
  const essentialsLeft = items.filter((i) => i.essential && !packed.includes(i.id)).length;
  const pct = items.length ? done / items.length : 0;

  return (
    <div className="space-y-4">
      <div className="panel p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold"><Backpack className="size-5 text-primary" aria-hidden /> Emergency bag</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Sized for your household. Quantities follow general preparedness guidance ({GO_BAG_ASSUMPTIONS.waterLitresPerPersonPerDay} L water and {GO_BAG_ASSUMPTIONS.mealsPerPersonPerDay} meals per person per day) — not an official instruction.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="bag-days">Days to cover</Label>
              <Select id="bag-days" value={days} onChange={(e) => onDays(Number(e.target.value))} className="w-28">
                {[1, 2, 3, 5, 7].map((d) => (
                  <option key={d} value={d}>{d} day{d > 1 ? "s" : ""}</option>
                ))}
              </Select>
            </div>
            <Button variant="ghost" size="sm" onClick={onReset} disabled={!done}><RotateCcw /> Unpack all</Button>
          </div>
        </div>
        <div className="mt-4">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span aria-live="polite">{done} of {items.length} packed{essentialsLeft ? ` · ${essentialsLeft} essential left` : " · all essentials packed"}</span>
            <span className="num">{Math.round(pct * 100)}%</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
            <motion.div className="h-full origin-left rounded-full bg-primary" initial={false} animate={{ scaleX: pct }} transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 160, damping: 24 }} />
          </div>
        </div>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map((i) => {
          const on = packed.includes(i.id);
          return (
            <li key={i.id}>
              <label className={cn("flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50", on && "border-ok/50 bg-ok-soft/40")}>
                <input type="checkbox" className="size-5 shrink-0 accent-[var(--ok)]" checked={on} onChange={() => onToggle(i.id)} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm", on && "text-muted-foreground line-through decoration-ok/60")}>{language === "hi" ? i.hi : i.en}</span>
                  {i.essential ? <Badge tone="warning" className="mt-1">Essential</Badge> : null}
                </span>
                {i.qty ? <span className="num shrink-0 text-sm text-muted-foreground">{i.qty}</span> : null}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}