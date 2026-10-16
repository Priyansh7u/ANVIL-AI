import { NextResponse, type NextRequest } from "next/server";
import { attentionIndex, corroborate, detectEscalation } from "@/lib/core/intelligence";
import { parseQuery, rateLimit } from "@/lib/http";
import { getAlerts } from "@/lib/sources/sachet";
import { sheltersQuerySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Explainable local intelligence for one district/state, computed from live official alerts. */
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "intelligence", 60, 60_000);
  if (limited) return limited;
  const q = parseQuery(req, sheltersQuerySchema);
  if (!q.ok) return q.response;
  const place = { district: q.data.district ?? null, state: q.data.state ?? null };
  const alerts = await getAlerts(place, "local");
  const now = new Date();
  return NextResponse.json(
    {
      generatedAt: now.toISOString(),
      feed: { dataMode: alerts.dataMode, retrievedAt: alerts.retrievedAt },
      attention: attentionIndex(alerts.alerts, alerts.dataMode !== "UNAVAILABLE", now),
      corroboration: corroborate(alerts.alerts),
      escalation: detectEscalation(alerts.alerts.filter((a) => a.relevance !== "NONE"), now),
    },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}