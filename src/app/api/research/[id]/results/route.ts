import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, rateLimit } from "@/lib/http";
import { find, findById, storageMode } from "@/lib/repo";

export const runtime = "nodejs";

/** Full task with its findings and sources. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(req, "research-results", 60, 60_000);
  if (limited) return limited;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return jsonError(400, "INVALID_INPUT", "Invalid task id");
  const task = await findById("ResearchTask", id);
  if (!task || task.kind !== "HAZARD_INTEL") {
    return jsonError(404, "NOT_FOUND", storageMode() === "EPHEMERAL" ? "Task not found. Storage is ephemeral on this server, so tasks are lost on restart." : "Task not found or expired.");
  }
  const [findings, sources] = await Promise.all([find("ResearchFinding", { taskId: id }, { limit: 200 }), find("ResearchSource", { taskId: id }, { limit: 200 })]);
  const { clientId: _c, ...rest } = task;
  void _c;
  return NextResponse.json(
    {
      task: { ...rest, id: task._id },
      findings: findings.map((f) => ({ ...f, id: f.fingerprint })),
      sources: sources.map((s) => ({ ...s, id: s._id })),
      storage: storageMode(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}