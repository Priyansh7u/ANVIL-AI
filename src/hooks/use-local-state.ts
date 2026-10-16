"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { Place } from "@/lib/core/types";

/**
 * Tiny localStorage-backed stores shared across components and tabs.
 * Only coarse data is stored: the chosen place (district/state + ~1 km coords),
 * an anonymous client id, and UI preferences.
 */

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = () => cb();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* private mode: state just won't persist */
  }
  emit();
}

const PLACE_KEY = "anvil.place.v1";
const CLIENT_KEY = "anvil.client.v1";
const PREFS_KEY = "anvil.prefs.v1";

export function usePlace(): [Place | null, (p: Place | null) => void] {
  const raw = useSyncExternalStore(subscribe, () => read(PLACE_KEY), () => null);
  const place = useMemo<Place | null>(() => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Place;
    } catch {
      return null;
    }
  }, [raw]);
  const set = useCallback((p: Place | null) => write(PLACE_KEY, p ? JSON.stringify(p) : null), []);
  return [place, set];
}

export function getOrCreateClientId(): string | null {
  if (typeof window === "undefined") return null;
  let id = read(CLIENT_KEY);
  if (!id && window.crypto?.randomUUID) {
    id = window.crypto.randomUUID();
    write(CLIENT_KEY, id);
  }
  return id;
}

export function useClientId(): string | null {
  return useSyncExternalStore(subscribe, () => read(CLIENT_KEY), () => null);
}

export function resetClientId() {
  write(CLIENT_KEY, null);
}

export interface UiPrefs {
  theme: "dark" | "light";
  language: "en" | "hi";
  largeText: boolean;
  reducedMotion: boolean;
  notifications: boolean;
  minSeverity: "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown";
}

export const DEFAULT_PREFS: UiPrefs = {
  theme: "dark",
  language: "en",
  largeText: false,
  reducedMotion: false,
  notifications: false,
  minSeverity: "Moderate",
};

export function usePrefs(): [UiPrefs, (patch: Partial<UiPrefs>) => void] {
  const raw = useSyncExternalStore(subscribe, () => read(PREFS_KEY), () => null);
  const prefs = useMemo<UiPrefs>(() => {
    if (!raw) return DEFAULT_PREFS;
    try {
      return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<UiPrefs>) };
    } catch {
      return DEFAULT_PREFS;
    }
  }, [raw]);
  const set = useCallback((patch: Partial<UiPrefs>) => {
    let current = DEFAULT_PREFS;
    const r = read(PREFS_KEY);
    if (r) {
      try {
        current = { ...DEFAULT_PREFS, ...(JSON.parse(r) as Partial<UiPrefs>) };
      } catch {
        /* ignore */
      }
    }
    write(PREFS_KEY, JSON.stringify({ ...current, ...patch }));
  }, []);
  return [prefs, set];
}

export function clearAllLocalData() {
  [PLACE_KEY, CLIENT_KEY, PREFS_KEY, "anvil.seenAlerts.v1", "anvil.family.v1"].forEach((k) => write(k, null));
}
