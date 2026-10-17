/**
 * Geometry for the landing-page globe. Pure functions so they can be tested
 * without WebGL.
 *
 * Convention (matches three.js SphereGeometry + an equirectangular texture):
 *   lon 0 → +X, lon −90 → +Z, lon +90 → −Z, north pole → +Y.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const RAD = Math.PI / 180;

export function latLonToVector3(lat: number, lon: number, radius = 1): Vec3 {
  const la = lat * RAD;
  const lo = lon * RAD;
  return { x: radius * Math.cos(la) * Math.cos(lo), y: radius * Math.sin(la), z: -radius * Math.cos(la) * Math.sin(lo) };
}

/**
 * Rotations that bring (lat, lon) to face a camera on the +Z axis:
 * spin the globe about Y by `y`, then tilt the parent about X by `x`.
 */
export function facingRotation(lat: number, lon: number): { x: number; y: number } {
  return { x: lat * RAD, y: -Math.PI / 2 - lon * RAD };
}

/** Applies Y-spin then X-tilt to a point — the same order the scene graph uses. */
export function rotateYX(p: Vec3, rx: number, ry: number): Vec3 {
  const x1 = p.x * Math.cos(ry) + p.z * Math.sin(ry);
  const z1 = -p.x * Math.sin(ry) + p.z * Math.cos(ry);
  const y2 = p.y * Math.cos(rx) - z1 * Math.sin(rx);
  const z2 = p.y * Math.sin(rx) + z1 * Math.cos(rx);
  return { x: x1, y: y2, z: z2 };
}

/** Marker height on the globe surface for a count of active alerts (bounded, sub-linear). */
export function markerHeight(active: number): number {
  if (!(active > 0)) return 0;
  return Math.min(0.32, 0.04 + Math.sqrt(active) * 0.035);
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Smoothstep easing on 0–1. */
export const ease = (t: number) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
/** Maps v from [a, b] to 0–1, clamped. */
export const range = (v: number, a: number, b: number) => clamp01((v - a) / (b - a));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Equirectangular whole-Earth images from NASA GIBS WMS (public domain, CORS-enabled).
 * `date` is required for the daily VIIRS pass.
 */
export function gibsGlobeUrl(layer: "BlueMarble_NextGeneration" | "VIIRS_SNPP_CorrectedReflectance_TrueColor" | "VIIRS_CityLights_2012", width: number, date?: string): string {
  const p = new URLSearchParams({
    SERVICE: "WMS",
    REQUEST: "GetMap",
    VERSION: "1.3.0",
    LAYERS: layer,
    STYLES: "",
    CRS: "EPSG:4326",
    BBOX: "-90,-180,90,180",
    WIDTH: String(width),
    HEIGHT: String(Math.round(width / 2)),
    FORMAT: "image/jpeg",
  });
  if (date) p.set("TIME", date);
  return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${p.toString()}`;
}