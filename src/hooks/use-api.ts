"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface ApiError {
  status: number;
  code: string;
  message: string;
}

/**
 * Errors are thrown as real Error objects (with status/code) so an uncaught one
 * shows its message instead of "[object Object]".
 */
export class ApiRequestError extends Error implements ApiError {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function apiFetch<T>(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs = 30_000, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: { "Content-Type": "application/json", ...(rest.headers ?? {}) },
      signal: rest.signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const name = (e as Error).name;
    throw new ApiRequestError(
      0,
      name === "TimeoutError" ? "TIMEOUT" : name === "AbortError" ? "ABORTED" : "OFFLINE",
      name === "TimeoutError" ? "The request timed out. Check your connection and retry." : name === "AbortError" ? "Request cancelled." : "Network unavailable. You may be offline.",
    );
  }
  const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  if (!res.ok) {
    throw new ApiRequestError(res.status, json?.error?.code ?? `HTTP_${res.status}`, json?.error?.message ?? `Request failed (${res.status}) — ${url.split("?")[0]}`);
  }
  return json as T;
}

/** Minimal data hook: loading / error / data / reload, with abort on unmount or key change. */
export function useApi<T>(url: string | null, opts: { refreshMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(url));
  const [tick, setTick] = useState(0);
  const ctrl = useRef<AbortController | null>(null);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!url) {
      setLoading(false);
      return;
    }
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setLoading(true);
    apiFetch<T>(url, { signal: c.signal })
      .then((d) => {
        if (!c.signal.aborted) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: ApiError) => {
        if (!c.signal.aborted && e.code !== "ABORTED") setError(e);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [url, tick]);

  useEffect(() => {
    if (!opts.refreshMs || !url) return;
    const t = setInterval(reload, opts.refreshMs);
    return () => clearInterval(t);
  }, [opts.refreshMs, url, reload]);

  return { data, error, loading, reload };
}

export function placeQuery(place: { district: string | null; state: string | null } | null): string {
  if (!place) return "";
  const p = new URLSearchParams();
  if (place.district) p.set("district", place.district);
  if (place.state) p.set("state", place.state);
  return p.toString();
}