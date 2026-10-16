import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, rateLimit } from "@/lib/http";
import { findById, storageMode } from "@/lib/repo";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(req, "research-poll", 120, 60_000);
  if (limited) return limited;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return jsonError(400, "INVALID_INPUT", "Invalid task id");
  const task = await findById("ResearchTask", id);
  if (!task) {
    return jsonError(
      404,
      "NOT_FOUND",
      storageMode() === "EPHEMERAL"
        ? "Task not found. This server uses ephemeral storage, so tasks are lost on restart or on another instance."
        : "Task not found or expired.",
    );
  }
  return NextResponse.json({ task: { ...task, id: task._id }, storage: storageMode() }, { headers: { "Cache-Control": "no-store" } });
}
