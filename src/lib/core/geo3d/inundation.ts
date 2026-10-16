import { linesOf, verticesOf, type Geom, type Position, type Ring } from "./geojson";

/**
 * Hypothetical water-level ("connected bathtub") model.
 *
 * Water is raised to `waterSurfaceM` (metres above sea level) and spreads from
 * a seed cell to every 4-connected cell whose ground elevation is below that
 * surface. Depth = surface − ground. There is no rainfall, flow, drainage,
 * embankment, infiltration or time in this model: it is an illustration of
 * which low ground is connected to a point, NOT a flood prediction.
 */

export const SIMULATION_LABEL = "SIMULATED — NOT A REAL-TIME FLOOD PREDICTION";

/** Mapzen/AWS Terrarium encoding. */
export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

export interface ElevationGrid {
  west: number;
  south: number;
  east: number;
  north: number;
  cols: number;
  rows: number;
  /** Row-major, row 0 = northernmost. NaN = no data. */
  values: Float32Array;
}

export function cellCenter(g: ElevationGrid, col: number, row: number): Position {
  return [g.west + ((col + 0.5) / g.cols) * (g.east - g.west), g.north - ((row + 0.5) / g.rows) * (g.north - g.south)];
}

export function positionToCell(g: ElevationGrid, p: Position): { col: number; row: number } | null {
  const col = Math.floor(((p[0] - g.west) / (g.east - g.west)) * g.cols);
  const row = Math.floor(((g.north - p[1]) / (g.north - g.south)) * g.rows);
  return col >= 0 && col < g.cols && row >= 0 && row < g.rows ? { col, row } : null;
}

export function cellAreaKm2(g: ElevationGrid): number {
  const midLat = ((g.north + g.south) / 2) * (Math.PI / 180);
  const w = ((g.east - g.west) / g.cols) * 111.32 * Math.cos(midLat);
  const h = ((g.north - g.south) / g.rows) * 111.32;
  return w * h;
}

export interface InundationResult {
  mask: Uint8Array;
  depth: Float32Array;
  cells: number;
  areaKm2: number;
  maxDepth: number;
  meanDepth: number;
  seedElevation: number | null;
  waterSurfaceM: number;
  touchesEdge: boolean;
  noDataCells: number;
}

export function connectedInundation(g: ElevationGrid, seed: { col: number; row: number }, waterSurfaceM: number): InundationResult {
  const n = g.cols * g.rows;
  const mask = new Uint8Array(n);
  const depth = new Float32Array(n);
  let noData = 0;
  for (let i = 0; i < n; i++) if (Number.isNaN(g.values[i] as number)) noData++;
  const seedIdx = seed.row * g.cols + seed.col;
  const seedElev = g.values[seedIdx] as number;
  const empty: InundationResult = { mask, depth, cells: 0, areaKm2: 0, maxDepth: 0, meanDepth: 0, seedElevation: Number.isNaN(seedElev) ? null : seedElev, waterSurfaceM, touchesEdge: false, noDataCells: noData };
  if (Number.isNaN(seedElev) || seedElev >= waterSurfaceM) return empty;

  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  queue[tail++] = seedIdx;
  mask[seedIdx] = 1;
  let cells = 0;
  let sum = 0;
  let max = 0;
  let edge = false;
  while (head < tail) {
    const idx = queue[head++] as number;
    const d = waterSurfaceM - (g.values[idx] as number);
    depth[idx] = d;
    cells++;
    sum += d;
    if (d > max) max = d;
    const c = idx % g.cols;
    const r = (idx - c) / g.cols;
    if (c === 0 || r === 0 || c === g.cols - 1 || r === g.rows - 1) edge = true;
    const nb = [c > 0 ? idx - 1 : -1, c < g.cols - 1 ? idx + 1 : -1, r > 0 ? idx - g.cols : -1, r < g.rows - 1 ? idx + g.cols : -1];
    for (const j of nb) {
      if (j < 0 || mask[j]) continue;
      const e = g.values[j] as number;
      if (!Number.isNaN(e) && e < waterSurfaceM) {
        mask[j] = 1;
        queue[tail++] = j;
      }
    }
  }
  return { ...empty, mask, depth, cells, areaKm2: cells * cellAreaKm2(g), maxDepth: max, meanDepth: cells ? sum / cells : 0, touchesEdge: edge };
}

export const DEPTH_BANDS = [
  { max: 0.5, label: "0–0.5 m", color: "#7dd3fc" },
  { max: 1, label: "0.5–1 m", color: "#38bdf8" },
  { max: 2, label: "1–2 m", color: "#0284c7" },
  { max: 3, label: "2–3 m", color: "#1d4ed8" },
  { max: Infinity, label: "> 3 m", color: "#312e81" },
] as const;

export function depthBand(d: number): number {
  return DEPTH_BANDS.findIndex((b) => d <= b.max);
}

export interface CellFeature {
  type: "Feature";
  properties: { depth: number; band: number; color: string; simulated: true };
  geometry: { type: "Polygon"; coordinates: Ring[] };
}

/** Inundated cells as GeoJSON squares (one per cell) carrying depth and band. */
export function inundationCells(g: ElevationGrid, res: InundationResult): CellFeature[] {
  const out: CellFeature[] = [];
  const dx = (g.east - g.west) / g.cols;
  const dy = (g.north - g.south) / g.rows;
  for (let i = 0; i < res.mask.length; i++) {
    if (!res.mask[i]) continue;
    const c = i % g.cols;
    const r = (i - c) / g.cols;
    const w = g.west + c * dx;
    const n = g.north - r * dy;
    const d = res.depth[i] as number;
    const band = depthBand(d);
    out.push({
      type: "Feature",
      properties: { depth: Math.round(d * 10) / 10, band, color: DEPTH_BANDS[band]?.color ?? "#1d4ed8", simulated: true },
      geometry: { type: "Polygon", coordinates: [[[w, n], [w + dx, n], [w + dx, n - dy], [w, n - dy], [w, n]]] },
    });
  }
  return out;
}

/** Bilinear sample of a grid at a position (NaN outside or on missing data). */
export function sampleGrid(g: ElevationGrid, p: Position): number {
  const fx = ((p[0] - g.west) / (g.east - g.west)) * g.cols - 0.5;
  const fy = ((g.north - p[1]) / (g.north - g.south)) * g.rows - 0.5;
  const x0 = Math.max(0, Math.min(g.cols - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(g.rows - 1, Math.floor(fy)));
  const x1 = Math.min(g.cols - 1, x0 + 1);
  const y1 = Math.min(g.rows - 1, y0 + 1);
  const tx = Math.max(0, Math.min(1, fx - x0));
  const ty = Math.max(0, Math.min(1, fy - y0));
  const v = (x: number, y: number) => g.values[y * g.cols + x] as number;
  return (v(x0, y0) * (1 - tx) + v(x1, y0) * tx) * (1 - ty) + (v(x0, y1) * (1 - tx) + v(x1, y1) * tx) * ty;
}

/**
 * True when a geometry touches an inundated cell: any vertex, or any point
 * along its edges sampled at half the cell size, lies in a flooded cell.
 */
export function geomTouchesMask(g: ElevationGrid, res: InundationResult, geom: Geom): boolean {
  const inMask = (p: Position) => {
    const c = positionToCell(g, p);
    return c ? res.mask[c.row * g.cols + c.col] === 1 : false;
  };
  if (verticesOf(geom).some(inMask)) return true;
  const step = Math.min((g.east - g.west) / g.cols, (g.north - g.south) / g.rows) / 2;
  for (const line of linesOf(geom)) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1] as Position;
      const b = line[i] as Position;
      const n = Math.min(200, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (let k = 1; k < n; k++) if (inMask([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])) return true;
    }
  }
  return false;
}