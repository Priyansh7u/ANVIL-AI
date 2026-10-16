import { NextResponse, type NextRequest } from "next/server";
import { parseJsonBody, rateLimit } from "@/lib/http";
import { buildSafetyPlan } from "@/lib/plan";
import { create, find, storageMode } from "@/lib/repo";
import { planCreateSchema } from "@/lib/validation";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "plans", 10, 10 * 60_000);
  if (limited) return limited;
  const body = await parseJsonBody(req, planCreateSchema);
  if (!body.ok) return body.response;
  const { place, household, language, clientId } = body.data;
  const plan = await buildSafetyPlan(place, household, language);
  let id: string | null = null;
  if (clientId) {
    const saved = await create("SafetyPlan", { clientId, place, household, language, plan }).catch(() => null);
    id = saved?._id ?? null;
  }
  return NextResponse.json({ id, plan, storage: storageMode() });
}

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId") ?? "";
  if (!z.string().uuid().safeParse(clientId).success) return NextResponse.json({ plans: [] });
  const plans = await find("SafetyPlan", { clientId }, { sortDesc: "createdAt", limit: 5 });
  return NextResponse.json({ plans: plans.map((p) => ({ id: p._id, createdAt: p.createdAt, place: p.place, plan: p.plan })) });
}
