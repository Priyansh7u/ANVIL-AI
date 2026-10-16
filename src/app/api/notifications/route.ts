import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseJsonBody, rateLimit } from "@/lib/http";
import { find, storageMode, upsert } from "@/lib/repo";
import { notificationLogSchema } from "@/lib/validation";

export const runtime = "nodejs";

/** History of in-browser notifications ANVIL displayed for this anonymous client. */
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId") ?? "";
  if (!z.string().uuid().safeParse(clientId).success) return NextResponse.json({ notifications: [] });
  const rows = await find("Notification", { clientId }, { sortDesc: "deliveredAt", limit: 50 });
  return NextResponse.json({ notifications: rows, storage: storageMode() });
}

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "notifications", 30, 60_000);
  if (limited) return limited;
  const body = await parseJsonBody(req, notificationLogSchema);
  if (!body.ok) return body.response;
  const { clientId, alertId, title, severity } = body.data;
  const row = await upsert("Notification", { clientId, alertId }, { title, severity, channel: "browser", deliveredAt: new Date().toISOString() });
  return NextResponse.json({ ok: true, id: row._id });
}
