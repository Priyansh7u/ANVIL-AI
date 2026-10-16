"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BellRing,
  Bot,
  CheckCircle2,
  CircleDashed,
  Clock,
  Download,
  FileText,
  Globe,
  Loader2,
  MapPin,
  Pause,
  Play,
  Printer,
  Quote,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  Square,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  HAZARD_PROFILES,
  HAZARD_STAGES,
  STAGE_LABEL,
  TERMINAL_STAGES,
  verificationLabel,
  type EventOrigin,
  type HazardStage,
  type ResearchHazard,
} from "@/lib/core/hazard-intel";
import { relativeTime } from "@/lib/core/freshness";
import type { Place } from "@/lib/core/types";
import { cn, formatDateTime } from "@/lib/utils";
import { apiFetch, placeQuery, useApi, type ApiError } from "@/hooks/use-api";
import { useClientId, usePlace } from "@/hooks/use-local-state";
import type { FindingDto, HistoryResponse, LiveEvent, LiveTaskDto, MonitorsResponse, ResultsResponse, SourceDto } from "@/types/research";
import { LocationPicker } from "@/components/shared/location-picker";
import { EmptyState, ErrorState, PageHeader, SourceLink, StorageNotice } from "@/components/shared/status";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Label, Select, Skeleton } from "@/components/ui/primitives";

const HAZARDS = Object.entries(HAZARD_PROFILES) as [ResearchHazard, { label: string }][];

const ORIGIN_LABEL: Record<EventOrigin, { label: string; provider: boolean }> = {
  APP: { label: "ANVIL", provider: false },
  AI: { label: "ANVIL · AI", provider: false },
  SACHET: { label: "NDMA SACHET", provider: true },
  TINYFISH_SEARCH: { label: "TinyFish Search", provider: true },
  TINYFISH_FETCH: { label: "TinyFish Fetch", provider: true },
  TINYFISH_AGENT: { label: "TinyFish Agent", provider: true },
};

const FRESH_LABEL: Record<FindingDto["freshness"], { label: string; tone: "ok" | "neutral" | "warning" }> = {
  FRESH: { label: "Under 24 h old", tone: "ok" },
  RECENT: { label: "24–72 h old", tone: "neutral" },
  POTENTIALLY_STALE: { label: "Potentially stale", tone: "warning" },
  TIMESTAMP_UNAVAILABLE: { label: "Timestamp unavailable", tone: "warning" },
};

const REL_LABEL: Record<FindingDto["relevance"], string> = {
  DISTRICT: "Names your district",
  STATE: "Names your state",
  NOT_LOCATION_SPECIFIC: "Not location-specific",
};

const BASIS_LABEL: Record<NonNullable<FindingDto["publishedBasis"]>, string> = {
  CAP_SENT: "official CAP issue time",
  PAGE_TEXT: "date stated on the page",
  SEARCH_PROVIDER: "date reported by search provider",
};

const LEVEL_COLOR: Record<string, string> = { RED: "#dc2626", ORANGE: "#ea580c", YELLOW: "#ca8a04", GREEN: "#16a34a" };

function categoryTone(c: FindingDto["sourceCategory"]) {
  return c === "OFFICIAL" ? "ok" : c === "SECONDARY" ? "neutral" : "warning";
}

function isTerminal(stage: HazardStage | undefined) {
  return Boolean(stage && TERMINAL_STAGES.includes(stage));
}

function Elapsed({ from, to }: { from?: string; to?: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (to) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [to]);
  if (!from) return null;
  const s = Math.max(0, Math.round(((to ? Date.parse(to) : now) - Date.parse(from)) / 1000));
  return <span className="num">{Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</span>;
}

export default function ResearchPage() {
  const [globalPlace] = usePlace();
  const clientId = useClientId();
  const [placeOverride, setPlaceOverride] = useState<Place | null>(null);
  const [picking, setPicking] = useState(false);
  const place = placeOverride ?? globalPlace;
  const [hazard, setHazard] = useState<ResearchHazard>("all");

  const histUrl = clientId ? `/api/research/live?clientId=${clientId}` : null;
  const history = useApi<HistoryResponse>(histUrl);
  const placeHist = useApi<HistoryResponse>(place ? `/api/research/live?${placeQuery(place)}&hazard=${hazard}` : null);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [task, setTask] = useState<LiveTaskDto | null>(null);
  const [findings, setFindings] = useState<FindingDto[]>([]);
  const [sources, setSources] = useState<SourceDto[]>([]);
  const [conn, setConn] = useState<"idle" | "sse" | "polling" | "closed">("idle");
  const [startError, setStartError] = useState<ApiError | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [previous, setPrevious] = useState<ResultsResponse | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopLive = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = null;
  }, []);

  const loadResults = useCallback(async (id: string) => {
    const r = await apiFetch<ResultsResponse>(`/api/research/${id}/results`, { timeoutMs: 20_000 });
    setTask(r.task);
    setFindings(r.findings);
    setSources(r.sources);
    setLoadError(null);
    return r;
  }, []);

  const startPolling = useCallback(
    (id: string) => {
      setConn("polling");
      const tick = async () => {
        try {
          const r = await loadResults(id);
          if (!isTerminal(r.task.stage)) pollRef.current = setTimeout(tick, 2000);
          else {
            setConn("closed");
            history.reload();
            placeHist.reload();
          }
        } catch (e) {
          setLoadError((e as ApiError).message);
          pollRef.current = setTimeout(tick, 5000);
        }
      };
      void tick();
    },
    [loadResults, history, placeHist],
  );

  const attach = useCallback(
    (id: string) => {
      stopLive();
      if (typeof EventSource === "undefined") return startPolling(id);
      const es = new EventSource(`/api/research/${id}/stream`);
      esRef.current = es;
      let first = true;
      let done = false;
      es.addEventListener("open", () => setConn("sse"));
      es.addEventListener("task", (ev) => {
        let raw: unknown;
        try {
          raw = JSON.parse((ev as MessageEvent).data);
        } catch {
          return;
        }
        const d = raw as { stage: HazardStage; status: string; counts: Record<string, number>; providerRuns: LiveTaskDto["providerRuns"]; newEvents: LiveEvent[] };
        setTask((t) => {
          const base = t && t.id === id ? t : ({ id, events: [] } as unknown as LiveTaskDto);
          return { ...base, stage: d.stage, status: d.status, counts: d.counts, providerRuns: d.providerRuns, events: first ? d.newEvents : [...(base.events ?? []), ...d.newEvents] };
        });
        first = false;
      });
      es.addEventListener("done", () => {
        done = true;
        es.close();
        setConn("closed");
        loadResults(id)
          .catch((e: ApiError) => setLoadError(e.message))
          .finally(() => {
            history.reload();
            placeHist.reload();
          });
      });
      const fallback = () => {
        if (done) return;
        es.close();
        startPolling(id);
      };
      es.addEventListener("timeout", fallback);
      es.addEventListener("gone", fallback);
      es.addEventListener("error", fallback);
    },
    [stopLive, startPolling, loadResults, history, placeHist],
  );

  useEffect(() => () => stopLive(), [stopLive]);

  const open = useCallback(
    async (id: string) => {
      setActiveId(id);
      setPrevious(null);
      setFindings([]);
      setSources([]);
      try {
        const r = await loadResults(id);
        if (!isTerminal(r.task.stage)) attach(id);
        else setConn("closed");
      } catch (e) {
        setLoadError((e as ApiError).message);
      }
    },
    [loadResults, attach],
  );

  // Open the most recent task of this browser on first load.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !history.data) return;
    opened.current = true;
    const first = history.data.tasks[0];
    if (first) void open(first.id);
  }, [history.data, open]);

  // When a run fails or is cancelled, keep the last usable report for that place visible.
  useEffect(() => {
    if (!task || !["FAILED", "CANCELLED"].includes(task.stage)) return;
    const prevId = placeHist.data?.latestUsableTaskId;
    if (prevId && prevId !== task.id) apiFetch<ResultsResponse>(`/api/research/${prevId}/results`).then(setPrevious).catch(() => undefined);
  }, [task, placeHist.data]);

  const start = async (over?: { place: { label: string; district: string | null; state: string | null }; hazard: ResearchHazard }) => {
    const p = over?.place ?? place;
    const hz = over?.hazard ?? hazard;
    if (!p) return;
    setStarting(true);
    setStartError(null);
    try {
      const r = await apiFetch<{ id: string }>("/api/research/live", {
        method: "POST",
        body: JSON.stringify({ place: { label: p.label, district: p.district, state: p.state }, hazard: hz, ...(clientId ? { clientId } : {}) }),
      });
      setTask({ id: r.id, place: { label: p.label, district: p.district, state: p.state }, hazard: hz, status: "RUNNING", stage: "INITIALIZING", events: [] });
      setFindings([]);
      setSources([]);
      setPrevious(null);
      setActiveId(r.id);
      attach(r.id);
      history.reload();
    } catch (e) {
      setStartError(e as ApiError);
    } finally {
      setStarting(false);
    }
  };

  const cancel = async () => {
    if (!activeId) return;
    setCancelling(true);
    try {
      await apiFetch(`/api/research/${activeId}/cancel`, { method: "POST", body: JSON.stringify(clientId ? { clientId } : {}) });
    } catch (e) {
      setLoadError((e as ApiError).message);
    } finally {
      setCancelling(false);
    }
  };

  const retry = async () => {
    if (!task) return;
    setHazard(task.hazard);
    setPlaceOverride({ label: task.place.label, district: task.place.district, state: task.place.state, lat: null, lon: null, source: "manual" });
    await start({ place: task.place, hazard: task.hazard });
  };

  const caps = history.data?.capabilities ?? placeHist.data?.capabilities;
  const running = Boolean(task && !isTerminal(task.stage));

  return (
    <>
      <PageHeader
        title="Live research agent"
        description="Researches official sources first (NDMA SACHET, IMD, CWC, state and district authorities), then news. Every finding links to its source with publication and retrieval times; nothing is shown without evidence."
        actions={task ? <ExportButtons id={task.id} disabled={!isTerminal(task.stage)} /> : null}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          {/* Controls */}
          <Card>
            <CardContent className="grid gap-3 pt-4 sm:pt-5 md:grid-cols-[1fr_200px_auto] md:items-end">
              <div className="space-y-1">
                <Label>Location</Label>
                <div className="flex min-h-10 items-center gap-2 rounded-md border bg-background px-3 text-sm">
                  <MapPin className="size-4 text-muted-foreground" aria-hidden />
                  <span className="truncate">{place ? place.label : "No location chosen"}</span>
                  <button type="button" className="ml-auto text-xs text-primary hover:underline" onClick={() => setPicking((v) => !v)}>
                    {picking ? "Close" : "Change"}
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="hz">Disaster type</Label>
                <Select id="hz" value={hazard} onChange={(e) => setHazard(e.target.value as ResearchHazard)}>
                  {HAZARDS.map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </div>
              <Button onClick={() => void start()} disabled={!place || starting || running} className="md:min-w-48">
                {starting ? <Loader2 className="animate-spin" /> : <Play />} Start live research
              </Button>
              {picking ? (
                <div className="md:col-span-3">
                  <LocationPicker
                    onPicked={(p) => {
                      setPlaceOverride(p);
                      setPicking(false);
                    }}
                  />
                </div>
              ) : null}
              <div className="flex flex-wrap gap-1.5 md:col-span-3">
                {caps ? (
                  <>
                    <CapBadge on={caps.tinyfish} label="TinyFish Search + Fetch" />
                    <CapBadge on={caps.tinyfishAgent} label="TinyFish Agent browser" />
                    <CapBadge on={caps.ai} label="AI extraction" />
                    <CapBadge on={Boolean(caps.scheduler)} label="Scheduled monitoring" />
                    <CapBadge on label="NDMA SACHET feed" />
                  </>
                ) : (
                  <Skeleton className="h-5 w-72" />
                )}
                <StorageNotice storage={history.data?.storage} />
              </div>
              {caps && !caps.tinyfish ? (
                <p className="text-xs text-warning md:col-span-3">TinyFish is not configured on this server: research will check the official SACHET feed only and report the gap. Web sources will not be searched.</p>
              ) : null}
              {startError ? (
                <div className="md:col-span-3">
                  <ErrorState message={startError.message} onRetry={() => void start()} />
                </div>
              ) : null}
            </CardContent>
          </Card>

          {!task && !activeId ? (
            history.loading ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <EmptyState icon={Bot} title="No research yet">
                Pick a location and a disaster type, then start live research. You will see each real step as it happens.
              </EmptyState>
            )
          ) : null}

          {loadError ? <ErrorState message={loadError} onRetry={activeId ? () => void open(activeId) : undefined} /> : null}

          {task ? (
            <>
              <LiveStatus task={task} conn={conn} onCancel={cancel} cancelling={cancelling} onRetry={retry} />
              <ActivityLog events={task.events ?? []} running={running} />
              {task.report ? (
                <Report task={task} findings={findings} sources={sources} />
              ) : running ? (
                <Card>
                  <CardContent className="flex items-center gap-2 pt-4 text-sm text-muted-foreground sm:pt-5">
                    <Loader2 className="size-4 animate-spin" /> The report appears when validation finishes. Findings are not shown before they are checked.
                  </CardContent>
                </Card>
              ) : null}
              {previous?.task.report ? (
                <div className="space-y-2 rounded-lg border border-dashed p-3">
                  <p className="text-sm font-medium">
                    Previous usable report for this place · {previous.task.finishedAt ? `${formatDateTime(previous.task.finishedAt)} (${relativeTime(previous.task.finishedAt)})` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">Shown because the latest run did not finish. It may be out of date.</p>
                  <Report task={previous.task} findings={previous.findings} sources={previous.sources} compact />
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <aside className="space-y-4">
          <MonitorPanel clientId={clientId} place={place} hazard={hazard} onOpenTask={open} />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Your research history</CardTitle>
            </CardHeader>
            <CardContent>
              {history.error ? <ErrorState message={history.error.message} onRetry={history.reload} /> : null}
              {history.loading && !history.data ? <Skeleton className="h-24 w-full" /> : null}
              {history.data && !history.data.tasks.length ? <p className="text-sm text-muted-foreground">No tasks yet.</p> : null}
              <ul className="space-y-1">
                {history.data?.tasks.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => void open(t.id)}
                      className={cn("w-full rounded-md border px-2.5 py-2 text-left text-sm hover:bg-muted", activeId === t.id && "border-primary bg-muted")}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{t.place.label}</span>
                        <StageBadge stage={t.stage} />
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {HAZARD_PROFILES[t.hazard]?.label} · {relativeTime(t.createdAt)} · {t.counts?.findings ?? 0} finding(s){t.trigger === "MONITOR" ? " · monitor" : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}

function CapBadge({ on, label }: { on: boolean; label: string }) {
  return (
    <Badge tone={on ? "ok" : "neutral"}>
      {on ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />} {label}
      {on ? "" : " · off"}
    </Badge>
  );
}

function StageBadge({ stage }: { stage: HazardStage }) {
  const tone = stage === "COMPLETED" ? "ok" : stage === "FAILED" ? "danger" : stage === "PARTIAL" ? "warning" : stage === "CANCELLED" ? "neutral" : "warning";
  return <Badge tone={tone}>{STAGE_LABEL[stage] ?? stage}</Badge>;
}

function ExportButtons({ id, disabled }: { id: string; disabled: boolean }) {
  return (
    <>
      <a
        aria-disabled={disabled}
        href={disabled ? undefined : `/api/research/${id}/export?format=json`}
        className={cn("inline-flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-xs font-medium hover:bg-muted", disabled && "pointer-events-none opacity-50")}
      >
        <Download className="size-4" /> Export JSON
      </a>
      <a
        aria-disabled={disabled}
        href={disabled ? undefined : `/api/research/${id}/export?format=html`}
        target="_blank"
        rel="noopener"
        className={cn("inline-flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-xs font-medium hover:bg-muted", disabled && "pointer-events-none opacity-50")}
      >
        <Printer className="size-4" /> Printable report
      </a>
    </>
  );
}

function LiveStatus({ task, conn, onCancel, cancelling, onRetry }: { task: LiveTaskDto; conn: string; onCancel: () => void; cancelling: boolean; onRetry: () => void }) {
  const terminal = isTerminal(task.stage);
  const idx = HAZARD_STAGES.indexOf(task.stage as (typeof HAZARD_STAGES)[number]);
  const reached = new Set((task.events ?? []).map((e) => e.stage));
  const c = task.counts ?? {};
  return (
    <Card className="panel">
      <CardContent className="space-y-4 pt-4 sm:pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{task.place?.label}</span>
          <span className="text-sm text-muted-foreground">· {HAZARD_PROFILES[task.hazard]?.label}</span>
          <StageBadge stage={task.stage} />
          {task.trigger === "MONITOR" ? <Badge tone="outline">Started by monitor</Badge> : null}
          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            {!terminal ? (
              <Badge tone="neutral">
                <Radio className="size-3" /> {conn === "sse" ? "Live stream (SSE)" : conn === "polling" ? "Polling every 2 s" : "Connecting…"}
              </Badge>
            ) : null}
            <Clock className="size-3.5" /> <Elapsed from={task.startedAt ?? task.createdAt ?? task.events?.[0]?.at} to={task.finishedAt} />
          </span>
        </div>

        <ol className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-7" aria-label="Research stages">
          {HAZARD_STAGES.map((s, i) => {
            const done = terminal ? reached.has(s) || (task.stage === "COMPLETED" && s === "COMPLETED") : i < idx;
            const current = !terminal && i === idx;
            const skipped = terminal && !reached.has(s) && !(task.stage === "COMPLETED" && s === "COMPLETED");
            return (
              <li
                key={s}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs",
                  done && "border-ok/40 bg-ok-soft text-ok",
                  current && "border-primary bg-primary/10 font-semibold",
                  skipped && "opacity-50",
                )}
                aria-current={current ? "step" : undefined}
              >
                {done ? <CheckCircle2 className="size-3.5 shrink-0" /> : current ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : <CircleDashed className="size-3.5 shrink-0" />}
                <span className="truncate">{STAGE_LABEL[s]}</span>
              </li>
            );
          })}
        </ol>

        <dl className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
          {[
            ["Sources found", c.sourcesDiscovered],
            ["Pages read", c.pagesFetched],
            ["Pages failed", c.pagesFailed],
            ["Findings", c.findings ?? c.findingsExtracted],
            ["Dropped (no quote)", c.droppedUnverified],
            ["Conflicts", c.conflicts],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded-md border p-2">
              <dt className="text-[11px] text-muted-foreground">{k}</dt>
              <dd className="num text-lg font-semibold">{typeof v === "number" ? v : "—"}</dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-wrap items-center gap-2">
          {!terminal ? (
            <Button variant="outline" size="sm" onClick={onCancel} disabled={cancelling}>
              {cancelling ? <Loader2 className="animate-spin" /> : <Square />} Cancel
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw /> {task.stage === "COMPLETED" ? "Run again" : "Retry"}
            </Button>
          )}
          {task.providerRuns?.length ? <span className="text-xs text-muted-foreground">TinyFish agent runs: {task.providerRuns.map((r) => `${r.runId.slice(0, 8)}… ${r.status.toLowerCase()}`).join(", ")}</span> : null}
          {task.stage === "FAILED" && task.error ? <span className="text-xs text-danger">{task.error}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function ActivityLog({ events, running }: { events: LiveEvent[]; running: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (running && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [events.length, running]);
  const list = showAll || running ? events : events.slice(-12);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="size-4" /> Activity
          </CardTitle>
          <CardDescription>Provider events come from the external service; ANVIL events are this app&apos;s own processing. Each line was written when it happened.</CardDescription>
        </div>
        {!running && events.length > 12 ? (
          <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show recent" : `Show all ${events.length}`}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {!events.length ? <p className="text-sm text-muted-foreground">Waiting for the first event…</p> : null}
        <ol ref={ref} className="max-h-80 space-y-1 overflow-y-auto pr-1 text-sm" aria-live="polite">
          {list.map((e, i) => {
            const o = ORIGIN_LABEL[e.origin] ?? ORIGIN_LABEL.APP;
            return (
              <li key={`${e.at}-${i}`} className="flex gap-2 border-b border-dashed py-1 last:border-0">
                <time className="num w-16 shrink-0 text-xs text-muted-foreground" dateTime={e.at}>
                  {new Date(e.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </time>
                <span className={cn("h-fit shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold", o.provider ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                  {o.provider ? "Provider · " : ""}
                  {o.label}
                </span>
                <span className="min-w-0 break-words">
                  {e.message}
                  {e.url ? (
                    <>
                      {" "}
                      <SourceLink href={e.url} />
                    </>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

function Report({ task, findings, sources, compact = false }: { task: LiveTaskDto; findings: FindingDto[]; sources: SourceDto[]; compact?: boolean }) {
  const r = task.report!;
  const [cat, setCat] = useState<"ALL" | "OFFICIAL" | "SECONDARY" | "UNVERIFIED">("ALL");
  const [onlyFresh, setOnlyFresh] = useState(false);
  const [onlyLocal, setOnlyLocal] = useState(false);
  const [onlyConflicts, setOnlyConflicts] = useState(false);
  const byId = useMemo(() => new Map(findings.map((f) => [f.id, f])), [findings]);
  const ordered = useMemo(() => r.latestFindingIds.map((id) => byId.get(id)).filter(Boolean) as FindingDto[], [r, byId]);
  const refOf = useMemo(() => new Map(ordered.map((f, i) => [f.id, `F${i + 1}`])), [ordered]);
  const visible = ordered.filter(
    (f) =>
      (cat === "ALL" || f.sourceCategory === cat) &&
      (!onlyFresh || f.freshness === "FRESH" || f.freshness === "RECENT") &&
      (!onlyLocal || f.relevance !== "NOT_LOCATION_SPECIFIC") &&
      (!onlyConflicts || f.conflictsWith.length > 0),
  );

  // Turn [F1] citations into links to the finding cards.
  const summaryNodes = r.executiveSummary.split(/(\[F\d{1,2}\])/g).map((part, i) => {
    const m = part.match(/^\[(F\d{1,2})\]$/);
    if (!m) return <span key={i}>{part}</span>;
    const fid = r.citations?.[m[1] as string];
    const local = fid ? refOf.get(fid) : null;
    return (
      <a key={i} href={local ? `#finding-${task.id}-${local}` : undefined} className="mx-0.5 rounded bg-primary/15 px-1 text-xs font-semibold text-primary">
        {local ?? m[1]}
      </a>
    );
  });

  return (
    <div className="space-y-4">
      <Card className={cn(r.insufficientEvidence ? "border-warning/50" : "border-ok/40")}>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <FileText className="size-4" /> Executive summary
            <Badge tone={r.summaryMethod === "AI_GROUNDED" ? "neutral" : "outline"}>{r.summaryMethod === "AI_GROUNDED" ? "AI-written, citation-checked" : "Rule-based summary"}</Badge>
            {r.insufficientEvidence ? (
              <Badge tone="warning">
                <AlertTriangle className="size-3" /> Insufficient evidence
              </Badge>
            ) : null}
          </CardTitle>
          <CardDescription>
            Generated {formatDateTime(r.generatedAt)} · {r.freshness.newestPublishedAt ? `newest source published ${relativeTime(r.freshness.newestPublishedAt)}` : "no source states a publication time"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-[15px] leading-relaxed">{summaryNodes}</p>
          {r.insufficiencyReason ? <p className="rounded-md bg-warning-soft p-2 text-sm text-warning">{r.insufficiencyReason}</p> : null}
          <p className="text-xs text-muted-foreground">In an emergency call 112. Follow instructions from your district administration; ANVIL never overrides them.</p>
        </CardContent>
      </Card>

      {r.officialAdvisories.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4 text-ok" /> Official advisories
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {r.officialAdvisories.map((a, i) => (
                <li key={i} className="rounded-md border-l-4 border-ok bg-ok-soft/40 p-2 text-sm">
                  {a.text}
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <SourceLink href={a.sourceUrl}>{a.sourceName}</SourceLink>
                    <span>{a.publishedAt ? `Published ${formatDateTime(a.publishedAt)}` : "Timestamp unavailable"}</span>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="gap-3">
          <CardTitle className="text-base">Latest findings ({ordered.length})</CardTitle>
          {!compact ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {(["ALL", "OFFICIAL", "SECONDARY", "UNVERIFIED"] as const).map((k) => (
                <button key={k} type="button" onClick={() => setCat(k)} className={cn("rounded-full border px-2.5 py-1", cat === k && "border-primary bg-primary/10 font-semibold")}>
                  {k === "ALL" ? "All sources" : k === "OFFICIAL" ? "Official" : k === "SECONDARY" ? "News" : "Unverified"}
                </button>
              ))}
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={onlyFresh} onChange={(e) => setOnlyFresh(e.target.checked)} /> Last 72 h only
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={onlyLocal} onChange={(e) => setOnlyLocal(e.target.checked)} /> Names my area
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={onlyConflicts} onChange={(e) => setOnlyConflicts(e.target.checked)} /> Conflicts
              </label>
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3">
          {!ordered.length ? <EmptyState icon={Search} title="No findings">No source reached in this run said anything verifiable about this hazard and place.</EmptyState> : null}
          {ordered.length && !visible.length ? <p className="text-sm text-muted-foreground">No findings match these filters.</p> : null}
          {visible.map((f) => (
            <FindingCard key={f.id} f={f} refId={refOf.get(f.id) ?? ""} anchor={`finding-${task.id}-${refOf.get(f.id)}`} conflictTitles={f.conflictsWith.map((c) => byId.get(c)?.sourceName ?? "another source")} />
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Affected areas</CardTitle>
            <CardDescription>Only areas named by at least one finding.</CardDescription>
          </CardHeader>
          <CardContent>
            {r.affectedAreas.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {r.affectedAreas.map((a) => (
                  <li key={a.name}>
                    <Badge tone="outline">
                      {a.name} · {a.supportedBy.length}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">The evidence does not identify specific affected areas.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Source reliability & freshness</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>{r.reliability.text}</p>
            <Bar
              parts={[
                { n: r.reliability.official, label: "Official", cls: "bg-ok" },
                { n: r.reliability.secondary, label: "News", cls: "bg-primary" },
                { n: r.reliability.unverified, label: "Unverified", cls: "bg-warning" },
              ]}
            />
            <Bar
              parts={[
                { n: r.freshness.fresh, label: "< 24 h", cls: "bg-ok" },
                { n: r.freshness.recent, label: "24–72 h", cls: "bg-primary" },
                { n: r.freshness.stale, label: "Stale", cls: "bg-warning" },
                { n: r.freshness.unknown, label: "No timestamp", cls: "bg-muted-foreground" },
              ]}
            />
            <p className="text-xs text-muted-foreground">Retrieved {formatDateTime(r.freshness.retrievedAt)}</p>
          </CardContent>
        </Card>
      </div>

      <Card className={cn((r.conflicts.length || r.gaps.length) && "border-warning/50")}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-4 text-warning" /> Conflicts and gaps
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!r.conflicts.length && !r.gaps.length ? <p className="text-sm text-muted-foreground">No conflicts or gaps detected.</p> : null}
          <ul className="space-y-1.5 text-sm">
            {r.conflicts.map((c, i) => (
              <li key={`c${i}`} className="flex gap-2">
                <Badge tone="danger">Conflicting information</Badge> {c.message}
              </li>
            ))}
            {r.gaps.map((g, i) => (
              <li key={`g${i}`} className="flex gap-2">
                <Badge tone="warning">Gap</Badge> {g}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recommended next steps</CardTitle>
          <CardDescription>Official instructions first. ANVIL general guidance is not an official instruction.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            {r.nextSteps.map((n, i) => (
              <li key={i}>
                {n.text} <Badge tone={n.authority === "OFFICIAL" ? "ok" : "outline"}>{n.authority === "OFFICIAL" ? "Official" : "ANVIL general guidance"}</Badge>
                {n.sourceUrl ? (
                  <>
                    {" "}
                    <SourceLink href={n.sourceUrl} />
                  </>
                ) : null}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {!compact ? <SourcesTable sources={sources} /> : null}
    </div>
  );
}

function Bar({ parts }: { parts: { n: number; label: string; cls: string }[] }) {
  const total = parts.reduce((a, p) => a + p.n, 0);
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={parts.map((p) => `${p.label}: ${p.n}`).join(", ")}>
        {total ? parts.map((p) => (p.n ? <div key={p.label} className={p.cls} style={{ width: `${(p.n / total) * 100}%` }} /> : null)) : null}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        {parts.map((p) => (
          <span key={p.label} className="flex items-center gap-1">
            <span className={cn("inline-block size-2 rounded-full", p.cls)} /> {p.label} <span className="num">{p.n}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function FindingCard({ f, refId, anchor, conflictTitles }: { f: FindingDto; refId: string; anchor: string; conflictTitles: string[] }) {
  const ver = verificationLabel(f);
  const fr = FRESH_LABEL[f.freshness];
  return (
    <article id={anchor} className={cn("scroll-mt-28 rounded-lg border p-3", f.conflictsWith.length && "border-danger/40")}>
      <div className="flex flex-wrap items-start gap-2">
        <span className="rounded bg-muted px-1.5 text-xs font-semibold">{refId}</span>
        {f.alertLevel ? <span className="mt-1 inline-block size-2.5 rounded-full" style={{ background: LEVEL_COLOR[f.alertLevel] }} title={`${f.alertLevel.toLowerCase()} alert mentioned`} /> : null}
        <h3 className="min-w-0 flex-1 font-semibold leading-snug">{f.title}</h3>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{f.summary}</p>
      {f.instruction ? <p className="mt-1 text-sm">Instruction: {f.instruction}</p> : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge tone={categoryTone(f.sourceCategory)}>{ver}</Badge>
        <Badge tone={fr.tone}>{fr.label}</Badge>
        <Badge tone={f.relevance === "NOT_LOCATION_SPECIFIC" ? "warning" : "outline"}>{REL_LABEL[f.relevance]}</Badge>
        {f.alertLevel ? <Badge tone="outline">{f.alertLevel.charAt(0) + f.alertLevel.slice(1).toLowerCase()} alert mentioned</Badge> : null}
        {f.withdrawal ? <Badge tone="neutral">Mentions withdrawal</Badge> : null}
        {f.conflictsWith.length ? <Badge tone="danger">Conflicting information</Badge> : null}
        {f.corroboratedBy.length ? <Badge tone="ok">Also reported by {f.corroboratedBy.length}</Badge> : null}
        <Badge tone="outline">{f.origin === "SACHET_FEED" ? "Official CAP feed" : f.origin === "TINYFISH_AGENT" ? "TinyFish Agent" : "TinyFish Fetch"}</Badge>
      </div>
      {f.evidenceQuote ? (
        <blockquote className="mt-2 flex gap-2 rounded-md bg-muted/60 p-2 text-xs italic">
          <Quote className="size-3.5 shrink-0" aria-hidden /> {f.evidenceQuote}
        </blockquote>
      ) : null}
      <dl className="mt-2 grid gap-x-4 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-2">
        <div>
          <dt className="inline">Source: </dt>
          <dd className="inline">
            <SourceLink href={f.sourceUrl}>{f.sourceName}</SourceLink>
          </dd>
        </div>
        <div>
          <dt className="inline">Published: </dt>
          <dd className="inline">{f.publishedAt ? `${formatDateTime(f.publishedAt)} (${f.publishedBasis ? BASIS_LABEL[f.publishedBasis] : ""}${f.publishedRaw ? `: “${f.publishedRaw}”` : ""})` : "Timestamp unavailable"}</dd>
        </div>
        <div>
          <dt className="inline">Retrieved: </dt>
          <dd className="inline">{formatDateTime(f.retrievedAt)}</dd>
        </div>
        {f.location ? (
          <div>
            <dt className="inline">Area: </dt>
            <dd className="inline">{f.location}</dd>
          </div>
        ) : null}
      </dl>
      {f.conflictsWith.length ? <p className="mt-1.5 text-xs text-danger">Disagrees with {conflictTitles.join(", ")} — check the official source.</p> : null}
      {f.corroboratedBy.length ? (
        <p className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
          Also reported by:{" "}
          {f.corroboratedBy.map((c) => (
            <SourceLink key={c.sourceUrl} href={c.sourceUrl}>
              {c.sourceName}
            </SourceLink>
          ))}
        </p>
      ) : null}
    </article>
  );
}

function SourcesTable({ sources }: { sources: SourceDto[] }) {
  const sorted = [...sources].sort((a, b) => (a.category === b.category ? 0 : a.category === "OFFICIAL" ? -1 : b.category === "OFFICIAL" ? 1 : a.category === "SECONDARY" ? -1 : 1));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe className="size-4" /> Sources ({sources.length})
        </CardTitle>
        <CardDescription>Everything discovered in this run. Unverified sources are listed but not read.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="py-1 pr-2 font-medium">Source</th>
              <th className="py-1 pr-2 font-medium">Type</th>
              <th className="py-1 pr-2 font-medium">Found via</th>
              <th className="py-1 pr-2 font-medium">Status</th>
              <th className="py-1 pr-2 font-medium">Published</th>
              <th className="py-1 font-medium">Findings</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.id} className="border-t align-top">
                <td className="py-1.5 pr-2">
                  <SourceLink href={s.url}>{s.sourceName || s.host}</SourceLink>
                  {s.title ? <div className="line-clamp-1 text-xs text-muted-foreground">{s.title}</div> : null}
                  {s.injectionSuspected ? <Badge tone="warning">Suspicious content</Badge> : null}
                </td>
                <td className="py-1.5 pr-2">
                  <Badge tone={categoryTone(s.category)}>{s.category === "OFFICIAL" ? "Official" : s.category === "SECONDARY" ? "News" : "Unverified"}</Badge>
                </td>
                <td className="py-1.5 pr-2 text-xs">{s.discoveredVia === "SACHET_FEED" ? "SACHET feed" : s.discoveredVia === "TINYFISH_AGENT" ? "TinyFish Agent" : "TinyFish Search"}</td>
                <td className="py-1.5 pr-2 text-xs" title={s.note}>
                  {s.status.toLowerCase()}
                  {s.note && s.status !== "FETCHED" ? <div className="line-clamp-2 text-muted-foreground">{s.note}</div> : null}
                </td>
                <td className="py-1.5 pr-2 text-xs">{s.publishedAt ? formatDateTime(s.publishedAt) : s.providerDate ? `${s.providerDate} (provider)` : "—"}</td>
                <td className="num py-1.5">{s.findingCount ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

const INTERVALS = [
  [15, "Every 15 min"],
  [30, "Every 30 min"],
  [60, "Every hour"],
  [180, "Every 3 h"],
  [360, "Every 6 h"],
  [720, "Every 12 h"],
  [1440, "Daily"],
] as const;

function MonitorPanel({ clientId, place, hazard, onOpenTask }: { clientId: string | null; place: Place | null; hazard: ResearchHazard; onOpenTask: (id: string) => void }) {
  const { data, error, loading, reload } = useApi<MonitorsResponse>(clientId ? `/api/monitors?clientId=${clientId}` : null, { refreshMs: 30_000 });
  const [interval, setIntervalMin] = useState(60);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing className="size-4" /> Monitor this location
        </CardTitle>
        <CardDescription>Re-runs the research on a schedule and shows only new or changed findings.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {data ? (
          <p className={cn("rounded-md p-2 text-xs", data.scheduler.configured ? "bg-muted text-muted-foreground" : "bg-warning-soft text-warning")}>{data.scheduler.note}</p>
        ) : null}
        <div className="flex gap-2">
          <Select aria-label="Interval" value={interval} onChange={(e) => setIntervalMin(Number(e.target.value))}>
            {INTERVALS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            disabled={!clientId || !place || busy === "create"}
            onClick={() =>
              act("create", () =>
                apiFetch("/api/monitors", { method: "POST", body: JSON.stringify({ clientId, place: place && { label: place.label, district: place.district, state: place.state }, hazard, intervalMinutes: interval }) }),
              )
            }
          >
            {busy === "create" ? <Loader2 className="animate-spin" /> : <BellRing />} Monitor
          </Button>
        </div>
        {place ? <p className="text-xs text-muted-foreground">{place.label} · {HAZARD_PROFILES[hazard].label}</p> : null}
        {err ? <p className="text-xs text-danger">{err}</p> : null}
        {error ? <ErrorState message={error.message} onRetry={reload} /> : null}
        {loading && !data ? <Skeleton className="h-16 w-full" /> : null}
        <ul className="space-y-2">
          {data?.monitors.map((m) => {
            const stale = m.lastSuccessAt && Date.now() - Date.parse(m.lastSuccessAt) > 3 * m.intervalMinutes * 60_000;
            return (
              <li key={m.id} className="rounded-md border p-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{m.place.label}</span>
                  <Badge tone={m.active ? "ok" : "neutral"}>{m.active ? "Active" : "Paused"}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {HAZARD_PROFILES[m.hazard]?.label} · {INTERVALS.find(([v]) => v === m.intervalMinutes)?.[1] ?? `${m.intervalMinutes} min`}
                </p>
                <dl className="mt-1 grid grid-cols-2 gap-x-2 text-[11px] text-muted-foreground">
                  <dt>Last run</dt>
                  <dd>{m.running ? "Running now…" : m.lastRunAt ? relativeTime(m.lastRunAt) : "Never"}</dd>
                  <dt>Last success</dt>
                  <dd>{m.lastSuccessAt ? relativeTime(m.lastSuccessAt) : "—"}</dd>
                  <dt>Next due</dt>
                  <dd>{m.active && m.nextRunAt ? (Date.parse(m.nextRunAt) <= Date.now() ? "Due (waiting for scheduler)" : relativeTime(m.nextRunAt)) : "—"}</dd>
                  <dt>Tracked items</dt>
                  <dd className="num">{m.knownCount}</dd>
                </dl>
                {m.lastStatus === "FAILED" || (m.consecutiveFailures ?? 0) > 0 ? <p className="mt-1 text-[11px] text-danger">Last run failed{m.consecutiveFailures ? ` (${m.consecutiveFailures}× in a row)` : ""}: {m.lastError}</p> : null}
                {stale ? <p className="mt-1 text-[11px] text-warning">No successful refresh for over three intervals — results may be out of date.</p> : null}
                {m.changes.length ? (
                  <ul className="mt-2 space-y-1 border-t pt-2">
                    {m.changes.slice(0, 5).map((c, i) => (
                      <li key={i} className="text-xs">
                        <Badge tone={c.kind === "NEW" ? "danger" : "warning"}>{c.kind === "NEW" ? "New" : "Changed"}</Badge> {c.title}{" "}
                        <span className="text-muted-foreground">
                          · {c.sourceName} · {relativeTime(c.at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : m.lastSuccessAt ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">{m.knownCount ? "No new or changed findings since the baseline run." : "Baseline run found no findings."}</p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-1">
                  <Button size="sm" variant="outline" disabled={busy === m.id || m.running} onClick={() => act(m.id, () => apiFetch(`/api/monitors/${m.id}/run`, { method: "POST", body: JSON.stringify({ clientId }) }))}>
                    {m.running ? <Loader2 className="animate-spin" /> : <RefreshCw />} Run now
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy === m.id} onClick={() => act(m.id, () => apiFetch(`/api/monitors/${m.id}`, { method: "PATCH", body: JSON.stringify({ clientId, active: !m.active }) }))}>
                    {m.active ? <Pause /> : <Play />} {m.active ? "Pause" : "Resume"}
                  </Button>
                  {m.lastTaskId ? (
                    <Button size="sm" variant="ghost" onClick={() => onOpenTask(m.lastTaskId as string)}>
                      <FileText /> Report
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" aria-label="Delete monitor" disabled={busy === m.id} onClick={() => act(m.id, () => apiFetch(`/api/monitors/${m.id}?clientId=${clientId}`, { method: "DELETE" }))}>
                    <Trash2 />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}