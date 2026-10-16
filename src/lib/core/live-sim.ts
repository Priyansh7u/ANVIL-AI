/**
 * Live-seeded what-if simulation.
 *
 * Seeds come from REAL data: shelters documented on official pages for the
 * user's district (name, published capacity, geocoded address) and REAL road
 * distances from the routing provider. Inputs the data cannot provide —
 * number of evacuees, capacity where none is published, a hypothetical
 * closure — are entered by the user and labelled as assumptions.
 * The output is a simulation, never a prediction, and is always tagged.
 */

export interface LiveShelter {
  id: string;
  name: string;
  publishedCapacity: number | null;
  distanceKm: number | null;
  durationMin: number | null;
  sourceUrl: string;
}

export interface LiveSimInputs {
  evacuees: number;
  /** used only for shelters with no published capacity */
  assumedCapacity: number;
  closedShelterIds: string[];
  /** simulated road closure: the route to this shelter is blocked */
  blockedRouteIds: string[];
  demandMultiplier: number;
}

export interface LiveSimPlan {
  isSimulated: true;
  inputs: LiveSimInputs;
  totalEvacuees: number;
  sheltered: number;
  unmet: number;
  allocations: { shelterId: string; people: number; distanceKm: number | null }[];
  utilization: { shelterId: string; name: string; used: number; capacity: number; capacityAssumed: boolean; state: "OPEN" | "CLOSED" | "ROUTE_BLOCKED" }[];
  resources: { foodPacketsPerDay: number; waterLitresPerDay: number; vehicleTrips: number };
  actions: string[];
  avgTravelKm: number | null;
}

export const LIVE_ASSUMPTIONS = {
  mealsPerPersonPerDay: 3,
  waterLitresPerPersonPerDay: 15,
  peoplePerVehicleTrip: 40,
  walkableKm: 3,
} as const;

export function clampLiveInputs(shelters: LiveShelter[], raw: LiveSimInputs): LiveSimInputs {
  const ids = new Set(shelters.map((s) => s.id));
  const n = (v: number, lo: number, hi: number, d: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return {
    evacuees: Math.round(n(raw.evacuees, 0, 1_000_000, 0)),
    assumedCapacity: Math.round(n(raw.assumedCapacity, 1, 100_000, 300)),
    closedShelterIds: Array.from(new Set(raw.closedShelterIds.filter((i) => ids.has(i)))),
    blockedRouteIds: Array.from(new Set(raw.blockedRouteIds.filter((i) => ids.has(i)))),
    demandMultiplier: n(raw.demandMultiplier, 0.5, 3, 1),
  };
}

export function planLive(shelters: LiveShelter[], rawInputs: LiveSimInputs): LiveSimPlan {
  const inputs = clampLiveInputs(shelters, rawInputs);
  const closed = new Set(inputs.closedShelterIds);
  const blocked = new Set(inputs.blockedRouteIds);
  const total = Math.round(inputs.evacuees * inputs.demandMultiplier);

  const capacityOf = (s: LiveShelter) => s.publishedCapacity ?? inputs.assumedCapacity;
  const usable = shelters
    .filter((s) => !closed.has(s.id) && !blocked.has(s.id))
    .sort((a, b) => (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY));

  let remaining = total;
  const used = new Map<string, number>();
  const allocations: LiveSimPlan["allocations"] = [];
  for (const s of usable) {
    if (remaining <= 0) break;
    const take = Math.min(capacityOf(s), remaining);
    if (take <= 0) continue;
    used.set(s.id, take);
    remaining -= take;
    allocations.push({ shelterId: s.id, people: take, distanceKm: s.distanceKm });
  }
  const sheltered = total - remaining;

  const utilization = shelters.map((s) => ({
    shelterId: s.id,
    name: s.name,
    used: used.get(s.id) ?? 0,
    capacity: capacityOf(s),
    capacityAssumed: s.publishedCapacity === null,
    state: closed.has(s.id) ? ("CLOSED" as const) : blocked.has(s.id) ? ("ROUTE_BLOCKED" as const) : ("OPEN" as const),
  }));

  const far = allocations.filter((a) => (a.distanceKm ?? 0) > LIVE_ASSUMPTIONS.walkableKm).reduce((n, a) => n + a.people, 0);
  const known = allocations.filter((a) => a.distanceKm !== null);
  const avgTravelKm = known.length
    ? Math.round((known.reduce((n, a) => n + (a.distanceKm as number) * a.people, 0) / Math.max(1, known.reduce((n, a) => n + a.people, 0))) * 10) / 10
    : null;

  const actions: string[] = [];
  const name = (id: string) => shelters.find((s) => s.id === id)?.name ?? id;
  inputs.closedShelterIds.forEach((id) => actions.push(`${name(id)} unavailable — its evacuees are redirected to the next nearest documented shelter.`));
  inputs.blockedRouteIds.forEach((id) => actions.push(`Route to ${name(id)} blocked (simulated road closure) — confirm alternative access with district control room.`));
  if (remaining > 0) actions.push(`Shortfall: ${remaining.toLocaleString("en-IN")} people have no documented shelter place — request additional relief camps from the district administration.`);
  utilization.filter((u) => u.state === "OPEN" && u.used >= u.capacity * 0.9 && u.used > 0).forEach((u) => actions.push(`${u.name} at ${Math.round((u.used / u.capacity) * 100)}% of ${u.capacityAssumed ? "assumed" : "published"} capacity — pre-position food, water and medical support.`));
  if (far > 0) actions.push(`${far.toLocaleString("en-IN")} people assigned to shelters beyond ${LIVE_ASSUMPTIONS.walkableKm} km — plan about ${Math.ceil(far / LIVE_ASSUMPTIONS.peoplePerVehicleTrip)} vehicle trips.`);
  if (shelters.some((s) => s.distanceKm === null)) actions.push("Some shelters have no road distance (address could not be routed) — they are used last.");

  return {
    isSimulated: true,
    inputs,
    totalEvacuees: total,
    sheltered,
    unmet: remaining,
    allocations,
    utilization,
    resources: {
      foodPacketsPerDay: sheltered * LIVE_ASSUMPTIONS.mealsPerPersonPerDay,
      waterLitresPerDay: sheltered * LIVE_ASSUMPTIONS.waterLitresPerPersonPerDay,
      vehicleTrips: Math.ceil(far / LIVE_ASSUMPTIONS.peoplePerVehicleTrip),
    },
    actions,
    avgTravelKm,
  };
}

export function diffLive(base: LiveSimPlan, next: LiveSimPlan): string[] {
  const out: string[] = [];
  if (base.totalEvacuees !== next.totalEvacuees) out.push(`Evacuees ${base.totalEvacuees} → ${next.totalEvacuees}`);
  if (base.unmet !== next.unmet) out.push(`Without shelter ${base.unmet} → ${next.unmet}`);
  if (base.avgTravelKm !== next.avgTravelKm) out.push(`Average travel ${base.avgTravelKm ?? "?"} km → ${next.avgTravelKm ?? "?"} km`);
  for (const u of next.utilization) {
    const b = base.utilization.find((x) => x.shelterId === u.shelterId);
    if (b && b.used !== u.used) out.push(`${u.name}: ${b.used} → ${u.used} people`);
  }
  if (base.resources.vehicleTrips !== next.resources.vehicleTrips) out.push(`Vehicle trips ${base.resources.vehicleTrips} → ${next.resources.vehicleTrips}`);
  return out;
}