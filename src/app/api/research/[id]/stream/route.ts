import type { NextRequest } from "next/server";
import { z } from "zod";
import { TERMINAL_STAGES, type HazardStage } from "@/lib/core/hazard-intel";
import { jsonError, rateLimit } from "@/lib/http";
import { findById } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Server-Sent Events: pushes the task's persisted state whenever it changes.
 * The state is read from storage each second, so what the client sees is exactly
 * what the research worker has written — nothing is generated here. The stream
 * closes on a terminal stage or after ~280 s (the client then reconnects or polls).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(req, "research-stream", 30, 60_000);
  if (limited) return limited;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return jsonError(400, "INVALID_INPUT", "Invalid task id");
  const first = await findById("ResearchTask", id);
  if (!first) return jsonError(404, "NOT_FOUND", "Task not found or expired.");

  const enc = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (!closed) controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const started = Date.now();
      let lastSig = "";
      let sentEvents = 0;
      let lastBeat = Date.now();
      req.signal.addEventListener("abort", () => {
        closed = true;
      });
      try {
        while (!closed && Date.now() - started < 280_000) {
          const t = await findById("ResearchTask", id);
          if (!t) {
            send("gone", { message: "Task no longer available." });
            break;
          }
          const events = (t.events as unknown[]) ?? [];
          const sig = `${t.stage}|${events.length}|${t.status}|${JSON.stringify(t.counts ?? {})}`;
          if (sig !== lastSig) {
            lastSig = sig;
            send("task", {
              id,
              stage: t.stage,
              status: t.status,
              counts: t.counts ?? {},
              providerRuns: t.providerRuns ?? [],
              newEvents: events.slice(sentEvents < events.length ? sentEvents : Math.max(0, events.length - 300)),
              eventCount: events.length,
              updatedAt: t.updatedAt,
            });
            sentEvents = events.length;
          } else if (Date.now() - lastBeat > 15_000) {
            if (!closed) controller.enqueue(enc.encode(`: heartbeat ${new Date().toISOString()}\n\n`));
            lastBeat = Date.now();
          }
          if (TERMINAL_STAGES.includes(t.stage as HazardStage)) {
            send("done", { stage: t.stage });
            break;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
        if (!closed && Date.now() - started >= 280_000) send("timeout", { message: "Stream window ended; reconnect to continue." });
      } catch (e) {
        send("error", { message: (e as Error).message });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}