import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, parseJsonBody, rateLimit } from "@/lib/http";
import { runMonitor } from "@/lib/monitors";
import { findById } from "@/lib/repo";
import { clientOnlySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Run a monitor now (user-initiated). The research runs after the 202 response. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(req, "monitor-run", 4, 10 * 60_000);
  if (limited) return limited;
  const body = await parseJsonBody(req, clientOnlySchema);
  if (!body.ok) return body.response;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return jsonError(400, "INVALID_INPUT", "Invalid monitor id");
  const m = await findById("LocationMonitor", id);
  if (!m || m.clientId !== body.data.clientId) return jsonError(404, "NOT_FOUND", "Monitor not found.");
  if (m.running && m.lastRunAt && Date.now() - Date.parse(String(m.lastRunAt)) < 6 * 60_000) return jsonError(409, "ALREADY_RUNNING", "This monitor is already running.");
  after(() => runMonitor(id));
  return NextResponse.json({ ok: true, status: "STARTED" }, { status: 202 });
}