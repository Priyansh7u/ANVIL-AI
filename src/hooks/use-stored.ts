"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * JSON state kept in this browser's localStorage under an `anvil.` key.
 * Starts from `initial` on the server and first paint, then hydrates.
 * Never stores anything on a server; Settings → "Delete my data" clears it.
 */
export function useStored<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [hydrated, setHydrated] = useState(false);
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      setValue(raw ? (JSON.parse(raw) as T) : initial);
    } catch {
      setValue(initial);
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial is a default, not a dependency
  }, [key]);

  const set = useCallback((v: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
      try {
        window.localStorage.setItem(keyRef.current, JSON.stringify(next));
      } catch {
        /* private mode: keep in memory only */
      }
      return next;
    });
  }, []);

  return [value, set, hydrated];
}