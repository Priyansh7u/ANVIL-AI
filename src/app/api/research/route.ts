import { after, NextResponse, type NextRequest } from "next/server";
import { createResearchTask, runResearchTask } from "@/lib/agent/research";
import { capabilityFlags } from "@/lib/env";
import { jsonError, parseJsonBody, parseQuery, rateLimit } from "@/lib/http";
import { find, storageMode } from "@/lib/repo";
import { researchCreateSchema, sheltersQuerySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 300; // the agent runs after the response via after()

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "research", 5, 10 * 60_000);
  if (limited) return limited;
  const body = await parseJsonBody(req, researchCreateSchema);
  if (!body.ok) return body.response;

  const caps = capabilityFlags();
  if (!caps.tinyfish) {
    return jsonError(503, "TINYFISH_NOT_CONFIGURED", "The research agent needs TINYFISH_API_KEY on the server. No research was run.");
  }
  const task = await createResearchTask(body.data.place);
  // Runs after the 202 response is sent; progress is persisted and polled via GET /api/research/[id].
  after(() => runResearchTask(task._id));
  return NextResponse.json({ id: task._id, status: task.status, storage: storageMode() }, { status: 202 });
}

export async function GET(req: NextRequest) {
  const q = parseQuery(req, sheltersQuerySchema);
  if (!q.ok) return q.response;
  const filter: Record<string, unknown> = { kind: "AREA_BRIEFING" };
  if (q.data.district) filter["place.district"] = q.data.district;
  if (q.data.state) filter["place.state"] = q.data.state;
  const tasks = await find("ResearchTask", filter, { sortDesc: "createdAt", limit: 10 });
  return NextResponse.json({
    tasks: tasks.map((t) => ({ id: t._id, place: t.place, status: t.status, createdAt: t.createdAt, finishedAt: t.finishedAt ?? null })),
    storage: storageMode(),
  });
}