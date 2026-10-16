import { NextResponse, type NextRequest } from "next/server";
import { SOURCES } from "@/lib/core/source-registry";
import { capabilityFlags, env } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/http";
import { lastDatabaseError, tryConnect } from "@/lib/mongodb";
import { find, storageMode } from "@/lib/repo";
import { probeSachet } from "@/lib/sources/sachet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function probe(url: string): Promise<{ ok: boolean; status: number | null; ms: number; error: string | null }> {
  const t0 = Date.now();
  try {
    const res = await fetchWithTimeout(url, { timeoutMs: 6_000 });
    return { ok: res.ok, status: res.status, ms: Date.now() - t0, error: null };
  } catch (e) {
    return { ok: false, status: null, ms: Date.now() - t0, error: (e as Error).message };
  }
}

/**
 * Source-health dashboard data. Public callers get a capability summary;
 * live probes and recent task stats require the ADMIN_TOKEN header
 * (when ADMIN_TOKEN is unset, probes are open — fine for local demos).
 */
export async function GET(req: NextRequest) {
  const caps = capabilityFlags();
  const authorized = !env.adminToken || req.headers.get("x-admin-token") === env.adminToken;
  if (!authorized) {
    return NextResponse.json({ capabilities: caps, storage: storageMode(), sources: SOURCES, probes: null, authorized: false });
  }

  const [sachet, nominatim, osrm, db] = await Promise.all([
    probeSachet(),
    probe("https://nominatim.openstreetmap.org/status?format=json"),
    probe(`${env.routingBaseUrl.replace(/\/$/, "")}/route/v1/driving/77.2,28.6;77.21,28.61?overview=false`),
    tryConnect().then((c) => ({ ok: Boolean(c), error: c ? null : lastDatabaseError() })),
  ]);
  const tasks = await find("ResearchTask", {}, { sortDesc: "createdAt", limit: 50 }).catch(() => []);
  const byStatus: Record<string, number> = {};
  for (const t of tasks) byStatus[String(t.status)] = (byStatus[String(t.status)] ?? 0) + 1;

  return NextResponse.json({
    authorized: true,
    checkedAt: new Date().toISOString(),
    capabilities: caps,
    storage: storageMode(),
    sources: SOURCES,
    probes: {
      sachet,
      nominatim,
      osrm,
      database: caps.database ? db : { ok: false, error: "MONGODB_URI not configured — using ephemeral in-memory storage" },
      tinyfish: { configured: caps.tinyfish, agentEnabled: caps.tinyfishAgent, note: "Not probed to avoid consuming quota; exercised by research tasks." },
      ai: { configured: caps.ai, model: caps.ai ? env.aiModel : null },
    },
    recentResearch: { total: tasks.length, byStatus },
  });
}
