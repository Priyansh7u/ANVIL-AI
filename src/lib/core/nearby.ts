import { haversineKm } from "./geometry";

/**
 * Nearby emergency facilities from OpenStreetMap (Overpass API).
 * OSM is community-mapped: entries are labelled as such and never as
 * officially verified. "Last verified" for OSM means the last time the map
 * object was edited.
 */

export type FacilityKind = "hospital" | "clinic" | "assembly_point" | "shelter" | "fire_station" | "police";

export const FACILITY_LABEL: Record<FacilityKind, string> = {
  hospital: "Hospital",
  clinic: "Clinic / health centre",
  assembly_point: "Emergency assembly point",
  shelter: "Shelter (social facility)",
  fire_station: "Fire station",
  police: "Police station",
};

export function overpassQuery(lat: number, lon: number, radiusM: number, kinds: FacilityKind[]): string {
  const r = Math.round(Math.min(Math.max(radiusM, 500), 25_000));
  const a = `(around:${r},${lat.toFixed(4)},${lon.toFixed(4)})`;
  const parts: string[] = [];
  if (kinds.includes("hospital")) parts.push(`nwr${a}["amenity"="hospital"];`, `nwr${a}["healthcare"="hospital"];`);
  if (kinds.includes("clinic")) parts.push(`nwr${a}["amenity"="clinic"];`, `nwr${a}["healthcare"~"^(clinic|centre)$"];`);
  if (kinds.includes("assembly_point")) parts.push(`nwr${a}["emergency"="assembly_point"];`);
  if (kinds.includes("shelter")) parts.push(`nwr${a}["social_facility"="shelter"];`, `nwr${a}["emergency"="shelter"];`);
  if (kinds.includes("fire_station")) parts.push(`nwr${a}["amenity"="fire_station"];`);
  if (kinds.includes("police")) parts.push(`nwr${a}["amenity"="police"];`);
  return `[out:json][timeout:25];(${parts.join("")});out center meta 300;`;
}

export interface OsmFacility {
  id: string;
  kind: FacilityKind;
  name: string;
  lat: number;
  lon: number;
  distanceKm: number;
  phone: string | null;
  address: string | null;
  emergencyDept: boolean | null;
  beds: number | null;
  website: string | null;
  lastEditedAt: string | null;
  osmUrl: string;
}

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  timestamp?: string;
  tags?: Record<string, string>;
}

function kindOf(t: Record<string, string>): FacilityKind | null {
  if (t.amenity === "hospital" || t.healthcare === "hospital") return "hospital";
  if (t.amenity === "clinic" || t.healthcare === "clinic" || t.healthcare === "centre") return "clinic";
  if (t.emergency === "assembly_point") return "assembly_point";
  if (t.social_facility === "shelter" || t.emergency === "shelter") return "shelter";
  if (t.amenity === "fire_station") return "fire_station";
  if (t.amenity === "police") return "police";
  return null;
}

function cleanPhone(raw: string | undefined): string | null {
  if (!raw) return null;
  const first = raw.split(/[;,/]/)[0]?.trim() ?? "";
  return /\d{3,}/.test(first) ? first.slice(0, 30) : null;
}

export function parseOverpass(json: unknown, origin: [number, number]): OsmFacility[] {
  const els = (json as { elements?: OverpassElement[] })?.elements;
  if (!Array.isArray(els)) return [];
  const seen = new Set<string>();
  const out: OsmFacility[] = [];
  for (const e of els) {
    const t = e.tags ?? {};
    const kind = kindOf(t);
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (!kind || typeof lat !== "number" || typeof lon !== "number" || !e.type || typeof e.id !== "number") continue;
    const id = `${e.type}/${e.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const name = t.name ?? t["name:en"] ?? t["name:hi"] ?? null;
    if (!name && kind !== "assembly_point") continue; // unnamed buildings are not useful for directions
    const addr = [t["addr:housenumber"], t["addr:street"], t["addr:suburb"] ?? t["addr:place"], t["addr:city"]].filter(Boolean).join(", ");
    out.push({
      id,
      kind,
      name: name ?? FACILITY_LABEL[kind],
      lat,
      lon,
      distanceKm: Math.round(haversineKm(origin, [lat, lon]) * 100) / 100,
      phone: cleanPhone(t["contact:phone"] ?? t.phone ?? t["contact:mobile"] ?? t.mobile),
      address: addr || null,
      emergencyDept: t.emergency === "yes" ? true : t.emergency === "no" ? false : null,
      beds: t.beds && /^\d+$/.test(t.beds) ? Number(t.beds) : null,
      website: t.website ?? t["contact:website"] ?? null,
      lastEditedAt: e.timestamp ?? null,
      osmUrl: `https://www.openstreetmap.org/${id}`,
    });
  }
  return out.sort((a, b) => a.distanceKm - b.distanceKm);
}

/** External turn-by-turn directions on openstreetmap.org (no account, no tracking). */
export function directionsUrl(from: [number, number], to: [number, number]): string {
  return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${from[0].toFixed(5)}%2C${from[1].toFixed(5)}%3B${to[0].toFixed(5)}%2C${to[1].toFixed(5)}`;
}