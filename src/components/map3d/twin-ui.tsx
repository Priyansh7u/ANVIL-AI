"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, type ApiError } from "@/hooks/use-api";

/** Small presentational pieces for the 3D map. The map UI is always dark, whatever the app theme. */

export function Glass({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-xl border border-white/10 bg-slate-950/80 text-slate-100 shadow-2xl shadow-black/40 backdrop-blur-md", className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{children}</h3>
      {right}
    </div>
  );
}

export function Pill({ tone = "neutral", children, title }: { tone?: "live" | "warn" | "danger" | "sim" | "neutral" | "ok"; children: React.ReactNode; title?: string }) {
  const cls = {
    live: "border-cyan-400/40 bg-cyan-400/10 text-cyan-200",
    ok: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
    warn: "border-amber-400/40 bg-amber-400/10 text-amber-200",
    danger: "border-red-400/40 bg-red-500/10 text-red-200",
    sim: "border-purple-400/50 bg-purple-500/15 text-purple-200",
    neutral: "border-white/10 bg-white/5 text-slate-300",
  }[tone];
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", cls)}>
      {children}
    </span>
  );
}

export function IconButton({ label, active, className, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-lg border border-white/10 text-slate-200 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-40 [&_svg]:size-4",
        active && "border-cyan-400/60 bg-cyan-400/15 text-cyan-100",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, label, swatch, meta, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; swatch?: React.ReactNode; meta?: React.ReactNode; disabled?: boolean }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-white/5", disabled && "cursor-not-allowed opacity-50")}>
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className={cn("mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full border border-white/20 p-0.5 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-cyan-400", checked ? "bg-cyan-500/70" : "bg-white/5")} aria-hidden>
        <span className={cn("size-2.5 rounded-full bg-white transition-transform motion-reduce:transition-none", checked && "translate-x-3")} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[13px] font-medium">
          {swatch}
          {label}
        </span>
        {meta ? <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">{meta}</span> : null}
      </span>
    </label>
  );
}

export interface SearchResult {
  label: string;
  district: string | null;
  state: string | null;
  lat: number;
  lon: number;
}

/** Debounced place search (server-side Nominatim, cached and rate-limited) with keyboard navigation. */
export function SearchBox({ onSelect, className }: { onSelect: (r: SearchResult) => void; className?: string }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const listId = useId();

  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) {
      setResults([]);
      setError(null);
      return;
    }
    const t = setTimeout(() => {
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      setLoading(true);
      apiFetch<{ results: SearchResult[] }>(`/api/geo/search?q=${encodeURIComponent(term)}`, { signal: c.signal })
        .then((r) => {
          setResults(r.results.slice(0, 6));
          setError(r.results.length ? null : "No places found");
          setOpen(true);
          setActive(-1);
        })
        .catch((e: ApiError) => {
          if (e.code !== "ABORTED") setError(e.message);
        })
        .finally(() => {
          if (!c.signal.aborted) setLoading(false);
        });
    }, 400);
    return () => clearTimeout(t);
  }, [q]);

  const pick = (r: SearchResult) => {
    onSelect(r);
    setQ(r.label);
    setOpen(false);
  };

  return (
    <div className={cn("relative", className)}>
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/85 px-3 shadow-2xl backdrop-blur-md focus-within:ring-2 focus-within:ring-cyan-400/70">
        {loading ? <Loader2 className="size-4 animate-spin text-slate-400" /> : <Search className="size-4 text-slate-400" aria-hidden />}
        <input
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Search a place"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              const r = results[active >= 0 ? active : 0];
              if (r) pick(r);
            } else if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Search a city, district or landmark…"
          className="h-11 min-w-0 flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
        />
        {q ? (
          <button type="button" aria-label="Clear search" onClick={() => setQ("")} className="rounded p-1 text-slate-400 hover:text-slate-100">
            <X className="size-4" />
          </button>
        ) : null}
      </div>
      {open && (results.length || error) ? (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-20 mt-1.5 overflow-hidden rounded-xl border border-white/10 bg-slate-950/95 py-1 shadow-2xl backdrop-blur-md">
          {error && !results.length ? <li className="px-3 py-2 text-sm text-slate-400">{error}</li> : null}
          {results.map((r, i) => (
            <li
              key={`${r.lat},${r.lon},${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(r);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn("cursor-pointer px-3 py-2 text-sm", i === active ? "bg-cyan-400/15 text-cyan-50" : "text-slate-200")}
            >
              <span className="block truncate">{r.label}</span>
              <span className="block text-[11px] text-slate-400">{[r.district, r.state].filter(Boolean).join(", ") || "Location"}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "sim" | "warn" | "default" }) {
  return (
    <div className={cn("rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2", tone === "sim" && "border-purple-400/30", tone === "warn" && "border-amber-400/30")}>
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className="num mt-0.5 text-lg font-semibold leading-none text-slate-50">{value}</div>
    </div>
  );
}