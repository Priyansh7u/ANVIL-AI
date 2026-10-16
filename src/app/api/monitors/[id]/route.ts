import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, parseJsonBody, parseQuery, rateLimit } from "@/lib/http";
import { nextRunFrom, publicMonitor } from "@/lib/monitors";
import { deleteById, findById, updateById } from "@/lib/repo";
import { clientOnlySchema, monitorUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";

async function owned(id: string, clientId: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const m = await findById("LocationMonitor", id);
  return m && m.clientId === clientId ? m : null;
}

/** Monitor status: last run, last success, failures, recent changes. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(req, "monitor-get", 120, 60_000);
  if (limited) return limited;
  const q = parseQuery(req, clientOnlySchema);
  if (!q.ok) return q.response;
  const m = await owned((await params).id, q.data.clientId);
  if (!m) return jsonError(404, "NOT_FOUND", "Monitor not found.");
  const staleWarning = m.lastSuccessAt && Date.now() - Date.parse(String(m.lastSuccessAt)) > 3 * Number(m.intervalMinutes) * 60_000 ? "No successful refresh for more than three intervals — results may be out of date." : null;
  return NextResponse.json({ monitor: publicMonitor(m), staleWarning }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(req, "monitor-update", 30, 60_000);
  if (limited) return limited;
  const body = await parseJsonBody(req, monitorUpdateSchema);
  if (!body.ok) return body.response;
  const m = await owned((await params).id, body.data.clientId);
  if (!m) return jsonError(404, "NOT_FOUND", "Monitor not found.");
  const set: Record<string, unknown> = {};
  if (body.data.active !== undefined) set.active = body.data.active;
  if (body.data.intervalMinutes !== undefined) {
    set.intervalMinutes = body.data.intervalMinutes;
    set.nextRunAt = nextRunFrom(String(m.lastRunAt ?? new Date().toISOString()), body.data.intervalMinutes);
  }
  const u = await updateById("LocationMonitor", m._id, set);
  return NextResponse.json({ monitor: u ? publicMonitor(u) : null });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(req, "monitor-delete", 30, 60_000);
  if (limited) return limited;
  const q = parseQuery(req, clientOnlySchema);
  if (!q.ok) return q.response;
  const m = await owned((await params).id, q.data.clientId);
  if (!m) return jsonError(404, "NOT_FOUND", "Monitor not found.");
  await deleteById("LocationMonitor", m._id);
  return NextResponse.json({ ok: true });
}