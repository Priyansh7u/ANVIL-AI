import { NextResponse, type NextRequest } from "next/server";
import { searchPlaces } from "@/lib/geo";
import { jsonError, parseQuery, rateLimit, UpstreamError } from "@/lib/http";
import { geoSearchQuerySchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "geo", 30, 60_000);
  if (limited) return limited;
  const q = parseQuery(req, geoSearchQuerySchema);
  if (!q.ok) return q.response;
  try {
    return NextResponse.json({ results: await searchPlaces(q.data.q) });
  } catch (err) {
    return jsonError(502, "GEOCODER_UNAVAILABLE", err instanceof UpstreamError ? err.message : "Search failed");
  }
}
