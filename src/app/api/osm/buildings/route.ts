import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { TtlCache } from "@/lib/core/concurrency";
import { liveBuildingsQuery, MAX_LIVE_SPAN_DEG, overpassToBuildings, type LiveBuildings } from "@/lib/core/geo3d/osm-buildings";
import { env, USER_AGENT } from "@/lib/env";
import { jsonError, parseQuery, rateLimit } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 40;

const schema = z
  .object({
    west: z.coerce.number().min(-180).max(180),
    south: z.coerce.number().min(-85).max(85),
    east: z.coerce.number().min(-180).max(180),
    north: z.coerce.number().min(-85).max(85),
  })
  .refine((b) => b.east > b.west && b.north > b.south, "invalid bbox")
  .refine((b) => b.east - b.west <= MAX_LIVE_SPAN_DEG + 1e-6 && b.north - b.south <= MAX_LIVE_SPAN_DEG + 1e-6, "bbox too large (max ~3 km)");

// Short cache so a busy demo doesn't hammer Overpass, while staying minutes-fresh.
const cache = new TtlCache<LiveBuildings & { fetchedAt: string }>(5 * 60_000, 150);

/**
 * Live OSM building footprints for a small area, straight from the OpenStreetMap
 * database via Overpass (typically minutes behind edits).
 */
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "osm-buildings", 30, 60_000);
  if (limited) return limited;
  const q = parseQuery(req, schema);
  if (!q.ok) return q.response;
  const r = (n: number) => Math.round(n * 1000) / 1000;
  const box = { west: r(q.data.west), south: r(q.data.south), east: r(q.data.east), north: r(q.data.north) };
  const key = `${box.west},${box.south},${box.east},${box.north}`;
  const hit = cache.get(key);
  if (hit?.fresh) return NextResponse.json({ ...hit.value, cached: true, bbox: box });

  try {
    const res = await fetch(env.overpassUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT, Accept: "application/json" },
      body: `data=${encodeURIComponent(liveBuildingsQuery(box))}`,
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}${res.status === 429 ? " (rate limited — try again shortly)" : ""}`);
    const text = await res.text();
    if (text.length > 25_000_000) throw new Error("Overpass response too large");
    const data = { ...overpassToBuildings(JSON.parse(text)), fetchedAt: new Date().toISOString() };
    cache.set(key, data);
    return NextResponse.json({ ...data, cached: false, bbox: box }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (hit) return NextResponse.json({ ...hit.value, cached: true, stale: true, error: (e as Error).message, bbox: box });
    return jsonError(502, "OVERPASS_UNAVAILABLE", `Live OpenStreetMap buildings unavailable: ${(e as Error).message}`);
  }
}