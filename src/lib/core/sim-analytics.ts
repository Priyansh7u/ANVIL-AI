import { planLive, type LiveShelter, type LiveSimInputs, type LiveSimPlan } from "./live-sim";

/**
 * Decision-support analytics on top of the live-seeded simulator.
 * Everything here re-runs the same deterministic planner (planLive) under
 * hypothetical conditions, so every number is a SIMULATION and is labelled so.
 */

// ── Single-point-of-failure stress test ──────────────────────────────────────

export interface CriticalShelter {
  shelterId: string;
  name: string;
  /** Extra people left without a shelter place if this one becomes unavailable. */
  extraUnmet: number;
  /** Change in average travel distance (km) when it is unavailable; null if unknown. */
  extraAvgKm: number | null;
  /** People it serves in the current scenario. */
  serving: number;
}

/** Closes each currently-open shelter in turn and measures the damage. Sorted worst first. */
export function criticalShelters(shelters: LiveShelter[], inputs: LiveSimInputs): CriticalShelter[] {
  const base = planLive(shelters, inputs);
  const unavailable = new Set([...inputs.closedShelterIds, ...inputs.blockedRouteIds]);
  return shelters
    .filter((s) => !unavailable.has(s.id))
    .map((s) => {
      const p = planLive(shelters, { ...inputs, closedShelterIds: [...inputs.closedShelterIds, s.id] });
      const serving = base.allocations.find((a) => a.shelterId === s.id)?.people ?? 0;
      return {
        shelterId: s.id,
        name: s.name,
        extraUnmet: p.unmet - base.unmet,
        extraAvgKm: base.avgTravelKm != null && p.avgTravelKm != null ? Math.round((p.avgTravelKm - base.avgTravelKm) * 10) / 10 : null,
        serving,
      };
    })
    .sort((a, b) => b.extraUnmet - a.extraUnmet || (b.extraAvgKm ?? 0) - (a.extraAvgKm ?? 0) || b.serving - a.serving);
}

// ── Monte Carlo: random independent failures ─────────────────────────────────

/** Small, fast, seedable PRNG so a run is reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i] as number;
}

export interface MonteCarloResult {
  runs: number;
  /** Assumed independent chance that each open shelter's road becomes unusable. */
  pFail: number;
  /** Share of runs (0–1) in which everyone found a shelter place. */
  fullyShelteredShare: number;
  unmetP50: number;
  unmetP90: number;
  unmetMax: number;
  /** Histogram of unmet people across runs, in `bins` equal-width buckets. */
  histogram: { from: number; to: number; runs: number }[];
  /** Per shelter: share of runs in which it was over 90% full. */
  strain: { shelterId: string; name: string; overloadedShare: number }[];
}

export function monteCarlo(shelters: LiveShelter[], inputs: LiveSimInputs, opts: { runs?: number; pFail?: number; seed?: number; bins?: number } = {}): MonteCarloResult {
  const runs = Math.max(1, Math.min(2000, Math.round(opts.runs ?? 300)));
  const pFail = Math.min(0.9, Math.max(0, opts.pFail ?? 0.15));
  const bins = Math.max(1, Math.min(20, opts.bins ?? 8));
  const rnd = mulberry32(opts.seed ?? 42);
  const unavailable = new Set([...inputs.closedShelterIds, ...inputs.blockedRouteIds]);
  const open = shelters.filter((s) => !unavailable.has(s.id));

  const unmet: number[] = [];
  const overloaded = new Map<string, number>();
  let full = 0;
  for (let r = 0; r < runs; r++) {
    const failed = open.filter(() => rnd() < pFail).map((s) => s.id);
    const p: LiveSimPlan = planLive(shelters, { ...inputs, blockedRouteIds: [...inputs.blockedRouteIds, ...failed] });
    unmet.push(p.unmet);
    if (p.unmet === 0) full++;
    for (const u of p.utilization) if (u.state === "OPEN" && u.used > 0 && u.used >= u.capacity * 0.9) overloaded.set(u.shelterId, (overloaded.get(u.shelterId) ?? 0) + 1);
  }
  const sorted = [...unmet].sort((a, b) => a - b);
  const max = sorted[sorted.length - 1] ?? 0;
  const width = Math.max(1, Math.ceil((max + 1) / bins));
  const histogram = Array.from({ length: bins }, (_, i) => ({ from: i * width, to: (i + 1) * width - 1, runs: 0 }));
  for (const v of unmet) {
    const bin = histogram[Math.min(bins - 1, Math.floor(v / width))];
    if (bin) bin.runs++;
  }
  return {
    runs,
    pFail,
    fullyShelteredShare: full / runs,
    unmetP50: quantile(sorted, 0.5),
    unmetP90: quantile(sorted, 0.9),
    unmetMax: max,
    histogram,
    strain: shelters.map((s) => ({ shelterId: s.id, name: s.name, overloadedShare: (overloaded.get(s.id) ?? 0) / runs })).sort((a, b) => b.overloadedShare - a.overloadedShare),
  };
}

// ── Arrival timeline ─────────────────────────────────────────────────────────

/** Cumulative share of evacuees who have set out by hour h (logistic curve, an assumption). */
export function arrivalShare(h: number, halfTimeH: number, steepness = 0.9): number {
  const raw = (t: number) => 1 / (1 + Math.exp(-steepness * (t - halfTimeH)));
  // Normalise so the curve starts at exactly 0 at h = 0.
  const r0 = raw(0);
  return Math.min(1, Math.max(0, (raw(h) - r0) / (1 - r0)));
}

export interface TimelinePoint {
  hour: number;
  arrived: number;
  sheltered: number;
  unmet: number;
  /** Highest load of any open shelter, as a share of its capacity. */
  peakLoad: number;
}

export function arrivalTimeline(shelters: LiveShelter[], inputs: LiveSimInputs, opts: { hours?: number; halfTimeH?: number } = {}): TimelinePoint[] {
  const hours = Math.max(1, Math.min(72, Math.round(opts.hours ?? 12)));
  const half = opts.halfTimeH ?? hours / 3;
  const total = Math.round(inputs.evacuees * inputs.demandMultiplier);
  const out: TimelinePoint[] = [];
  for (let h = 0; h <= hours; h++) {
    const arrived = h === hours ? total : Math.round(total * arrivalShare(h, half));
    // Feed the arrivals as evacuees with multiplier 1 so the planner sees the real head-count at hour h.
    const p = planLive(shelters, { ...inputs, evacuees: arrived, demandMultiplier: 1 });
    const peakLoad = p.utilization.filter((u) => u.state === "OPEN" && u.capacity > 0).reduce((m, u) => Math.max(m, u.used / u.capacity), 0);
    out.push({ hour: h, arrived, sheltered: p.sheltered, unmet: p.unmet, peakLoad: Math.round(peakLoad * 100) / 100 });
  }
  return out;
}