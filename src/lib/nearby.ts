import "server-only";
import { TtlCache } from "./core/concurrency";
import { haversineKm } from "./core/geometry";
import { overpassQuery, parseOverpass, type FacilityKind, type OsmFacility } from "./core/nearby";
import { env, USER_AGENT } from "./env";
import { UpstreamError } from "./http";
import { find } from "./repo";

/**
 * Nearby help: hospitals, clinics, police, fire stations, assembly points and
 * shelters from OpenStreetMap (live Overpass query, cached 10 minutes per
 * ~1 km cell), plus shelters documented on official government pages by the
 * research agent. The two are never mixed: each item carries its provenance.
 */

const cache = new TtlCache<{ facilities: OsmFacility[]; fetchedAt: string }>(10 * 60_000, 200);

export interface OfficialShelter {
  id: string;
  name: string;
  address: string | null;
  district: string | null;
  lat: number | null;
  lon: number | null;
  distanceKm: number | null;
  capacity: number | null;
  operationalStatus: string | null;
  sourceUrl: string;
  evidenceQuote: string;
  verifiedAt: string;
  locationPrecision: "GEOCODED_ADDRESS" | "NONE";
}

export async function getOsmFacilities(lat: number, lon: number, radiusKm: number, kinds: FacilityKind[]) {
  // Round the query point to ~1 km so the cache is shared and the precise location never leaves the device's rounding.
  const rl = Math.round(lat * 100) / 100;
  const ro = Math.round(lon * 100) / 100;
  const key = `${rl},${ro},${radiusKm},${[...kinds].sort().join(",")}`;
  const hit = cache.get(key);
  if (hit?.fresh) return { ...hit.value, cached: true, stale: false };
  try {
    const v = await queryOverpass(lat, lon, rl, ro, radiusKm, kinds);
    cache.set(key, v);
    return { ...v, cached: false, stale: false };
  } catch (e) {
    // Serve the last good answer (clearly labelled) rather than nothing.
    if (hit) return { ...hit.value, cached: true, stale: true, error: (e as Error).message };
    throw e;
  }
}

async function queryOverpass(lat: number, lon: number, rl: number, ro: number, radiusKm: number, kinds: FacilityKind[]) {

  const q = overpassQuery(rl, ro, radiusKm * 1000, kinds);
  let res: Response;
  try {
    res = await fetch(env.overpassUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT, Accept: "application/json" },
      body: `data=${encodeURIComponent(q)}`,
      signal: AbortSignal.timeout(28_000),
      cache: "no-store",
    });
  } catch (e) {
    const n = (e as Error).name;
    throw new UpstreamError(n === "TimeoutError" ? "OpenStreetMap (Overpass) timed out" : `OpenStreetMap (Overpass) unreachable: ${(e as Error).message}`, n === "TimeoutError" ? "TIMEOUT" : "NETWORK");
  }
  if (!res.ok) throw new UpstreamError(`OpenStreetMap (Overpass) HTTP ${res.status}${res.status === 429 ? " — rate limited, try again shortly" : ""}`, "HTTP", res.status);
  const text = await res.text();
  if (text.length > 8_000_000) throw new UpstreamError("Overpass response too large", "INVALID_RESPONSE");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new UpstreamError("Overpass returned invalid JSON", "INVALID_RESPONSE");
  }
  const facilities = parseOverpass(json, [lat, lon]).filter((f) => f.distanceKm <= radiusKm + 0.5);
  return { facilities, fetchedAt: new Date().toISOString() };
}

export async function getOfficialShelters(place: { district?: string; state?: string }, origin: [number, number]): Promise<OfficialShelter[]> {
  const filter: Record<string, unknown> = {};
  if (place.district) filter.district = place.district;
  else if (place.state) filter.state = place.state;
  else return [];
  const rows = await find("Shelter", filter, { sortDesc: "updatedAt", limit: 100 }).catch(() => []);
  return rows.map((s) => {
    const loc = (s.location as { lat?: number; lon?: number; precision?: string } | undefined) ?? {};
    const ev = (s.verification as { evidence?: { evidenceQuote?: string; retrievedAt?: string } } | undefined)?.evidence ?? {};
    const has = typeof loc.lat === "number" && typeof loc.lon === "number";
    return {
      id: s._id,
      name: String(s.name),
      address: (s.address as string) ?? null,
      district: (s.district as string) ?? null,
      lat: has ? (loc.lat as number) : null,
      lon: has ? (loc.lon as number) : null,
      distanceKm: has ? Math.round(haversineKm(origin, [loc.lat as number, loc.lon as number]) * 100) / 100 : null,
      capacity: (s.capacity as number) ?? null,
      operationalStatus: (s.operationalStatus as string) ?? null,
      sourceUrl: String(s.sourceUrl),
      evidenceQuote: ev.evidenceQuote ?? "",
      verifiedAt: ev.retrievedAt ?? String(s.updatedAt ?? s.createdAt ?? ""),
      locationPrecision: has ? "GEOCODED_ADDRESS" : "NONE",
    };
  });
}