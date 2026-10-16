import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, parseJsonBody, rateLimit } from "@/lib/http";
import { deleteMany, findOne, storageMode, upsert } from "@/lib/repo";
import { preferencesSchema } from "@/lib/validation";

export const runtime = "nodejs";

const uuid = z.string().uuid();

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId") ?? "";
  if (!uuid.safeParse(clientId).success) return jsonError(400, "INVALID_INPUT", "clientId must be a UUID");
  const prefs = await findOne("UserPreferences", { clientId });
  return NextResponse.json({ preferences: prefs, storage: storageMode() });
}

/** Stores district/state only — never coordinates. */
export async function PUT(req: NextRequest) {
  const limited = rateLimit(req, "prefs", 30, 60_000);
  if (limited) return limited;
  const body = await parseJsonBody(req, preferencesSchema);
  if (!body.ok) return body.response;
  const { clientId, ...rest } = body.data;
  const set: Record<string, unknown> = { expireAt: new Date(Date.now() + 180 * 86_400_000) };
  if (rest.place !== undefined) set.place = rest.place;
  if (rest.language) set.language = rest.language;
  for (const [k, v] of Object.entries(rest.accessibility ?? {})) set[`accessibility.${k}`] = v;
  for (const [k, v] of Object.entries(rest.notifications ?? {})) set[`notifications.${k}`] = v;
  const saved = await upsert("UserPreferences", { clientId }, set);
  return NextResponse.json({ preferences: saved, storage: storageMode() });
}

/** "Delete my data": removes preferences, saved plans and notification history for this client. */
export async function DELETE(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId") ?? "";
  if (!uuid.safeParse(clientId).success) return jsonError(400, "INVALID_INPUT", "clientId must be a UUID");
  const [prefs, plans, notes] = await Promise.all([
    deleteMany("UserPreferences", { clientId }),
    deleteMany("SafetyPlan", { clientId }),
    deleteMany("Notification", { clientId }),
  ]);
  return NextResponse.json({ deleted: { preferences: prefs, plans, notifications: notes } });
}
