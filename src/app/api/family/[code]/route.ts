import { NextResponse, type NextRequest } from "next/server";
import { newMemberToken, publicMembers, tokenMatches, type FamilyMember } from "@/lib/family";
import { jsonError, parseJsonBody, rateLimit } from "@/lib/http";
import { findOne, updateById } from "@/lib/repo";
import { familyCodeSchema, familyLeaveSchema, familyStatusSchema } from "@/lib/validation";

export const runtime = "nodejs";

type Params = { params: Promise<{ code: string }> };

async function loadGroup(raw: string) {
  const code = familyCodeSchema.safeParse(raw.toUpperCase());
  if (!code.success) return { error: jsonError(400, "INVALID_INPUT", "Invalid group code") } as const;
  const group = await findOne("FamilyCheckIn", { groupCode: code.data });
  if (!group) return { error: jsonError(404, "NOT_FOUND", "Group not found or expired (groups auto-delete after 72 hours).") } as const;
  return { group } as const;
}

export async function GET(req: NextRequest, { params }: Params) {
  const limited = rateLimit(req, "family", 60, 60_000);
  if (limited) return limited;
  const r = await loadGroup((await params).code);
  if ("error" in r) return r.error;
  return NextResponse.json({
    groupName: r.group.groupName,
    expiresAt: r.group.expireAt,
    members: publicMembers((r.group.members as FamilyMember[]) ?? []),
  });
}

/** Post or update your own status. Requires explicit consent; no location is accepted or stored. */
export async function POST(req: NextRequest, { params }: Params) {
  const limited = rateLimit(req, "family", 60, 60_000);
  if (limited) return limited;
  const r = await loadGroup((await params).code);
  if ("error" in r) return r.error;
  const body = await parseJsonBody(req, familyStatusSchema);
  if (!body.ok) return body.response;
  const { displayName, status, note, memberToken } = body.data;
  const members = ((r.group.members as FamilyMember[]) ?? []).slice();
  const now = new Date().toISOString();

  let token = memberToken;
  const idx = memberToken ? members.findIndex((m) => tokenMatches(memberToken, m.tokenHash)) : -1;
  if (idx >= 0) {
    members[idx] = { ...(members[idx] as FamilyMember), displayName, status, note, updatedAt: now };
  } else {
    if (members.length >= 20) return jsonError(409, "GROUP_FULL", "This group already has 20 members.");
    const t = newMemberToken();
    token = t.token;
    members.push({ memberId: t.memberId, tokenHash: t.tokenHash, displayName, status, note, consentAt: now, updatedAt: now });
  }
  await updateById("FamilyCheckIn", r.group._id, { members });
  return NextResponse.json({ memberToken: token, members: publicMembers(members) });
}

/** Leave the group: your entry is deleted immediately. */
export async function DELETE(req: NextRequest, { params }: Params) {
  const r = await loadGroup((await params).code);
  if ("error" in r) return r.error;
  const body = await parseJsonBody(req, familyLeaveSchema);
  if (!body.ok) return body.response;
  const members = ((r.group.members as FamilyMember[]) ?? []).filter((m) => !tokenMatches(body.data.memberToken, m.tokenHash));
  await updateById("FamilyCheckIn", r.group._id, { members });
  return NextResponse.json({ ok: true, members: publicMembers(members) });
}
