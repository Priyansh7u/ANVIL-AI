import { after, NextResponse, type NextRequest } from "next/server";
import { createHazardTask, latestReport, runHazardTask } from "@/lib/agent/hazard-research";
import { capabilityFlags } from "@/lib/env";
import { parseJsonBody, parseQuery, rateLimit } from "@/lib/http";
import { find, storageMode } from "@/lib/repo";
import { liveResearchCreateSchema, liveResearchListSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 300; // the research continues after the 202 via after()

/** Start a live hazard-research task. Progress: GET /api/research/[id]/stream (SSE) or /api/research/[id] (polling). */
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "research-live", 6, 10 * 60_000);
  if (limited) return limited;
  const body = await parseJsonBody(req, liveResearchCreateSchema);
  if (!body.ok) return body.response;
  const task = await createHazardTask({ place: body.data.place, hazard: body.data.hazard, clientId: body.data.clientId });
  after(() => runHazardTask(task._id));
  return NextResponse.json({ id: task._id, stage: task.stage, capabilities: capabilityFlags(), storage: storageMode() }, { status: 202 });
}

/** History of live research tasks (by client or by place) plus the latest usable report for the place. */
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "research-live-list", 60, 60_000);
  if (limited) return limited;
  const q = parseQuery(req, liveResearchListSchema);
  if (!q.ok) return q.response;
  const filter: Record<string, unknown> = { kind: "HAZARD_INTEL" };
  if (q.data.clientId) filter.clientId = q.data.clientId;
  if (q.data.state) filter["place.state"] = q.data.state;
  if (q.data.district) filter["place.district"] = q.data.district;
  if (q.data.hazard) filter.hazard = q.data.hazard;
  const tasks = await find("ResearchTask", filter, { sortDesc: "createdAt", limit: 20 });
  const latest = (q.data.state || q.data.district) && q.data.hazard ? await latestReport({ district: q.data.district ?? null, state: q.data.state ?? null }, q.data.hazard) : null;
  return NextResponse.json(
    {
      tasks: tasks.map((t) => ({
        id: t._id,
        place: t.place,
        hazard: t.hazard,
        status: t.status,
        stage: t.stage,
        trigger: t.trigger ?? "USER",
        counts: t.counts ?? {},
        insufficientEvidence: (t.report as { insufficientEvidence?: boolean } | undefined)?.insufficientEvidence ?? null,
        createdAt: t.createdAt,
        finishedAt: t.finishedAt ?? null,
      })),
      latestUsableTaskId: latest?._id ?? null,
      capabilities: capabilityFlags(),
      storage: storageMode(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}