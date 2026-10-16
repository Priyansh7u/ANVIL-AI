import { NextResponse, type NextRequest } from "next/server";
import { getHazardPicture } from "@/lib/hazards";
import { parseQuery, rateLimit } from "@/lib/http";
import { find, storageMode } from "@/lib/repo";
import { sheltersQuerySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Live hazard map layers for one place: alert areas, district boundary, documented shelters, verified road closures. */
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "hazard-map", 30, 60_000);
  if (limited) return limited;
  const q = parseQuery(req, sheltersQuerySchema);
  if (!q.ok) return q.response;
  const place = { district: q.data.district ?? null, state: q.data.state ?? null };

  const shelterFilter: Record<string, unknown> = { "verification.status": "SOURCE_DOCUMENTED" };
  if (place.district) shelterFilter.district = place.district;
  if (place.state) shelterFilter.state = place.state;

  const [picture, shelters] = await Promise.all([getHazardPicture(place), find("Shelter", shelterFilter, { sortDesc: "updatedAt", limit: 100 })]);

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      feed: { dataMode: picture.alerts.dataMode, retrievedAt: picture.alerts.retrievedAt, feedPublishedAt: picture.alerts.feedPublishedAt, sourceUrl: picture.alerts.sourceUrl },
      hazards: picture.hazards.map((h) => ({
        id: h.alert.id,
        headline: h.alert.headline,
        issuer: h.alert.issuer,
        hazard: h.alert.hazard,
        severity: h.alert.severity,
        relevance: h.alert.relevance,
        issuedAt: h.alert.issuedAt,
        expiresAt: h.alert.expiresAt,
        instruction: h.alert.instruction,
        capUrl: h.alert.capUrl,
        areaSource: h.areaSource,
        polygons: h.polygons,
      })),
      boundary: picture.boundary ? { polygons: picture.boundary.polygons, name: picture.boundary.displayName, source: "OpenStreetMap" } : null,
      shelters: shelters.map((s) => ({ ...s, id: s._id })),
      roadClosures: picture.roadClosures,
      researchFinishedAt: picture.researchFinishedAt,
      storage: storageMode(),
    },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}