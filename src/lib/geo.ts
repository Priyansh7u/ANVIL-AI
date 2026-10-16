import "server-only";
import { z } from "zod";
import { TtlCache } from "./core/concurrency";
import { geojsonToPolygons } from "./core/geometry";
import { env } from "./env";
import { fetchWithTimeout, UpstreamError } from "./http";
import { coarse } from "./utils";

/**
 * OpenStreetMap Nominatim (geocoding) and OSRM (routing).
 * Nominatim policy: max 1 req/s, identifying UA, cache results — enforced here.
 * Coordinates are rounded to ~1 km before reverse geocoding and never stored.
 */

const NOMINATIM = "https://nominatim.openstreetmap.org";
const geoCache = new TtlCache<unknown>(24 * 3_600_000, 2_000);
let lastNominatimCall = 0;

async function politeNominatim(path: string): Promise<unknown> {
  const cached = geoCache.get(path);
  if (cached?.fresh) return cached.value;
  const wait = lastNominatimCall + 1_100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatimCall = Date.now();
  const res = await fetchWithTimeout(`${NOMINATIM}${path}`, { timeoutMs: 10_000, headers: { "Accept-Language": "en" } });
  if (!res.ok) throw new UpstreamError(`Geocoder HTTP ${res.status}`, "HTTP", res.status);
  const json = (await res.json()) as unknown;
  geoCache.set(path, json);
  return json;
}

const addressSchema = z
  .object({
    state_district: z.string().optional(),
    county: z.string().optional(),
    city_district: z.string().optional(),
    district: z.string().optional(),
    city: z.string().optional(),
    town: z.string().optional(),
    village: z.string().optional(),
    state: z.string().optional(),
    country_code: z.string().optional(),
  })
  .passthrough();

const reverseSchema = z.object({ display_name: z.string().optional(), address: addressSchema.optional() });
const searchSchema = z.array(
  z.object({ display_name: z.string(), lat: z.string(), lon: z.string(), address: addressSchema.optional() }),
);

export interface ResolvedPlace {
  label: string;
  district: string | null;
  state: string | null;
  lat: number;
  lon: number;
  countryCode: string | null;
}

function districtFrom(a: z.infer<typeof addressSchema>): string | null {
  // Indian OSM data puts the revenue district in state_district or county, varying by state.
  const raw = a.state_district ?? a.county ?? a.district ?? a.city ?? a.town ?? null;
  return raw ? raw.replace(/\s+(district|tahsil|tehsil)$/i, "").trim() : null;
}

export async function reverseGeocode(lat: number, lon: number): Promise<ResolvedPlace> {
  const la = coarse(lat);
  const lo = coarse(lon);
  const json = await politeNominatim(`/reverse?format=jsonv2&lat=${la}&lon=${lo}&zoom=10&addressdetails=1`);
  const parsed = reverseSchema.safeParse(json);
  if (!parsed.success || !parsed.data.address) throw new UpstreamError("Geocoder returned no address", "INVALID_RESPONSE");
  const a = parsed.data.address;
  const district = districtFrom(a);
  const state = a.state ?? null;
  return {
    label: [district ?? a.city ?? a.town ?? a.village, state].filter(Boolean).join(", ") || "Selected location",
    district,
    state,
    lat: la,
    lon: lo,
    countryCode: a.country_code ?? null,
  };
}

export async function searchPlaces(q: string): Promise<ResolvedPlace[]> {
  const json = await politeNominatim(
    `/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=in&q=${encodeURIComponent(q)}`,
  );
  const parsed = searchSchema.safeParse(json);
  if (!parsed.success) throw new UpstreamError("Geocoder returned an unexpected payload", "INVALID_RESPONSE");
  return parsed.data.map((r) => {
    const a: z.infer<typeof addressSchema> = r.address ?? {};
    const district = districtFrom(a);
    return {
      label: r.display_name.split(",").slice(0, 3).join(",").trim(),
      district,
      state: a.state ?? null,
      lat: coarse(Number(r.lat)),
      lon: coarse(Number(r.lon)),
      countryCode: a.country_code ?? null,
    };
  });
}

/** Geocode a documented public shelter address. Returns null instead of guessing. */
export async function geocodeAddress(address: string, district: string | null, state: string | null): Promise<{ lat: number; lon: number } | null> {
  const q = [address, district, state, "India"].filter(Boolean).join(", ");
  try {
    const json = await politeNominatim(`/search?format=jsonv2&limit=1&countrycodes=in&q=${encodeURIComponent(q)}`);
    const parsed = searchSchema.safeParse(json);
    const first = parsed.success ? parsed.data[0] : undefined;
    if (!first) return null;
    return { lat: Number(first.lat), lon: Number(first.lon) };
  } catch {
    return null;
  }
}

const osrmSchema = z.object({
  code: z.string(),
  routes: z
    .array(
      z.object({
        distance: z.number(),
        duration: z.number(),
        geometry: z.object({ type: z.literal("LineString"), coordinates: z.array(z.tuple([z.number(), z.number()])) }),
      }),
    )
    .default([]),
});

export interface RouteResult {
  distanceKm: number;
  durationMin: number;
  /** [lat, lon] pairs for Leaflet */
  path: [number, number][];
  provider: string;
}

export async function getRoutes(from: { lat: number; lon: number }, to: { lat: number; lon: number }): Promise<RouteResult[]> {
  const base = env.routingBaseUrl.replace(/\/$/, "");
  const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const res = await fetchWithTimeout(`${base}/route/v1/driving/${coords}?overview=full&geometries=geojson&alternatives=3`, {
    timeoutMs: 15_000,
  });
  if (!res.ok) throw new UpstreamError(`Routing HTTP ${res.status}`, "HTTP", res.status);
  const parsed = osrmSchema.safeParse(await res.json());
  if (!parsed.success || parsed.data.code !== "Ok" || parsed.data.routes.length === 0) {
    throw new UpstreamError("No route found between these points", "INVALID_RESPONSE");
  }
  const provider = new URL(base).hostname;
  return parsed.data.routes.slice(0, 4).map((r) => ({
    distanceKm: Math.round(r.distance / 100) / 10,
    durationMin: Math.round(r.duration / 60),
    path: r.geometry.coordinates.map(([lo, la]) => [la, lo] as [number, number]),
    provider,
  }));
}

export async function getRoute(from: { lat: number; lon: number }, to: { lat: number; lon: number }): Promise<RouteResult> {
  const [first] = await getRoutes(from, to);
  return first as RouteResult;
}

const boundaryCache = new TtlCache<{ polygons: [number, number][][]; displayName: string } | null>(7 * 24 * 3_600_000, 500);

/**
 * Real administrative boundary of a district from OpenStreetMap (Nominatim
 * polygon_geojson). Used to show which area an official district-level alert
 * covers when SACHET publishes no polygon. Returns null rather than guessing.
 */
export async function districtBoundary(
  district: string,
  state: string | null,
): Promise<{ polygons: [number, number][][]; displayName: string } | null> {
  const key = `${district}|${state ?? ""}`.toLowerCase();
  const hit = boundaryCache.get(key);
  if (hit) return hit.value;
  const q = [`${district} district`, state, "India"].filter(Boolean).join(", ");
  try {
    const json = await politeNominatim(
      `/search?format=jsonv2&limit=1&countrycodes=in&polygon_geojson=1&polygon_threshold=0.003&q=${encodeURIComponent(q)}`,
    );
    const first = (Array.isArray(json) ? json[0] : null) as { geojson?: unknown; display_name?: string } | null;
    const polygons = first?.geojson ? geojsonToPolygons(first.geojson) : [];
    const value = polygons.length ? { polygons, displayName: first?.display_name ?? q } : null;
    boundaryCache.set(key, value);
    return value;
  } catch {
    return null;
  }
}

const tableSchema = z.object({
  code: z.string(),
  distances: z.array(z.array(z.number().nullable())).optional(),
  durations: z.array(z.array(z.number().nullable())).optional(),
});

/** Real road distances from one origin to many destinations (OSRM table service). */
export async function roadDistances(
  origin: { lat: number; lon: number },
  destinations: { lat: number; lon: number }[],
): Promise<{ distanceKm: number | null; durationMin: number | null }[]> {
  if (destinations.length === 0) return [];
  const base = env.routingBaseUrl.replace(/\/$/, "");
  const coords = [origin, ...destinations.slice(0, 50)].map((p) => `${p.lon},${p.lat}`).join(";");
  const res = await fetchWithTimeout(`${base}/table/v1/driving/${coords}?sources=0&annotations=distance,duration`, { timeoutMs: 15_000 });
  if (!res.ok) throw new UpstreamError(`Routing table HTTP ${res.status}`, "HTTP", res.status);
  const parsed = tableSchema.safeParse(await res.json());
  if (!parsed.success || parsed.data.code !== "Ok") throw new UpstreamError("Routing table returned no result", "INVALID_RESPONSE");
  const d = parsed.data.distances?.[0] ?? [];
  const t = parsed.data.durations?.[0] ?? [];
  return destinations.slice(0, 50).map((_, i) => ({
    distanceKm: typeof d[i + 1] === "number" ? Math.round((d[i + 1] as number) / 100) / 10 : null,
    durationMin: typeof t[i + 1] === "number" ? Math.round((t[i + 1] as number) / 60) : null,
  }));
}