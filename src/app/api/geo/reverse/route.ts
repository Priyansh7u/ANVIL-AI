import { NextResponse, type NextRequest } from "next/server";
import { reverseGeocode } from "@/lib/geo";
import { jsonError, parseQuery, rateLimit, UpstreamError } from "@/lib/http";
import { reverseGeoQuerySchema } from "@/lib/validation";

export const runtime = "nodejs";

/** Coordinates are rounded to ~1 km inside reverseGeocode and are not stored. */
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "geo", 30, 60_000);
  if (limited) return limited;
  const q = parseQuery(req, reverseGeoQuerySchema);
  if (!q.ok) return q.response;
  try {
    const place = await reverseGeocode(q.data.lat, q.data.lon);
    if (place.countryCode && place.countryCode !== "in") {
      return jsonError(422, "OUTSIDE_COVERAGE", "ANVIL currently covers locations in India only. Choose a district manually.");
    }
    return NextResponse.json({ place });
  } catch (err) {
    const msg = err instanceof UpstreamError ? err.message : "Geocoding failed";
    return jsonError(502, "GEOCODER_UNAVAILABLE", `${msg}. Select your district manually instead.`);
  }
}
