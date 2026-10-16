import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";
import { createRateLimiter, type RateLimiter } from "./core/rate-limit";
import { USER_AGENT } from "./env";

export class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly code: "TIMEOUT" | "HTTP" | "NETWORK" | "INVALID_RESPONSE" | "NOT_CONFIGURED",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

/** fetch with a hard timeout and a size cap; maps failures to UpstreamError. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number; maxBytes?: number } = {},
): Promise<Response> {
  const { timeoutMs = 10_000, maxBytes, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: { "User-Agent": USER_AGENT, ...(rest.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (err) {
    const name = (err as Error)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new UpstreamError(`Request timed out after ${timeoutMs} ms`, "TIMEOUT");
    }
    throw new UpstreamError(`Network error: ${(err as Error)?.message ?? "unknown"}`, "NETWORK");
  }
  if (maxBytes) {
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > maxBytes) throw new UpstreamError(`Response too large (${len} bytes)`, "INVALID_RESPONSE");
  }
  return res;
}

export async function readTextCapped(res: Response, maxBytes = 2_000_000): Promise<string> {
  const text = await res.text();
  if (text.length > maxBytes) throw new UpstreamError("Response exceeded size limit", "INVALID_RESPONSE");
  return text;
}

export function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

/** Parse + validate a JSON body. Returns a ready 400 response on failure. */
export async function parseJsonBody<T>(
  req: Request,
  schema: ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > 50_000) return { ok: false, response: jsonError(413, "PAYLOAD_TOO_LARGE", "Request body too large") };
    raw = text ? JSON.parse(text) : {};
  } catch {
    return { ok: false, response: jsonError(400, "INVALID_JSON", "Body must be valid JSON") };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      response: jsonError(400, "INVALID_INPUT", "Request validation failed", result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))),
    };
  }
  return { ok: true, data: result.data };
}

export function parseQuery<T>(
  req: NextRequest,
  schema: ZodType<T>,
): { ok: true; data: T } | { ok: false; response: NextResponse } {
  const obj = Object.fromEntries(req.nextUrl.searchParams.entries());
  const result = schema.safeParse(obj);
  if (!result.success) {
    return {
      ok: false,
      response: jsonError(400, "INVALID_INPUT", "Query validation failed", result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))),
    };
  }
  return { ok: true, data: result.data };
}

const limiters = new Map<string, RateLimiter>();

export function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || req.headers.get("x-real-ip") || "anonymous";
}

/** Returns a 429 response when the caller is over the limit for this bucket. */
export function rateLimit(req: Request, bucket: string, limit: number, windowMs: number): NextResponse | null {
  let rl = limiters.get(bucket);
  if (!rl) {
    rl = createRateLimiter({ limit, windowMs });
    limiters.set(bucket, rl);
  }
  const r = rl.check(clientKey(req));
  if (r.allowed) return null;
  const res = jsonError(429, "RATE_LIMITED", "Too many requests — please wait and try again.");
  res.headers.set("Retry-After", String(Math.ceil((r.resetAt - Date.now()) / 1000)));
  return res;
}
