import { NextResponse, type NextRequest } from "next/server";
import { summarizeRisk } from "@/lib/core/risk-analysis";
import { parseQuery, rateLimit } from "@/lib/http";
import { getAlerts } from "@/lib/sources/sachet";
import { alertsQuerySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "alerts", 60, 60_000);
  if (limited) return limited;
  const q = parseQuery(req, alertsQuerySchema);
  if (!q.ok) return q.response;
  const { district, state, scope } = q.data;
  const place = district || state ? { district: district ?? null, state: state ?? null } : null;

  const result = await getAlerts(place, place ? scope : "all");
  const risk = summarizeRisk(result.alerts, result.dataMode !== "UNAVAILABLE");
  return NextResponse.json(
    { ...result, risk, place },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
