import { NextResponse, type NextRequest } from "next/server";
import { capabilityFlags } from "@/lib/env";
import { jsonError, parseJsonBody, parseQuery, rateLimit } from "@/lib/http";
import { MAX_MONITORS_PER_CLIENT, publicMonitor } from "@/lib/monitors";
import { create, find, storageMode } from "@/lib/repo";
import { clientOnlySchema, monitorCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";

function schedulerInfo() {
  const caps = capabilityFlags();
  return {
    configured: caps.scheduler,
    note: caps.scheduler
      ? "Monitors run when the scheduler calls /api/cron/monitor. Actual cadence depends on how often your host's cron fires (e.g. Vercel Hobby allows one run per day)."
      : "No scheduler is configured (CRON_SECRET not set). Monitors only run when you press Run now.",
  };
}

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "monitors-list", 60, 60_000);
  if (limited) return limited;
  const q = parseQuery(req, clientOnlySchema);
  if (!q.ok) return q.response;
  const rows = await find("LocationMonitor", { clientId: q.data.clientId }, { sortDesc: "createdAt", limit: 20 });
  return NextResponse.json({ monitors: rows.map(publicMonitor), scheduler: schedulerInfo(), storage: storageMode() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "monitors-create", 10, 60 * 60_000);
  if (limited) return limited;
  const body = await parseJsonBody(req, monitorCreateSchema);
  if (!body.ok) return body.response;
  const existing = await find("LocationMonitor", { clientId: body.data.clientId }, { limit: 50 });
  if (existing.length >= MAX_MONITORS_PER_CLIENT) return jsonError(409, "LIMIT_REACHED", `You can monitor up to ${MAX_MONITORS_PER_CLIENT} locations.`);
  const dup = existing.find((m) => (m.place as { label?: string })?.label === body.data.place.label && m.hazard === body.data.hazard);
  if (dup) return jsonError(409, "DUPLICATE", "This location and hazard are already monitored.");
  const m = await create("LocationMonitor", {
    clientId: body.data.clientId,
    place: body.data.place,
    hazard: body.data.hazard,
    intervalMinutes: body.data.intervalMinutes,
    active: true,
    nextRunAt: new Date().toISOString(),
    knownItems: {},
    changes: [],
    consecutiveFailures: 0,
    running: false,
  });
  return NextResponse.json({ monitor: publicMonitor(m), scheduler: schedulerInfo(), storage: storageMode() }, { status: 201 });
}