"use client";

import { useId, useRef } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  badge?: React.ReactNode;
}

/**
 * Accessible tab bar (arrow keys move between tabs) with a highlight that
 * glides to the selected tab. Pair each panel with `tabPanelProps`.
 */
export function Tabs<T extends string>({ items, value, onChange, label, className }: { items: TabItem<T>[]; value: T; onChange: (v: T) => void; label: string; className?: string }) {
  const group = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const n = items.length;
    const next = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    const item = items[next];
    if (!item) return;
    onChange(item.id);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={cn("flex gap-1 overflow-x-auto rounded-lg border bg-panel p-1", className)}>
      {items.map((t, i) => {
        const on = t.id === value;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={on}
            aria-controls={`panel-${t.id}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn("relative flex min-h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors", on ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {on ? <motion.span layoutId={`tab-pill-${group}`} className="absolute inset-0 rounded-md bg-muted shadow-sm" transition={{ type: "spring", stiffness: 420, damping: 34 }} aria-hidden /> : null}
            {Icon ? <Icon className="relative size-4" aria-hidden /> : null}
            <span className="relative">{t.label}</span>
            {t.badge != null ? <span className="relative">{t.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function tabPanelProps(id: string) {
  return { role: "tabpanel" as const, id: `panel-${id}`, "aria-labelledby": `tab-${id}`, tabIndex: 0 };
}