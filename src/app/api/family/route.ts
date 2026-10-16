import { NextResponse, type NextRequest } from "next/server";
import { newGroupCode } from "@/lib/family";
import { parseJsonBody, rateLimit } from "@/lib/http";
import { create, storageMode } from "@/lib/repo";
import { familyCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";

/** Create a check-in group. Groups (and all statuses in them) auto-delete after 72 hours. */
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "family-create", 10, 60 * 60_000);
  if (limited) return limited;
  const body = await parseJsonBody(req, familyCreateSchema);
  if (!body.ok) return body.response;
  const expireAt = new Date(Date.now() + 72 * 3_600_000);
  const group = await create("FamilyCheckIn", { groupCode: newGroupCode(), groupName: body.data.groupName, members: [], expireAt });
  return NextResponse.json({ code: group.groupCode, expiresAt: expireAt.toISOString(), storage: storageMode() }, { status: 201 });
}
