/**
 * What-If simulator. Everything here is SYNTHETIC: a fictional district with
 * invented shelters and populations, used to demonstrate how a response plan
 * re-balances. Results are always tagged `isSimulated: true` and must never be
 * displayed alongside live official alerts without that label.
 */

export type RiskLevel = "high" | "medium" | "low";

export interface SimShelter {
  id: string;
  name: string;
  capacity: number;
  x: number; // km on a local grid
  y: number;
  accessible: boolean;
}

export interface SimZone {
  id: string;
  name: string;
  population: number;
  risk: RiskLevel;
  x: number;
  y: number;
}

export interface SimScenario {
  id: string;
  title: string;
  description: string;
  shelters: SimShelter[];
  zones: SimZone[];
}

export interface SimInputs {
  closedShelterIds: string[];
  /** 1 = baseline evacuation demand, 1.5 = 50% more people need shelter */
  demandMultiplier: number;
}

export interface Allocation {
  zoneId: string;
  shelterId: string;
  people: number;
  distanceKm: number;
}

export interface SimPlan {
  isSimulated: true;
  scenarioId: string;
  inputs: SimInputs;
  totalEvacuees: number;
  allocations: Allocation[];
  unmet: { zoneId: string; people: number }[];
  utilization: { shelterId: string; name: string; used: number; capacity: number; open: boolean }[];
  resources: { foodPacketsPerDay: number; waterLitresPerDay: number; medicalTeams: number; vehiclesNeeded: number };
  actions: string[];
}

/** Planning assumptions — illustrative, not official norms. */
export const EVACUATION_RATE: Record<RiskLevel, number> = { high: 0.6, medium: 0.25, low: 0.05 };
export const ASSUMPTIONS = {
  mealsPerPersonPerDay: 3,
  waterLitresPerPersonPerDay: 15, // Sphere Handbook minimum for drinking + cooking + hygiene
  peoplePerMedicalTeam: 500,
  peoplePerVehicleTrip: 40,
  maxWalkingKm: 3,
} as const;

export const DEMO_SCENARIO: SimScenario = {
  id: "riverbend-flood-v1",
  title: "Riverbend District riverine flood (fictional)",
  description:
    "SIMULATION: a fictional district where a river crosses the danger mark after 72 h of heavy rain. All names, numbers and locations are invented.",
  shelters: [
    { id: "S1", name: "Govt. School Hall A (sim)", capacity: 900, x: 2, y: 3, accessible: true },
    { id: "S2", name: "Community Centre B (sim)", capacity: 600, x: 6, y: 1, accessible: false },
    { id: "S3", name: "College Campus C (sim)", capacity: 1500, x: 8, y: 6, accessible: true },
    { id: "S4", name: "Stadium D (sim)", capacity: 2000, x: 12, y: 2, accessible: true },
  ],
  zones: [
    { id: "Z1", name: "Low-lying Ward 1 (sim)", population: 2400, risk: "high", x: 1, y: 1 },
    { id: "Z2", name: "Riverside Ward 2 (sim)", population: 1800, risk: "high", x: 5, y: 2 },
    { id: "Z3", name: "Market Ward 3 (sim)", population: 3000, risk: "medium", x: 7, y: 4 },
    { id: "Z4", name: "Hillside Ward 4 (sim)", population: 2500, risk: "low", x: 11, y: 6 },
  ],
};

const RISK_ORDER: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 };

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.round(Math.hypot(a.x - b.x, a.y - b.y) * 10) / 10;
}

export function clampInputs(scenario: SimScenario, inputs: SimInputs): SimInputs {
  const ids = new Set(scenario.shelters.map((s) => s.id));
  const multiplier = Number.isFinite(inputs.demandMultiplier) ? inputs.demandMultiplier : 1;
  return {
    closedShelterIds: Array.from(new Set(inputs.closedShelterIds.filter((id) => ids.has(id)))),
    demandMultiplier: Math.min(3, Math.max(0.5, multiplier)),
  };
}

export function planResponse(scenario: SimScenario, rawInputs: SimInputs): SimPlan {
  const inputs = clampInputs(scenario, rawInputs);
  const closed = new Set(inputs.closedShelterIds);
  const remaining = new Map(scenario.shelters.map((s) => [s.id, closed.has(s.id) ? 0 : s.capacity]));
  const allocations: Allocation[] = [];
  const unmet: { zoneId: string; people: number }[] = [];
  let totalEvacuees = 0;

  const zones = [...scenario.zones].sort(
    (a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || b.population - a.population,
  );

  for (const zone of zones) {
    let need = Math.round(zone.population * EVACUATION_RATE[zone.risk] * inputs.demandMultiplier);
    totalEvacuees += need;
    const candidates = scenario.shelters
      .filter((s) => !closed.has(s.id))
      .sort((a, b) => dist(zone, a) - dist(zone, b));
    for (const s of candidates) {
      if (need <= 0) break;
      const free = remaining.get(s.id) ?? 0;
      if (free <= 0) continue;
      const take = Math.min(free, need);
      remaining.set(s.id, free - take);
      need -= take;
      allocations.push({ zoneId: zone.id, shelterId: s.id, people: take, distanceKm: dist(zone, s) });
    }
    if (need > 0) unmet.push({ zoneId: zone.id, people: need });
  }

  const utilization = scenario.shelters.map((s) => ({
    shelterId: s.id,
    name: s.name,
    capacity: s.capacity,
    open: !closed.has(s.id),
    used: closed.has(s.id) ? 0 : s.capacity - (remaining.get(s.id) ?? 0),
  }));

  const sheltered = allocations.reduce((n, a) => n + a.people, 0);
  const longTrips = allocations.filter((a) => a.distanceKm > ASSUMPTIONS.maxWalkingKm);
  const transported = longTrips.reduce((n, a) => n + a.people, 0);

  const actions: string[] = [];
  const zoneName = (id: string) => scenario.zones.find((z) => z.id === id)?.name ?? id;
  const shelterName = (id: string) => scenario.shelters.find((s) => s.id === id)?.name ?? id;
  for (const id of inputs.closedShelterIds) {
    actions.push(`${shelterName(id)} unavailable — redirect its assigned evacuees.`);
  }
  for (const u of unmet) {
    actions.push(`Shortfall: ${u.people} people from ${zoneName(u.zoneId)} have no shelter place — request temporary relief camps.`);
  }
  for (const s of utilization.filter((u) => u.open && u.used / u.capacity >= 0.9)) {
    actions.push(`${s.name} at ${Math.round((s.used / s.capacity) * 100)}% capacity — pre-position extra supplies.`);
  }
  if (transported > 0) {
    actions.push(`${transported} people assigned beyond ${ASSUMPTIONS.maxWalkingKm} km — arrange ${Math.ceil(transported / ASSUMPTIONS.peoplePerVehicleTrip)} vehicle trips.`);
  }
  for (const a of allocations.filter((x) => !scenario.shelters.find((s) => s.id === x.shelterId)?.accessible)) {
    actions.push(`${shelterName(a.shelterId)} is not step-free — route people with mobility needs from ${zoneName(a.zoneId)} elsewhere.`);
  }

  return {
    isSimulated: true,
    scenarioId: scenario.id,
    inputs,
    totalEvacuees,
    allocations,
    unmet,
    utilization,
    resources: {
      foodPacketsPerDay: sheltered * ASSUMPTIONS.mealsPerPersonPerDay,
      waterLitresPerDay: sheltered * ASSUMPTIONS.waterLitresPerPersonPerDay,
      medicalTeams: Math.ceil(sheltered / ASSUMPTIONS.peoplePerMedicalTeam),
      vehiclesNeeded: Math.ceil(transported / ASSUMPTIONS.peoplePerVehicleTrip),
    },
    actions,
  };
}

export function diffPlans(base: SimPlan, next: SimPlan): string[] {
  const changes: string[] = [];
  const delta = (a: number, b: number) => (b - a >= 0 ? `+${b - a}` : `${b - a}`);
  if (base.totalEvacuees !== next.totalEvacuees) {
    changes.push(`Evacuees ${base.totalEvacuees} → ${next.totalEvacuees} (${delta(base.totalEvacuees, next.totalEvacuees)})`);
  }
  const unmetA = base.unmet.reduce((n, u) => n + u.people, 0);
  const unmetB = next.unmet.reduce((n, u) => n + u.people, 0);
  if (unmetA !== unmetB) changes.push(`Unsheltered ${unmetA} → ${unmetB} (${delta(unmetA, unmetB)})`);
  for (const u of next.utilization) {
    const b = base.utilization.find((x) => x.shelterId === u.shelterId);
    if (b && b.used !== u.used) changes.push(`${u.name}: ${b.used} → ${u.used} people`);
  }
  if (base.resources.vehiclesNeeded !== next.resources.vehiclesNeeded) {
    changes.push(`Vehicle trips ${base.resources.vehiclesNeeded} → ${next.resources.vehiclesNeeded}`);
  }
  return changes;
}
