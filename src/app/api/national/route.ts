import { NextResponse, type NextRequest } from "next/server";
import { aggregateNational } from "@/lib/core/intelligence";
import { rateLimit } from "@/lib/http";
import { getAlerts } from "@/lib/sources/sachet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** All-India situation picture from the live SACHET feed (last 48 h). */
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "national", 60, 60_000);
  if (limited) return limited;
  const alerts = await getAlerts(null, "all");
  const now = new Date();
  const picture = aggregateNational(alerts.alerts, now);
  const latest = alerts.alerts
    .filter((a) => a.freshness === "ACTIVE")
    .slice(0, 25)
    .map((a) => ({ id: a.id, issuer: a.issuer, headline: a.headline, severity: a.severity, hazard: a.hazard, issuedAt: a.issuedAt, capUrl: a.capUrl }));
  return NextResponse.json(
    {
      generatedAt: now.toISOString(),
      feed: { dataMode: alerts.dataMode, retrievedAt: alerts.retrievedAt, feedPublishedAt: alerts.feedPublishedAt, sourceUrl: alerts.sourceUrl, error: alerts.error },
      ...picture,
      latest,
    },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}