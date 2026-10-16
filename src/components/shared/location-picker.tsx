"use client";

import { useState } from "react";
import { FlaskConical, Loader2, LocateFixed, Search } from "lucide-react";
import type { Place } from "@/lib/core/types";
import { geolocationMessage, geolocationOutcome } from "@/lib/core/geo-permission";
import { coarse } from "@/lib/utils";
import { apiFetch, type ApiError } from "@/hooks/use-api";
import { Button, Input, Label } from "@/components/ui/primitives";
import { ErrorState } from "./status";

interface Resolved {
  label: string;
  district: string | null;
  state: string | null;
  lat: number;
  lon: number;
}

/** Preset used by "demo mode". The location is preset; the alerts shown for it are still live official data. */
export const DEMO_PLACE: Place = { label: "Patna, Bihar", district: "Patna", state: "Bihar", lat: 25.59, lon: 85.14, source: "demo" };

export function LocationPicker({ onPicked }: { onPicked: (p: Place) => void }) {
  const [status, setStatus] = useState<"idle" | "locating" | "resolving">("idle");
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Resolved[] | null>(null);
  const [searching, setSearching] = useState(false);

  const useGps = () => {
    setError(null);
    if (!("geolocation" in navigator)) {
      setError(geolocationMessage("UNSUPPORTED"));
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setStatus("resolving");
        // Rounded to ~1 km in the browser, before it ever leaves the device.
        const lat = coarse(pos.coords.latitude);
        const lon = coarse(pos.coords.longitude);
        try {
          const r = await apiFetch<{ place: Resolved }>(`/api/geo/reverse?lat=${lat}&lon=${lon}`);
          onPicked({ ...r.place, source: "gps" });
        } catch (e) {
          setError((e as ApiError).message);
        } finally {
          setStatus("idle");
        }
      },
      (err) => {
        setStatus("idle");
        setError(geolocationMessage(geolocationOutcome(err.code)));
      },
      { enableHighAccuracy: false, maximumAge: 10 * 60_000, timeout: 15_000 },
    );
  };

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim().length < 2) return;
    setSearching(true);
    setError(null);
    try {
      const r = await apiFetch<{ results: Resolved[] }>(`/api/geo/search?q=${encodeURIComponent(query.trim())}`);
      setResults(r.results);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Button size="lg" className="w-full sm:w-auto" onClick={useGps} disabled={status !== "idle"}>
          {status === "idle" ? <LocateFixed /> : <Loader2 className="animate-spin" />}
          {status === "locating" ? "Waiting for permission…" : status === "resolving" ? "Finding your district…" : "Use my approximate location"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Your browser asks for permission. Coordinates are rounded to about 1 km on your device, used once to look up your district, and not stored.
        </p>
      </div>

      <form onSubmit={search} className="space-y-2" role="search">
        <Label htmlFor="place-q">Or search for your city or district</Label>
        <div className="flex gap-2">
          <Input id="place-q" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Narela, Delhi or Patna" autoComplete="off" />
          <Button type="submit" variant="outline" disabled={searching || query.trim().length < 2} aria-label="Search">
            {searching ? <Loader2 className="animate-spin" /> : <Search />}
          </Button>
        </div>
      </form>

      {results ? (
        results.length === 0 ? (
          <p className="text-sm text-muted-foreground">No matches in India. Try the district name.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {results.map((r) => (
              <li key={`${r.label}-${r.lat}-${r.lon}`}>
                <button className="w-full px-3 py-2.5 text-left text-sm hover:bg-muted" onClick={() => onPicked({ ...r, source: "manual" })}>
                  <span className="font-medium">{r.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    District: {r.district ?? "unknown"} · State: {r.state ?? "unknown"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {error ? <ErrorState message={error} /> : null}

      <div className="rounded-lg border border-dashed border-sim/60 p-3">
        <Button variant="ghost" className="text-sim" onClick={() => onPicked(DEMO_PLACE)}>
          <FlaskConical /> Demo mode: use preset location {DEMO_PLACE.label}
        </Button>
        <p className="px-1 text-xs text-muted-foreground">Only the location is preset. Alerts shown are still the live official feed for that district.</p>
      </div>
    </div>
  );
}
