import { NextResponse, type NextRequest } from "next/server";
import type { FacilityKind } from "@/lib/core/nearby";
import { jsonError, parseQuery, rateLimit, UpstreamError } from "@/lib/http";
import { getOfficialShelters, getOsmFacilities } from "@/lib/nearby";
import { nearbyQuerySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 40;

const ALL: FacilityKind[] = ["hospital", "clinic", "shelter", "assembly_point", "fire_station", "police"];

/**
 * Nearby help around a (client-rounded) point:
 *  - officialShelters: shelters documented on government pages (quote + link + retrieval time)
 *  - facilities: live OpenStreetMap data — community-mapped, NOT officially verified
 * Coordinates are used for the query only and never stored or logged.
 */
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "nearby", 20, 60_000);
  if (limited) return limited;
  const q = parseQuery(req, nearbyQuerySchema);
  if (!q.ok) return q.response;
  const { lat, lon, radiusKm, district, state } = q.data;
  const kinds = (q.data.kinds as FacilityKind[] | undefined) ?? ALL;
  const origin: [number, number] = [lat, lon];

  const [osm, official] = await Promise.allSettled([getOsmFacilities(lat, lon, radiusKm, kinds), getOfficialShelters({ district, state }, origin)]);
  if (osm.status === "rejected" && official.status === "rejected") {
    const e = osm.reason as Error;
    return jsonError(502, "UPSTREAM_UNAVAILABLE", e instanceof UpstreamError ? e.message : "Nearby data unavailable.");
  }
  const o = osm.status === "fulfilled" ? osm.value : null;
  return NextResponse.json(
    {
      radiusKm,
      facilities: o?.facilities ?? [],
      osm: o
        ? { status: o.stale ? "STALE" : "LIVE", fetchedAt: o.fetchedAt, cached: o.cached, error: (o as { error?: string }).error ?? null, attribution: "© OpenStreetMap contributors (ODbL)", provenance: "Community-mapped. Not officially verified. 'Last edited' is when the map entry was last changed, not when the facility was inspected." }
        : { status: "UNAVAILABLE", fetchedAt: null, cached: false, error: (osm as PromiseRejectedResult).reason?.message ?? "error", attribution: "© OpenStreetMap contributors (ODbL)", provenance: "" },
      officialShelters: official.status === "fulfilled" ? official.value : [],
      officialNote: "Listed because an official government page documents it (quote + link). ANVIL cannot confirm a shelter is open, safe or has space — confirm with the district control room.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}