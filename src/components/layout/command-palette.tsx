"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Phone, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  group: string;
  keywords?: string;
  href?: string;
  action?: () => void;
  icon?: React.ComponentType<{ className?: string }>;
}

/**
 * Ctrl/⌘ + K command palette: jump to any screen or run a quick action
 * (call 112, research my district, switch theme) from the keyboard.
 */
export function CommandPalette({ items, open, onOpenChange }: { items: PaletteItem[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const all: PaletteItem[] = useMemo(
    () => [...items, { id: "call-112", label: "Call 112 — emergency", group: "Emergency", keywords: "help police ambulance fire", icon: Phone, action: () => { window.location.href = "tel:112"; } }],
    [items],
  );
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return all;
    return all.filter((i) => `${i.label} ${i.hint ?? ""} ${i.keywords ?? ""} ${i.group}`.toLowerCase().includes(s));
  }, [all, q]);

  if (!open) return null;

  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    onOpenChange(false);
    if (item.href) router.push(item.href);
    item.action?.();
  };

  const groups = Array.from(new Set(filtered.map((i) => i.group)));

  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center bg-black/50 p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={() => onOpenChange(false)}>
      <div className="panel w-full max-w-xl overflow-hidden shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIdx((i) => Math.min(filtered.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIdx((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(filtered[idx]);
              } else if (e.key === "Escape") {
                onOpenChange(false);
              }
            }}
            placeholder="Go to a screen or run an action…"
            className="h-12 w-full bg-transparent text-sm outline-none"
            aria-label="Search commands"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
          />
          <kbd className="rounded border px-1.5 text-[10px] text-muted-foreground">Esc</kbd>
        </div>
        <ul id="palette-list" role="listbox" className="max-h-[50vh] overflow-auto p-1">
          {filtered.length === 0 ? <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches “{q}”.</li> : null}
          {groups.map((g) => (
            <li key={g} role="presentation">
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold text-muted-foreground">{g}</p>
              <ul role="group">
                {filtered
                  .filter((i) => i.group === g)
                  .map((i) => {
                    const n = filtered.indexOf(i);
                    const Icon = i.icon;
                    return (
                      <li
                        key={i.id}
                        role="option"
                        aria-selected={n === idx}
                        onMouseEnter={() => setIdx(n)}
                        onClick={() => run(i)}
                        className={cn("flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm", n === idx && "bg-muted")}
                      >
                        {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" /> : null}
                        <span className="flex-1">{i.label}</span>
                        {i.hint ? <span className="text-xs text-muted-foreground">{i.hint}</span> : null}
                        {n === idx ? <CornerDownLeft className="size-3.5 text-muted-foreground" /> : null}
                      </li>
                    );
                  })}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}