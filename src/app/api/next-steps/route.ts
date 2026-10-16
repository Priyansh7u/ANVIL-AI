import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { buildNextSteps } from "@/lib/core/next-steps";
import type { VerifiedAdvisory, VerifiedContact, VerifiedRoadClosure, VerifiedShelter } from "@/lib/core/types";
import { parseJsonBody, rateLimit } from "@/lib/http";
import { find } from "@/lib/repo";
import { getAlerts } from "@/lib/sources/sachet";
import { householdSchema, placeSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  place: placeSchema,
  household: householdSchema.nullable().optional(),
  language: z.enum(["en", "hi"]).default("en"),
});

/** Practical next steps computed from live official alerts + verified research + household profile. */
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "next-steps", 60, 60_000);
  if (limited) return limited;
  const body = await parseJsonBody(req, bodySchema);
  if (!body.ok) return body.response;
  const { place, household, language } = body.data;

  const filter: Record<string, unknown> = { kind: "AREA_BRIEFING", "place.state": place.state };
  if (place.district) filter["place.district"] = place.district;
  const [alerts, tasks] = await Promise.all([getAlerts(place, "local"), find("ResearchTask", filter, { sortDesc: "createdAt", limit: 5 }).catch(() => [])]);
  const task = tasks.find((t) => t.status === "COMPLETED" || t.status === "PARTIAL");
  const r = (task?.result ?? {}) as { contacts?: VerifiedContact[]; shelters?: VerifiedShelter[]; advisories?: VerifiedAdvisory[]; roadClosures?: VerifiedRoadClosure[] };

  const steps = buildNextSteps({
    alerts: alerts.alerts,
    feedMode: alerts.dataMode,
    feedRetrievedAt: alerts.retrievedAt,
    placeLabel: place.label,
    household: household ?? null,
    language,
    research: task
      ? {
          finishedAt: (task.finishedAt as string | undefined) ?? null,
          contacts: r.contacts ?? [],
          shelters: r.shelters ?? [],
          advisories: r.advisories ?? [],
          roadClosures: r.roadClosures ?? [],
        }
      : null,
  });
  return NextResponse.json({ steps, feed: { dataMode: alerts.dataMode, retrievedAt: alerts.retrievedAt } }, { headers: { "Cache-Control": "no-store" } });
}