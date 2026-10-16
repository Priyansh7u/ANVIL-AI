import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requestCancel } from "@/lib/agent/hazard-research";
import { jsonError, parseJsonBody, rateLimit } from "@/lib/http";
import { findById } from "@/lib/repo";

export const runtime = "nodejs";

const body = z.object({ clientId: z.string().uuid().optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(req, "research-cancel", 20, 60_000);
  if (limited) return limited;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return jsonError(400, "INVALID_INPUT", "Invalid task id");
  const b = await parseJsonBody(req, body);
  if (!b.ok) return b.response;
  const task = await findById("ResearchTask", id);
  if (!task || task.kind !== "HAZARD_INTEL") return jsonError(404, "NOT_FOUND", "Task not found.");
  if (task.clientId && task.clientId !== b.data.clientId) return jsonError(403, "FORBIDDEN", "Only the browser that started this task can cancel it.");
  const r = await requestCancel(id);
  if (!r.ok) return jsonError(409, "NOT_RUNNING", `Task is already ${r.status.toLowerCase()}.`);
  return NextResponse.json({ ok: true, status: r.status }, { status: 202 });
}