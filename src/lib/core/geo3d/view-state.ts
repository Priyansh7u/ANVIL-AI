/** Shareable 3D map view in the URL, validated on the way in. Only the camera and layer choice are shared — nothing personal. */

export const LAYER_IDS = ["alerts", "boundary", "buildings", "terrain", "facilities", "shelters", "scenario", "exposure", "routes"] as const;
export type LayerId = (typeof LAYER_IDS)[number];

export interface ViewState {
  lat: number;
  lon: number;
  zoom: number;
  pitch: number;
  bearing: number;
  mode: "3d" | "2d";
  layers: LayerId[];
}

export const DEFAULT_LAYERS: LayerId[] = ["alerts", "boundary", "buildings", "terrain", "facilities", "shelters", "scenario", "exposure", "routes"];

function num(v: string | null, min: number, max: number): number | null {
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

export function parseViewState(params: URLSearchParams): Partial<ViewState> {
  const out: Partial<ViewState> = {};
  const lat = num(params.get("lat"), -85, 85);
  const lon = num(params.get("lon"), -180, 180);
  if (lat !== null && lon !== null) {
    out.lat = lat;
    out.lon = lon;
  }
  const z = num(params.get("z"), 1, 20);
  if (z !== null) out.zoom = z;
  const p = num(params.get("pitch"), 0, 85);
  if (p !== null) out.pitch = p;
  const b = num(params.get("bearing"), -180, 180);
  if (b !== null) out.bearing = b;
  const m = params.get("mode");
  if (m === "2d" || m === "3d") out.mode = m;
  const l = params.get("layers");
  if (l !== null) out.layers = l.split(",").filter((x): x is LayerId => (LAYER_IDS as readonly string[]).includes(x));
  return out;
}

export function serializeViewState(v: ViewState): string {
  const p = new URLSearchParams({
    lat: v.lat.toFixed(4),
    lon: v.lon.toFixed(4),
    z: v.zoom.toFixed(2),
    pitch: Math.round(v.pitch).toString(),
    bearing: Math.round(v.bearing).toString(),
    mode: v.mode,
    layers: v.layers.join(","),
  });
  return p.toString();
}