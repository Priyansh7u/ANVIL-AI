"use client";

import { useEffect, useState } from "react";
import { Bot, CheckCircle2, CircleDashed, Loader2, Phone, Play, Quote, ShieldAlert, XCircle } from "lucide-react";
import type { ResearchState } from "@/lib/core/types";
import { cn, formatDateTime } from "@/lib/utils";
import { apiFetch, placeQuery, useApi, type ApiError } from "@/hooks/use-api";
import { usePlace } from "@/hooks/use-local-state";
import type { ConfigResponse, ResearchTaskDto } from "@/types/api";
import { EmptyState, ErrorState, NeedsPlace, PageHeader, SourceLink, StorageNotice } from "@/components/shared/status";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";

const TERMINAL: ResearchState[] = ["COMPLETED", "PARTIAL", "FAILED"];
const STATE_TONE: Record<ResearchState, "neutral" | "ok" | "warning" | "danger"> = {
  PENDING: "neutral",
  RESEARCHING: "warning",
  VALIDATING: "warning",
  COMPLETED: "ok",
  PARTIAL: "warning",
  FAILED: "danger",
};
const FLAG_LABEL: Record<string, string> = {
  STALE: "Possibly outdated",
  CONFLICT: "Conflicting information",
  MISSING: "Missing information",
  INJECTION_SUSPECTED: "Suspicious page content",
  FETCH_FAILED: "Retrieval problem",
  UNVERIFIED_DROPPED: "Unverified items discarded",
  NON_OFFICIAL_SKIPPED: "Non-official sources ignored",
};

export default function AgentPage() {
  const [place] = usePlace();
  const config = useApi<ConfigResponse>("/api/config");
  const history = useApi<{ tasks: Pick<ResearchTaskDto, "id" | "status" | "createdAt" | "finishedAt">[]; storage: string }>(
    place ? `/api/research?${placeQuery(place)}` : null,
  );
  const [taskId, setTaskId] = useState<string | null>(null);
  const [task, setTask] = useState<ResearchTaskDto | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);

  const activeId = taskId ?? history.data?.tasks[0]?.id ?? null;

  // Poll the persisted task. Every event shown was written by the server as the step happened.
  useEffect(() => {
    if (!activeId) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const r = await apiFetch<{ task: ResearchTaskDto }>(`/api/research/${activeId}`, { timeoutMs: 15_000 });
        if (stop) return;
        setTask(r.task);
        setPollError(null);
        if (!TERMINAL.includes(r.task.status)) timer = setTimeout(tick, 2_000);
        else history.reload();
      } catch (e) {
        if (stop) return;
        setPollError((e as ApiError).message);
        timer = setTimeout(tick, 5_000);
      }
    };
    void tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- history.reload is stable; re-run only for a new task
  }, [activeId]);

  if (!place) {
    return (
      <>
        <PageHeader title="AI research agent" />
        <NeedsPlace what="The research agent" />
      </>
    );
  }

  const start = async () => {
    setStarting(true);
    setStartError(null);
    try {
      const r = await apiFetch<{ id: string }>("/api/research", {
        method: "POST",
        body: JSON.stringify({ place: { label: place.label, district: place.district, state: place.state } }),
      });
      setTask(null);
      setTaskId(r.id);
    } catch (e) {
      setStartError((e as ApiError).message);
    } finally {
      setStarting(false);
    }
  };

  const running = task ? !TERMINAL.includes(task.status) : false;
  const caps = config.data?.capabilities;

  return (
    <>
      <PageHeader
        title="AI research agent"
        description="Searches the public web with TinyFish, reads only government (*.gov.in / *.nic.in) pages, and keeps a fact only if its quote is found verbatim on the page."
        actions={
          <Button onClick={start} disabled={starting || running || caps?.tinyfish === false}>
            {starting || running ? <Loader2 className="animate-spin" /> : <Play />} Research {place.label}
          </Button>
        }
      />

      {caps ? (
        <div className="mb-4 flex flex-wrap gap-2 text-xs">
          <Badge tone={caps.tinyfish ? "ok" : "danger"}>TinyFish Search/Fetch: {caps.tinyfish ? "configured" : "not configured"}</Badge>
          <Badge tone={caps.tinyfishAgent ? "ok" : "neutral"}>TinyFish Agent browsing: {caps.tinyfishAgent ? "on" : "off"}</Badge>
          <Badge tone={caps.ai ? "ok" : "warning"}>AI extraction: {caps.ai ? "on" : "off — pattern matching only"}</Badge>
        </div>
      ) : null}
      {caps && !caps.tinyfish ? (
        <ErrorState message="This server has no TINYFISH_API_KEY, so the agent cannot browse. Nothing will be simulated in its place — add the key to enable research." />
      ) : null}
      {startError ? <ErrorState message={startError} /> : null}
      {pollError ? <ErrorState message={`Lost contact with the task: ${pollError}. Retrying…`} /> : null}

      {!task ? (
        <EmptyState icon={Bot} title="No research for this area yet">
          Start a task to find official relief camps, control-room numbers and advisories for {place.label}.
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle>Progress</CardTitle>
                <Badge tone={STATE_TONE[task.status]}>{task.status}</Badge>
              </div>
              <CardDescription>Started {formatDateTime(task.startedAt ?? task.createdAt)}</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="relative space-y-3 border-l pl-4" aria-live="polite">
                {task.events.map((e, i) => (
                  <li key={`${e.at}-${i}`} className="text-sm">
                    <span className="absolute -left-[7px] mt-1">
                      {e.state === "FAILED" ? <XCircle className="size-3.5 text-danger" /> : e.state === "COMPLETED" ? <CheckCircle2 className="size-3.5 text-ok" /> : <CircleDashed className="size-3.5 text-primary" />}
                    </span>
                    <p>{e.message}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(e.at).toLocaleTimeString("en-IN")} · {e.state}
                      {e.url ? <> · <SourceLink href={e.url} /></> : null}
                    </p>
                  </li>
                ))}
                {running ? (
                  <li className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> working…
                  </li>
                ) : null}
              </ol>
            </CardContent>
          </Card>

          <div className="space-y-4 lg:col-span-3">
            {task.result?.summary ? (
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>Briefing</CardTitle>
                    <Badge tone={task.result.summaryIsAiGenerated ? "warning" : "neutral"}>
                      {task.result.summaryIsAiGenerated ? "AI-written from verified facts" : "Generated from template"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="text-sm">{task.result.summary}</CardContent>
              </Card>
            ) : null}

            {task.flags.length ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><ShieldAlert className="size-4" /> Validation flags</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm">
                    {task.flags.map((f, i) => (
                      <li key={i} className="flex flex-col gap-0.5">
                        <span>
                          <Badge tone={f.type === "CONFLICT" || f.type === "INJECTION_SUSPECTED" ? "danger" : "warning"}>{FLAG_LABEL[f.type] ?? f.type}</Badge>{" "}
                          {f.message}
                        </span>
                        {f.url ? <SourceLink href={f.url} /> : null}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}

            {task.result && (task.result.contacts.length > 0 || task.result.advisories.length > 0 || (task.result.roadClosures ?? []).length > 0) ? (
              <Card>
                <CardHeader>
                  <CardTitle>Verified findings</CardTitle>
                  <CardDescription>Each item&apos;s quote was matched verbatim against the page text retrieved at research time.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {task.result.contacts.map((c, i) => (
                    <div key={`c${i}`} className="rounded-md border p-3 text-sm">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        <Phone className="size-3.5" /> {c.label}:{" "}
                        <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="text-primary underline">{c.phone}</a>
                      </p>
                      <p className="mt-1 flex gap-1 text-xs text-muted-foreground"><Quote className="size-3 shrink-0" />{c.evidence.evidenceQuote}</p>
                      <SourceLink href={c.evidence.sourceUrl} />
                    </div>
                  ))}
                  {task.result.advisories.map((a, i) => (
                    <div key={`a${i}`} className="rounded-md border p-3 text-sm">
                      <p>{a.text}</p>
                      <p className="mt-1 flex gap-1 text-xs text-muted-foreground"><Quote className="size-3 shrink-0" />{a.evidence.evidenceQuote}</p>
                      <SourceLink href={a.evidence.sourceUrl} />
                    </div>
                  ))}
                  {(task.result.roadClosures ?? []).map((r, i) => (
                    <div key={`r${i}`} className="rounded-md border border-warning/50 p-3 text-sm">
                      <p className="font-medium">Road closure: {r.road} <Badge tone="warning">{r.status}</Badge></p>
                      <p className="mt-1 flex gap-1 text-xs text-muted-foreground"><Quote className="size-3 shrink-0" />{r.evidence.evidenceQuote}</p>
                      <SourceLink href={r.evidence.sourceUrl} />
                    </div>
                  ))}
                  {task.result.shelters.length ? (
                    <p className="text-sm">{task.result.shelters.length} documented shelter(s) saved — see the shelter finder.</p>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            {task.sources.length ? (
              <Card>
                <CardHeader>
                  <CardTitle>Sources visited</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm">
                    {task.sources.map((s, i) => (
                      <li key={`${s.url}-${i}`} className="flex flex-col gap-0.5 border-b pb-2 last:border-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge tone={s.status === "FETCHED" ? "ok" : s.status === "FAILED" ? "danger" : "neutral"}>{s.status}</Badge>
                          <span className={cn("font-medium", s.status !== "FETCHED" && "text-muted-foreground")}>{s.title ?? "Untitled page"}</span>
                          <Badge>{s.via.replace("TINYFISH_", "TinyFish ").toLowerCase()}</Badge>
                        </span>
                        <SourceLink href={s.url} />
                        {s.note ? <span className="text-xs text-muted-foreground">{s.note}</span> : null}
                        {s.fetchedAt ? <span className="text-xs text-muted-foreground">Retrieved {formatDateTime(s.fetchedAt)}</span> : null}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      )}

      {history.data?.tasks.length ? (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">Previous runs for this area</h2>
          <ul className="flex flex-wrap gap-2">
            {history.data.tasks.map((t) => (
              <li key={t.id}>
                <Button size="sm" variant={t.id === activeId ? "default" : "outline"} onClick={() => setTaskId(t.id)}>
                  {formatDateTime(t.createdAt)} · {t.status}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="mt-4">
        <StorageNotice storage={history.data?.storage} />
      </div>
    </>
  );
}