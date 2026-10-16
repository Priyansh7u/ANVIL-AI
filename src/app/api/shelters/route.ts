import { NextResponse, type NextRequest } from "next/server";
import { parseQuery, rateLimit } from "@/lib/http";
import { find, storageMode } from "@/lib/repo";
import { sheltersQuerySchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * Only shelters that the research agent found on an official page, with a
 * verbatim evidence quote, are ever returned. There is no "safe" flag: ANVIL
 * reports what is documented, never that a building is safe.
 */
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, "shelters", 60, 60_000);
  if (limited) return limited;
  const q = parseQuery(req, sheltersQuerySchema);
  if (!q.ok) return q.response;
  const filter: Record<string, unknown> = { "verification.status": "SOURCE_DOCUMENTED" };
  if (q.data.district) filter.district = q.data.district;
  if (q.data.state) filter.state = q.data.state;
  const shelters = await find("Shelter", filter, { sortDesc: "updatedAt", limit: 100 });
  return NextResponse.json({
    shelters: shelters.map((s) => ({ ...s, id: s._id })),
    storage: storageMode(),
    note: "Listed because an official page documents them. Availability and safety are NOT verified — confirm with the district control room.",
  });
}
