"use client";

import { lonLatToTile } from "@/lib/core/geo3d/spatial";
import { decodeTerrarium, type ElevationGrid } from "@/lib/core/geo3d/inundation";
import { TERRARIUM_TILES } from "./style";

/**
 * Reads real elevation from Terrarium PNG tiles in the browser (the same tiles
 * the map uses for terrain), so the water-level model and cursor readout use
 * measured ground heights rather than anything synthetic.
 */

const cache = new Map<string, Promise<ImageData | null>>();
const MAX_CACHE = 96;

function tileUrl(z: number, x: number, y: number) {
  return TERRARIUM_TILES.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

async function decodePng(blob: Blob): Promise<ImageData> {
  const bmp = await createImageBitmap(blob);
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement("canvas"), { width: bmp.width, height: bmp.height });
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function getTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<ImageData | null> {
  const n = 2 ** z;
  const xx = ((x % n) + n) % n;
  if (y < 0 || y >= n) return Promise.resolve(null);
  const key = `${z}/${xx}/${y}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = fetch(tileUrl(z, xx, y), { signal, mode: "cors" })
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then(decodePng)
    .catch(() => {
      cache.delete(key); // allow a later retry
      return null;
    });
  cache.set(key, p);
  if (cache.size > MAX_CACHE) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  return p;
}

function samplePixel(img: ImageData, px: number, py: number): number {
  const x = Math.max(0, Math.min(img.width - 1, Math.floor(px)));
  const y = Math.max(0, Math.min(img.height - 1, Math.floor(py)));
  const i = (y * img.width + x) * 4;
  return decodeTerrarium(img.data[i] as number, img.data[i + 1] as number, img.data[i + 2] as number);
}

export interface GridLoadResult {
  grid: ElevationGrid;
  zoom: number;
  tiles: number;
  failedTiles: number;
}

/** Sample a cols×rows elevation grid over a bbox, choosing the most detailed zoom that needs ≤ 16 tiles. */
export async function loadElevationGrid(b: { west: number; south: number; east: number; north: number }, cols: number, rows: number, signal?: AbortSignal): Promise<GridLoadResult> {
  let z = 14;
  for (; z > 5; z--) {
    const a = lonLatToTile(b.west, b.north, z);
    const c = lonLatToTile(b.east, b.south, z);
    if ((Math.floor(c.x) - Math.floor(a.x) + 1) * (Math.floor(c.y) - Math.floor(a.y) + 1) <= 16) break;
  }
  const a = lonLatToTile(b.west, b.north, z);
  const c = lonLatToTile(b.east, b.south, z);
  const tiles: { x: number; y: number }[] = [];
  for (let x = Math.floor(a.x); x <= Math.floor(c.x); x++) for (let y = Math.floor(a.y); y <= Math.floor(c.y); y++) tiles.push({ x, y });
  const imgs = await Promise.all(tiles.map((t) => getTile(z, t.x, t.y, signal)));
  const byKey = new Map(tiles.map((t, i) => [`${t.x}/${t.y}`, imgs[i] ?? null]));
  const values = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const lat = b.north - ((r + 0.5) / rows) * (b.north - b.south);
    for (let col = 0; col < cols; col++) {
      const lon = b.west + ((col + 0.5) / cols) * (b.east - b.west);
      const t = lonLatToTile(lon, lat, z);
      const img = byKey.get(`${Math.floor(t.x)}/${Math.floor(t.y)}`);
      values[r * cols + col] = img ? samplePixel(img, (t.x % 1) * img.width, (t.y % 1) * img.height) : Number.NaN;
    }
  }
  return { grid: { ...b, cols, rows, values }, zoom: z, tiles: tiles.length, failedTiles: imgs.filter((i) => !i).length };
}

/** Ground elevation (m) at a point from a zoom-12 tile, or null if unavailable. */
export async function elevationAt(lon: number, lat: number): Promise<number | null> {
  const z = 12;
  const t = lonLatToTile(lon, lat, z);
  const img = await getTile(z, Math.floor(t.x), Math.floor(t.y));
  return img ? Math.round(samplePixel(img, (t.x % 1) * img.width, (t.y % 1) * img.height)) : null;
}