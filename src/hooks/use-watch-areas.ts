"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { WatchArea } from "@/lib/core/geofence";

/**
 * Watch areas for smart geofenced alerts. Stored ONLY in this browser
 * (localStorage) — the server never learns which areas a person watches.
 */
const KEY = "anvil.watch.v1";
const MAX_AREAS = 5;
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function readWatchAreas(): WatchArea[] {
  try {
    const v = JSON.parse(read() ?? "[]") as unknown;
    return Array.isArray(v) ? (v as WatchArea[]).slice(0, MAX_AREAS) : [];
  } catch {
    return [];
  }
}

export function useWatchAreas() {
  const raw = useSyncExternalStore(subscribe, read, () => null);
  const areas = useMemo<WatchArea[]>(() => {
    try {
      const v = JSON.parse(raw ?? "[]") as unknown;
      return Array.isArray(v) ? (v as WatchArea[]).slice(0, MAX_AREAS) : [];
    } catch {
      return [];
    }
  }, [raw]);

  const save = useCallback((next: WatchArea[]) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(next.slice(0, MAX_AREAS)));
    } catch {
      /* storage blocked */
    }
    listeners.forEach((l) => l());
  }, []);

  const add = useCallback((a: WatchArea) => save([...readWatchAreas().filter((x) => x.id !== a.id), a]), [save]);
  const remove = useCallback((id: string) => save(readWatchAreas().filter((x) => x.id !== id)), [save]);

  return { areas, add, remove, max: MAX_AREAS };
}