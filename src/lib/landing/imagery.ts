import { lonLatToTile } from "../core/geo3d/spatial";

/**
 * Real, attributable imagery for the landing page — no stock photos:
 *  - NASA GIBS (public domain): Blue Marble base and yesterday's VIIRS true-colour pass (today's clouds).
 *  - Sentinel-2 cloudless by EOX (CC BY-NC-SA 4.0, contains modified Copernicus Sentinel data): crisp close-ups.
 *  - OpenStreetMap tiles (ODbL) for the road layer.
 */

export type ImageryId = "bluemarble" | "bluemarble-alt" | "viirs" | "s2" | "osm";

export const IMAGERY_CREDIT: Record<ImageryId, string> = {
  bluemarble: "NASA Blue Marble via NASA GIBS",
  "bluemarble-alt": "NASA Blue Marble via NASA GIBS",
  viirs: "NASA VIIRS (Suomi NPP) true colour via NASA GIBS",
  s2: "Sentinel-2 cloudless by EOX (contains modified Copernicus Sentinel data 2020)",
  osm: "© OpenStreetMap contributors",
};

/** Yesterday in UTC — the most recent complete daily satellite pass. */
export function lastPassDate(now: Date = new Date()): string {
  const d = new Date(now.getTime() - 24 * 3_600_000);
  return d.toISOString().slice(0, 10);
}

export function tileUrl(id: ImageryId, z: number, x: number, y: number, date?: string): string {
  switch (id) {
    case "bluemarble":
      return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default//GoogleMapsCompatible_Level8/${z}/${y}/${x}.jpeg`;
    case "bluemarble-alt":
      // Same layer, path form without the time segment (GIBS accepts both for static layers).
      return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/${z}/${y}/${x}.jpeg`;
    case "viirs":
      return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${date ?? lastPassDate()}/GoogleMapsCompatible_Level9/${z}/${y}/${x}.jpg`;
    case "s2":
      return `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/${z}/${y}/${x}.jpg`;
    case "osm":
      return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  }
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface Mosaic {
  z: number;
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  /** Exact geographic bounds of the tile grid (larger than the requested bounds). */
  bounds: Bounds;
}

function tileToLon(x: number, z: number) {
  return (x / 2 ** z) * 360 - 180;
}
function tileToLat(y: number, z: number) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

export function mosaicFor(b: Bounds, z: number): Mosaic {
  const a = lonLatToTile(b.west, b.north, z);
  const c = lonLatToTile(b.east, b.south, z);
  const x0 = Math.floor(a.x);
  const y0 = Math.floor(a.y);
  const cols = Math.floor(c.x) - x0 + 1;
  const rows = Math.floor(c.y) - y0 + 1;
  return { z, x0, y0, cols, rows, bounds: { west: tileToLon(x0, z), east: tileToLon(x0 + cols, z), north: tileToLat(y0, z), south: tileToLat(y0 + rows, z) } };
}

/** Position of a lon/lat inside a mosaic, as fractions (0–1) of its width and height. */
export function positionIn(m: Mosaic, lon: number, lat: number): { x: number; y: number } {
  const t = lonLatToTile(lon, lat, m.z);
  return { x: (t.x - m.x0) / m.cols, y: (t.y - m.y0) / m.rows };
}

export const INDIA_BOUNDS: Bounds = { west: 67, south: 6.5, east: 97.5, north: 36 };

export interface Place {
  name: string;
  region: string;
  lat: number;
  lon: number;
  note: string;
}

/** Well-documented hazard history, stated plainly. Each links to the live 3D map at that spot. */
export const JOURNEY: Place[] = [
  { name: "Guwahati", region: "Assam", lat: 26.18, lon: 91.74, note: "The Brahmaputra floods parts of Assam in most monsoon seasons." },
  { name: "Puri", region: "Odisha", lat: 19.81, lon: 85.83, note: "Odisha's coast lies in the path of Bay of Bengal cyclones." },
  { name: "Chennai", region: "Tamil Nadu", lat: 13.08, lon: 80.27, note: "The city flooded in 2015, and again during Cyclone Michaung in 2023." },
  { name: "Kochi", region: "Kerala", lat: 9.97, lon: 76.27, note: "Kerala's 2018 floods were the state's worst in nearly a century." },
  { name: "Bhuj", region: "Gujarat", lat: 23.25, lon: 69.67, note: "The 2001 Gujarat earthquake was centred near Bhuj." },
  { name: "Joshimath", region: "Uttarakhand", lat: 30.555, lon: 79.565, note: "Land subsidence forced families out of their homes here in 2023." },
];

export function map3dLink(p: { lat: number; lon: number }, z = 14.5): string {
  return `/map3d?lat=${p.lat.toFixed(4)}&lon=${p.lon.toFixed(4)}&z=${z}&pitch=60&bearing=-20&mode=3d`;
}