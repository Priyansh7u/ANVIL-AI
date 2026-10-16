import "server-only";
import { env } from "./env";
import { UpstreamError } from "./http";
import { checkPublicHttpsUrl } from "./core/url-safety";
import {
  AGENT_OUTPUT_SCHEMA,
  tinyfishFetchResponse,
  tinyfishSearchResponse,
  tinyfishSseEvent,
} from "./validation";
import type { z } from "zod";

/**
 * TinyFish client — implemented against the public docs (docs.tinyfish.ai):
 *   Search: GET  https://api.search.tinyfish.ai?query=...       (X-API-Key)
 *   Fetch:  POST https://api.fetch.tinyfish.ai {urls[], format}  (X-API-Key)
 *   Agent:  POST https://agent.tinyfish.ai/v1/automation/run-sse {url, goal, output_schema}
 * All calls are server-side only, time-bounded and response-validated.
 */

const SEARCH_URL = "https://api.search.tinyfish.ai";
const FETCH_URL = "https://api.fetch.tinyfish.ai";
const AGENT_SSE_URL = "https://agent.tinyfish.ai/v1/automation/run-sse";

export class TinyFishError extends UpstreamError {}

function requireKey(): string {
  if (!env.tinyfishApiKey) {
    throw new TinyFishError("TINYFISH_API_KEY is not configured", "NOT_CONFIGURED");
  }
  return env.tinyfishApiKey;
}

function withTimeout(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const t = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([t, signal]) : t;
}

async function call(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: withTimeout(timeoutMs, signal), cache: "no-store" });
  } catch (err) {
    const n = (err as Error).name;
    if (signal?.aborted) throw new TinyFishError("TinyFish request cancelled", "TIMEOUT");
    if (n === "TimeoutError" || n === "AbortError") throw new TinyFishError(`TinyFish timed out after ${timeoutMs} ms`, "TIMEOUT");
    throw new TinyFishError(`TinyFish network error: ${(err as Error).message}`, "NETWORK");
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    throw new TinyFishError(`TinyFish HTTP ${res.status}${detail ? `: ${detail}` : ""}`, "HTTP", res.status);
  }
  return res;
}

export type SearchResult = z.infer<typeof tinyfishSearchResponse>["results"][number];

export interface SearchOptions {
  includeDomains?: string[];
  excludeDomains?: string[];
  /** ISO country code, e.g. "IN" */
  location?: string;
  language?: string;
  /** Only results newer than this many minutes (provider-side filter). */
  recencyMinutes?: number;
  domainType?: "web" | "news" | "research_paper";
  signal?: AbortSignal;
}

export async function tinyfishSearch(query: string, purpose?: string, timeoutMs = 15_000, opts: SearchOptions = {}): Promise<SearchResult[]> {
  const key = requireKey();
  const params = new URLSearchParams({ query: query.slice(0, 400) });
  if (purpose) params.set("purpose", purpose.slice(0, 500));
  if (opts.includeDomains?.length) params.set("include_domains", opts.includeDomains.slice(0, 20).join(","));
  if (opts.excludeDomains?.length) params.set("exclude_domains", opts.excludeDomains.slice(0, 20).join(","));
  if (opts.location) params.set("location", opts.location);
  if (opts.language) params.set("language", opts.language);
  if (opts.recencyMinutes) params.set("recency_minutes", String(Math.round(opts.recencyMinutes)));
  if (opts.domainType) params.set("domain_type", opts.domainType);
  const res = await call(`${SEARCH_URL}?${params}`, { headers: { "X-API-Key": key } }, timeoutMs, opts.signal);
  const parsed = tinyfishSearchResponse.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new TinyFishError("TinyFish Search returned an unexpected payload", "INVALID_RESPONSE");
  return parsed.data.results;
}

export interface FetchedPage {
  url: string;
  finalUrl: string;
  title: string | null;
  text: string;
}

export async function tinyfishFetch(
  urls: string[],
  opts: { purpose?: string; ttlSeconds?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ pages: FetchedPage[]; errors: { url: string; error: string }[] }> {
  const key = requireKey();
  const safe = urls.filter((u) => checkPublicHttpsUrl(u).ok).slice(0, 10);
  if (safe.length === 0) return { pages: [], errors: [] };
  const body: Record<string, unknown> = { urls: safe, format: "markdown" };
  if (opts.purpose) body.purpose = opts.purpose.slice(0, 500);
  if (opts.ttlSeconds !== undefined) body.ttl = opts.ttlSeconds;
  const res = await call(
    FETCH_URL,
    { method: "POST", headers: { "X-API-Key": key, "Content-Type": "application/json" }, body: JSON.stringify(body) },
    opts.timeoutMs ?? 45_000,
    opts.signal,
  );
  const parsed = tinyfishFetchResponse.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new TinyFishError("TinyFish Fetch returned an unexpected payload", "INVALID_RESPONSE");
  return {
    pages: parsed.data.results
      .filter((r) => typeof r.text === "string" && r.text.trim().length > 0)
      .map((r) => ({ url: r.url, finalUrl: r.final_url ?? r.url, title: r.title ?? null, text: r.text as string })),
    errors: parsed.data.errors.map((e) => ({ url: e.url ?? "unknown", error: typeof e.error === "string" ? e.error : JSON.stringify(e.error ?? "error") })),
  };
}

export interface AgentOutcome {
  runId: string | null;
  status: string;
  result: unknown;
  error: unknown;
}

/**
 * Run a goal-based TinyFish Agent task and stream genuine PROGRESS events to
 * `onProgress`. Bounded by `max_duration_seconds` on TinyFish's side and an
 * AbortSignal on ours.
 */
export async function tinyfishAgentRun(
  args: { url: string; goal: string; maxDurationSeconds?: number; outputSchema?: unknown; signal?: AbortSignal; onRunId?: (id: string) => void | Promise<void> },
  onProgress: (purpose: string) => void | Promise<void>,
): Promise<AgentOutcome> {
  const key = requireKey();
  const check = checkPublicHttpsUrl(args.url);
  if (!check.ok) throw new TinyFishError(`Refusing agent run on unsafe URL (${check.reason})`, "INVALID_RESPONSE");
  const maxDuration = Math.min(args.maxDurationSeconds ?? 120, 240);
  const res = await call(
    AGENT_SSE_URL,
    {
      method: "POST",
      headers: { "X-API-Key": key, "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        url: args.url,
        goal: args.goal,
        output_schema: args.outputSchema ?? AGENT_OUTPUT_SCHEMA,
        browser_profile: "lite",
        agent_config: { max_duration_seconds: maxDuration },
      }),
    },
    (maxDuration + 30) * 1000,
    args.signal,
  );
  if (!res.body) throw new TinyFishError("TinyFish Agent returned no stream", "INVALID_RESPONSE");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let runId: string | null = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      let json: unknown;
      try {
        json = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      const ev = tinyfishSseEvent.safeParse(json);
      if (!ev.success) continue;
      const rid: string | null | undefined = ev.data.run_id;
      if (rid && rid !== runId) {
        runId = rid;
        await args.onRunId?.(rid);
      }
      if (ev.data.type === "PROGRESS" && ev.data.purpose) await onProgress(ev.data.purpose.slice(0, 200));
      if (ev.data.type === "COMPLETE") {
        await reader.cancel().catch(() => undefined);
        return { runId, status: ev.data.status ?? "UNKNOWN", result: ev.data.result ?? null, error: ev.data.error ?? null };
      }
    }
  }
  throw new TinyFishError("TinyFish Agent stream ended without a COMPLETE event", "INVALID_RESPONSE");
}

/** Ask TinyFish to stop a running agent run (best effort, bounded). */
export async function tinyfishCancelRun(runId: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{4,100}$/.test(runId)) return false;
  try {
    await call(`https://agent.tinyfish.ai/v1/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST", headers: { "X-API-Key": requireKey() } }, 8_000);
    return true;
  } catch {
    return false;
  }
}