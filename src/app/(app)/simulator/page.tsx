"use client";

import { useState } from "react";
import { FlaskConical, Radar } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlace } from "@/hooks/use-local-state";
import { LiveSimulator } from "@/components/simulator/live-simulator";
import { TrainingSimulator } from "@/components/simulator/training-simulator";
import { PageHeader } from "@/components/shared/status";

export default function SimulatorPage() {
  const [place] = usePlace();
  const [mode, setMode] = useState<"live" | "training">(place ? "live" : "training");
  const effective = place ? mode : "training";

  return (
    <>
      <PageHeader
        title="What-if disaster simulator"
        description="Close a shelter, block a road or surge demand — and watch the response plan re-balance. Simulations are clearly labelled and are never mixed with live official warnings."
        actions={
          <div className="flex rounded-md border p-0.5" role="tablist" aria-label="Simulation mode">
            <button
              role="tab"
              aria-selected={effective === "live"}
              disabled={!place}
              onClick={() => setMode("live")}
              className={cn("flex items-center gap-1.5 rounded px-3 py-1.5 text-sm disabled:opacity-50", effective === "live" && "bg-sim text-white")}
            >
              <Radar className="size-4" /> Live-seeded{place ? ` · ${place.district ?? place.state ?? ""}` : ""}
            </button>
            <button
              role="tab"
              aria-selected={effective === "training"}
              onClick={() => setMode("training")}
              className={cn("flex items-center gap-1.5 rounded px-3 py-1.5 text-sm", effective === "training" && "bg-sim text-white")}
            >
              <FlaskConical className="size-4" /> Training scenario
            </button>
          </div>
        }
      />
      {effective === "live" && place ? <LiveSimulator place={place} onNeedTraining={() => setMode("training")} /> : <TrainingSimulator />}
    </>
  );
}