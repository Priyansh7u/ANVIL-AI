import "server-only";
import { diffAgainstKnown, hashKey, type ResearchHazard } from "./core/hazard-intel";
import { createHazardTask, runHazardTask } from "./agent/hazard-research";
import { find, findById, updateById, type Doc } from "./repo";
import type { PlaceInput } from "./validation";

/**
 * Location monitors re-run the hazard research agent on a schedule.
 * Scheduling is external: a cron job (Vercel Cron, GitHub Actions, any
 * uptime pinger) calls /api/cron/monitor with CRON_SECRET, which runs the
 * monitors that are due. Without a scheduler, monitors only run when the
 * user presses "Run now" — the UI says which is the case.
 */

export const MAX_MONITORS_PER_CLIENT = 5;
const MAX_CHANGES = 60;

export function nextRunFrom(fromIso: string, intervalMinutes: number): string {
  return new Date(Date.parse(fromIso) + intervalMinutes * 60_000).toISOString();
}

export async function runMonitor(monitorId: string): Promise<{ ok: boolean; taskId?: string; newCount?: number; changedCount?: number; status?: string; error?: string }> {
  const m = await findById("LocationMonitor", monitorId);
  if (!m) return { ok: false, error: "NOT_FOUND" };
  // Simple lease to avoid two schedulers running the same monitor at once.
  const leaseFresh = m.running && m.lastRunAt && Date.now() - Date.parse(String(m.lastRunAt)) < 6 * 60_000;
  if (leaseFresh) return { ok: false, error: "ALREADY_RUNNING" };
  const startedAt = new Date().toISOString();
  await updateById("LocationMonitor", monitorId, { running: true, lastRunAt: startedAt });

  try {
    const task = await createHazardTask({ place: m.place as PlaceInput, hazard: m.hazard as ResearchHazard, clientId: String(m.clientId), monitorId, trigger: "MONITOR" });
    await updateById("LocationMonitor", monitorId, { lastTaskId: task._id });
    await runHazardTask(task._id);
    const done = await findById("ResearchTask", task._id);
    const status = String(done?.status ?? "FAILED");
    const interval = Number(m.intervalMinutes) || 60;

    if (status === "FAILED" || status === "CANCELLED") {
      const failures = (Number(m.consecutiveFailures) || 0) + 1;
      // Back off after repeated failures (up to 4× the interval) so a broken source isn't hammered.
      await updateById("LocationMonitor", monitorId, {
        running: false,
        lastStatus: status,
        lastError: String(done?.error ?? status).slice(0, 500),
        consecutiveFailures: failures,
        nextRunAt: nextRunFrom(startedAt, interval * Math.min(4, failures)),
      });
      return { ok: false, taskId: task._id, status, error: String(done?.error ?? status) };
    }

    const findings = await find("ResearchFinding", { taskId: task._id }, { limit: 200 });
    const known = (m.knownItems as Record<string, string>) ?? {};
    const { newKeys, changedKeys, next } = diffAgainstKnown(known, findings.map((f) => ({ itemKey: hashKey(String(f.itemKey)), id: String(f.fingerprint) })));
    const firstRun = Object.keys(known).length === 0;
    const at = new Date().toISOString();
    // Keys are hashed: raw item keys contain URLs, and dots are not safe in MongoDB field names.
    const byKey = new Map(findings.map((f) => [hashKey(String(f.itemKey)), f] as const));
    const toChange = (k: string, kind: "NEW" | "CHANGED") => {
      const f = byKey.get(k) as Doc;
      return { at, taskId: task._id, kind, title: String(f.title), sourceName: String(f.sourceName), sourceUrl: String(f.sourceUrl), category: String(f.sourceCategory), publishedAt: (f.publishedAt as string | null) ?? null };
    };
    // The first run establishes a baseline; it doesn't flood the user with "new" items.
    const changes = firstRun ? [] : [...newKeys.map((k) => toChange(k, "NEW")), ...changedKeys.map((k) => toChange(k, "CHANGED"))];
    const prev = (m.changes as unknown[]) ?? [];
    await updateById("LocationMonitor", monitorId, {
      running: false,
      lastStatus: status,
      lastError: null,
      lastSuccessAt: at,
      consecutiveFailures: 0,
      knownItems: next,
      changes: [...changes, ...prev].slice(0, MAX_CHANGES),
      nextRunAt: nextRunFrom(startedAt, interval),
    });
    return { ok: true, taskId: task._id, status, newCount: firstRun ? 0 : newKeys.length, changedCount: firstRun ? 0 : changedKeys.length };
  } catch (e) {
    await updateById("LocationMonitor", monitorId, { running: false, lastStatus: "FAILED", lastError: (e as Error).message.slice(0, 500), nextRunAt: nextRunFrom(startedAt, Number(m.intervalMinutes) || 60) });
    return { ok: false, error: (e as Error).message };
  }
}

/** Run every active monitor whose nextRunAt has passed (bounded per invocation). */
export async function runDueMonitors(maxRuns = 3): Promise<{ checked: number; ran: { id: string; ok: boolean; status?: string; newCount?: number; changedCount?: number; error?: string }[] }> {
  const active = await find("LocationMonitor", { active: true }, { limit: 500 });
  const now = Date.now();
  const due = active.filter((m) => !m.nextRunAt || Date.parse(String(m.nextRunAt)) <= now).sort((a, b) => String(a.nextRunAt ?? "").localeCompare(String(b.nextRunAt ?? ""))).slice(0, maxRuns);
  const ran = [];
  // Sequential: each run already parallelises internally, and providers are rate-limited.
  for (const m of due) ran.push({ id: m._id, ...(await runMonitor(m._id)) });
  return { checked: active.length, ran };
}

export function publicMonitor(m: Doc) {
  const { knownItems: _k, clientId: _c, ...rest } = m;
  void _k;
  void _c;
  return { ...rest, id: m._id, knownCount: Object.keys((m.knownItems as object) ?? {}).length };
}