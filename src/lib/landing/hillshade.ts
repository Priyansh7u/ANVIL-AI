import type { ElevationGrid } from "../core/geo3d/inundation";

/**
 * Horn-method hillshade from a real elevation grid (sun from the north-west,
 * 45° altitude), tinted for a dark slate palette. Returns RGBA pixels, one per cell.
 */
export function hillshadeRGBA(g: ElevationGrid, exaggeration = 4): Uint8ClampedArray<ArrayBuffer> {
  const { cols, rows, values } = g;
  const out = new Uint8ClampedArray(cols * rows * 4);
  const midLat = ((g.north + g.south) / 2) * (Math.PI / 180);
  const dx = (((g.east - g.west) / cols) * 111_320 * Math.cos(midLat)) || 1;
  const dy = (((g.north - g.south) / rows) * 111_320) || 1;
  const az = (315 * Math.PI) / 180;
  const alt = (45 * Math.PI) / 180;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) if (!Number.isNaN(v)) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const at = (c: number, r: number) => {
    const v = values[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))] as number;
    return Number.isNaN(v) ? min : v;
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = at(c - 1, r - 1), b = at(c, r - 1), cc = at(c + 1, r - 1);
      const d = at(c - 1, r), f = at(c + 1, r);
      const gg = at(c - 1, r + 1), h = at(c, r + 1), i = at(c + 1, r + 1);
      const dzdx = (((cc + 2 * f + i) - (a + 2 * d + gg)) / (8 * dx)) * exaggeration;
      const dzdy = (((gg + 2 * h + i) - (a + 2 * b + cc)) / (8 * dy)) * exaggeration;
      const slope = Math.atan(Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      const shade = Math.max(0, Math.cos(alt) * Math.cos(slope) + Math.sin(alt) * Math.sin(slope) * Math.cos(az - aspect));
      const e = max > min ? (at(c, r) - min) / (max - min) : 0;
      const k = (r * cols + c) * 4;
      // Low ground reads cool and dark, high ground warmer and lighter.
      out[k] = 18 + shade * 120 + e * 40;
      out[k + 1] = 30 + shade * 135 + e * 25;
      out[k + 2] = 48 + shade * 150;
      out[k + 3] = 255;
    }
  }
  return out;
}