import { NextResponse, type NextRequest } from "next/server";
import { SEVERITY_RANK } from "@/lib/core/cap";
import { rankRoutesByExposure, routeHazardCrossings } from "@/lib/core/geometry";
import { getRoutes } from "@/lib/geo";
import { getHazardPicture } from "@/lib/hazards";
import { jsonError, parseQuery, rateLimit, UpstreamError } from "@/lib/http";
import { routeQuerySchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * Hazard-aware route assistance.
 * 1. Ask the routing provider for up to 4 alternative road routes.
 * 2. Measure each route's exposure: km inside LIVE official alert areas,
 *    weighted by alert severity.
 * 3. Recommend the lowest-exposure alternative (ties → fastest).
 * `safetyVerified` is ALWAYS false: no source can confirm a road is safe now.
 */
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "route", 20, 60_000);
  if (limited) return limited;
  const q = parseQuery(req, routeQuerySchema);
  if (!q.ok) return q.response;
  const { fromLat, fromLon, toLat, toLon, district, state } = q.data;

  try {
    const [routes, picture] = await Promise.all([
      getRoutes({ lat: fromLat, lon: fromLon }, { lat: toLat, lon: toLon }),
      district || state ? getHazardPicture({ district: district ?? null, state: state ?? null }) : Promise.resolve(null),
    ]);
    const hazards = picture?.hazards ?? [];
    const mapped = hazards.filter((h) => h.polygons.length);
    const ranked = rankRoutesByExposure(
      routes.map((r, i) => ({ ...r, originalIndex: i })),
      mapped.map((h) => ({ polygons: h.polygons, weight: 1 + SEVERITY_RANK[h.alert.severity] })),
    );

    const describe = (path: [number, number][]) =>
      routeHazardCrossings(
        path,
        mapped.map((h) => ({ id: h.alert.id, polygons: h.polygons })),
      ).map((c) => {
        const h = hazards.find((x) => x.alert.id === c.id)!;
        return {
          alertId: c.id,
          atKm: c.atKm,
          headline: h.alert.headline,
          issuer: h.alert.issuer,
          severity: h.alert.severity,
          hazard: h.alert.hazard,
          expiresAt: h.alert.expiresAt,
          capUrl: h.alert.capUrl,
          areaSource: h.areaSource,
        };
      });

    const alternatives = ranked.map((r, rank) => ({
      rank,
      distanceKm: r.distanceKm,
      durationMin: r.durationMin,
      exposureKm: r.exposureKm,
      weightedExposure: r.weightedExposure,
      path: r.path,
      provider: r.provider,
      isProviderFastest: r.originalIndex === 0,
      crossings: describe(r.path),
    }));
    const best = alternatives[0]!;
    const fastest = alternatives.find((a) => a.isProviderFastest) ?? best;
    const unmapped = hazards.filter((h) => !h.polygons.length);

    const warnings: string[] = [];
    if (alternatives.length > 1 && best !== fastest && fastest.exposureKm > best.exposureKm) {
      warnings.push(
        `Recommended alternative avoids ${Math.round((fastest.exposureKm - best.exposureKm) * 10) / 10} km of mapped alert area compared with the fastest route (+${best.durationMin - fastest.durationMin} min).`,
      );
    }
    if (best.crossings.length) warnings.push(`Even the lowest-exposure route enters ${best.crossings.length} active alert area(s) — first after ~${best.crossings[0]!.atKm} km.`);
    if (unmapped.length) warnings.push(`${unmapped.length} active state-level alert(s) have no published area — they may still affect this route.`);
    if (picture?.roadClosures.length) warnings.push(`${picture.roadClosures.length} road closure(s) are reported on official pages for this district — check them against your route.`);
    warnings.push("Route safety is NOT verified. Road status changes quickly; never drive or walk through flowing or standing water and follow police diversions.");
    if (picture && picture.alerts.dataMode === "UNAVAILABLE") warnings.push("The official alert feed could not be reached while planning this route.");

    return NextResponse.json({
      route: { distanceKm: best.distanceKm, durationMin: best.durationMin, path: best.path, provider: best.provider },
      alternatives,
      safetyVerified: false,
      crossings: best.crossings,
      unmappedAlerts: unmapped.map((h) => ({ alertId: h.alert.id, headline: h.alert.headline, issuer: h.alert.issuer, capUrl: h.alert.capUrl })),
      roadClosures: picture?.roadClosures ?? [],
      warnings,
      method: "Alternatives ranked by km inside live official alert areas × (1 + severity rank), then by travel time.",
      alertsRetrievedAt: picture?.alerts.retrievedAt ?? null,
      researchFinishedAt: picture?.researchFinishedAt ?? null,
      routedAt: new Date().toISOString(),
    });
  } catch (err) {
    return jsonError(502, "ROUTING_UNAVAILABLE", err instanceof UpstreamError ? err.message : "Routing failed");
  }
}