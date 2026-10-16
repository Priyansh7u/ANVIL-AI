import { NextResponse, type NextRequest } from "next/server";
import { DEMO_SCENARIO, diffPlans, planResponse } from "@/lib/core/simulation";
import { parseJsonBody, rateLimit } from "@/lib/http";
import { create, storageMode } from "@/lib/repo";
import { simulatorSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET() {
  const baseline = planResponse(DEMO_SCENARIO, { closedShelterIds: [], demandMultiplier: 1 });
  return NextResponse.json({ isSimulated: true, scenario: DEMO_SCENARIO, baseline });
}

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "simulator", 60, 60_000);
  if (limited) return limited;
  const body = await parseJsonBody(req, simulatorSchema);
  if (!body.ok) return body.response;
  const baseline = planResponse(DEMO_SCENARIO, { closedShelterIds: [], demandMultiplier: 1 });
  const plan = planResponse(DEMO_SCENARIO, body.data);
  const changes = diffPlans(baseline, plan);
  const session = await create("SimulationSession", {
    isSimulated: true,
    scenarioId: DEMO_SCENARIO.id,
    inputs: plan.inputs,
    summary: { totalEvacuees: plan.totalEvacuees, unmet: plan.unmet, actions: plan.actions, changes },
  }).catch(() => null);
  return NextResponse.json({ isSimulated: true, sessionId: session?._id ?? null, plan, baseline, changes, storage: storageMode() });
}
