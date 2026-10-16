import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { TtlCache } from "@/lib/core/concurrency";
import { diffLive, planLive, type LiveShelter } from "@/lib/core/live-sim";
import { roadDistances } from "@/lib/geo";
import { jsonError, parseJsonBody, rateLimit } from "@/lib/http";
import { create, find, storageMode } from "@/lib/repo";
import { lat, lon, placeSchema } from "@/lib/validation";

export const runtime = "nodejs";

const bodySchema = z.object({
  place: placeSchema,
  origin: z.object({ lat, lon }),
  evacuees: z.number().int().min(0).max(1_000_000),
  assumedCapacity: z.number().int().min(1).max(100_000).default(300),
  closedShelterIds: z.array(z.string().max(64)).max(50).default([]),
  blockedRouteIds: z.array(z.string().max(64)).max(50).default([]),
  demandMultiplier: z.number().min(0.5).max(3).default(1),
});

const distanceCache = new TtlCache<{ distanceKm: number | null; durationMin: number | null }[]>(30 * 60_000, 200);

interface ShelterDoc {
  _id: string;
  name: string;
  address?: string | null;
  capacity?: number | null;
  location?: { lat?: number; lon?: number; precision?: string };
  verification?: { evidence?: { sourceUrl?: string; retrievedAt?: string } };
}

/**
 * Live-seeded what-if simulation: real documented shelters + real road
 * distances + user-entered assumptions. Always returns isSimulated: true.
 */
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "simulator-live", 30, 60_000);
  if (limited) return limited;
  const body = await parseJsonBody(req, bodySchema);
  if (!body.ok) return body.response;
  const { place, origin, ...inputs } = body.data;

  const filter: Record<string, unknown> = { "verification.status": "SOURCE_DOCUMENTED" };
  if (place.district) filter.district = place.district;
  if (place.state) filter.state = place.state;
  const docs = ((await find("Shelter", filter, { sortDesc: "updatedAt", limit: 40 })) as unknown as ShelterDoc[]).filter(
    (s) => s.location?.precision === "GEOCODED_ADDRESS" && typeof s.location.lat === "number" && typeof s.location.lon === "number",
  );
  if (docs.length === 0) {
    return jsonError(
      409,
      "NO_DOCUMENTED_SHELTERS",
      "No documented shelters with a map position exist for this district yet. Run the research agent first — the live simulator only uses shelters found on official pages.",
    );
  }

  const key = `${origin.lat},${origin.lon}|${docs.map((d) => d._id).join(",")}`;
  let distances = distanceCache.get(key)?.value;
  let routingNote: string | null = null;
  if (!distances) {
    try {
      distances = await roadDistances(origin, docs.map((d) => ({ lat: d.location!.lat as number, lon: d.location!.lon as number })));
      distanceCache.set(key, distances);
    } catch (e) {
      routingNote = `Road distances unavailable (${(e as Error).message}); shelters are used in listed order.`;
      distances = docs.map(() => ({ distanceKm: null, durationMin: null }));
    }
  }

  const shelters: LiveShelter[] = docs.map((d, i) => ({
    id: d._id,
    name: d.name,
    publishedCapacity: typeof d.capacity === "number" ? d.capacity : null,
    distanceKm: distances![i]?.distanceKm ?? null,
    durationMin: distances![i]?.durationMin ?? null,
    sourceUrl: d.verification?.evidence?.sourceUrl ?? "",
  }));

  const baseline = planLive(shelters, { ...inputs, closedShelterIds: [], blockedRouteIds: [], demandMultiplier: 1 });
  const plan = planLive(shelters, inputs);
  const changes = diffLive(baseline, plan);

  const session = await create("SimulationSession", {
    isSimulated: true,
    scenarioId: `live:${place.district ?? place.state ?? "area"}`,
    inputs: { closedShelterIds: plan.inputs.closedShelterIds, demandMultiplier: plan.inputs.demandMultiplier },
    summary: { mode: "LIVE_SEEDED", evacuees: plan.totalEvacuees, unmet: plan.unmet, actions: plan.actions, changes },
  }).catch(() => null);

  return NextResponse.json({
    isSimulated: true,
    mode: "LIVE_SEEDED",
    sessionId: session?._id ?? null,
    shelters: docs.map((d, i) => ({
      id: d._id,
      name: d.name,
      address: d.address ?? null,
      lat: d.location!.lat,
      lon: d.location!.lon,
      publishedCapacity: shelters[i]!.publishedCapacity,
      distanceKm: shelters[i]!.distanceKm,
      durationMin: shelters[i]!.durationMin,
      sourceUrl: shelters[i]!.sourceUrl,
      verifiedAt: d.verification?.evidence?.retrievedAt ?? null,
    })),
    baseline,
    plan,
    changes,
    routingNote,
    storage: storageMode(),
  });
}