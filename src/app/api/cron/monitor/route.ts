import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { jsonError } from "@/lib/http";
import { runDueMonitors } from "@/lib/monitors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  if (!env.cronSecret) return false;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${env.cronSecret}`;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Called by a scheduler (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`).
 * Runs up to 2 due monitors per invocation so it fits the function time limit.
 */
export async function GET(req: NextRequest) {
  if (!env.cronSecret) return jsonError(503, "SCHEDULER_NOT_CONFIGURED", "Set CRON_SECRET to enable scheduled monitoring.");
  if (!authorized(req)) return jsonError(401, "UNAUTHORIZED", "Invalid scheduler credentials.");
  const started = new Date().toISOString();
  const result = await runDueMonitors(2);
  return NextResponse.json({ startedAt: started, finishedAt: new Date().toISOString(), ...result }, { headers: { "Cache-Control": "no-store" } });
}