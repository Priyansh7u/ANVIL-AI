"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, CircleHelp, Clock, ExternalLink, FlaskConical, MapPin, RefreshCw, WifiOff } from "lucide-react";
import type { AlertFreshness, CapSeverity, DataMode } from "@/lib/core/types";
import { relativeTime } from "@/lib/core/freshness";
import { formatDateTime } from "@/lib/utils";
import { Badge, Button, Card, CardContent } from "@/components/ui/primitives";

export function SeverityBadge({ severity }: { severity: CapSeverity }) {
  const tone = severity === "Extreme" || severity === "Severe" ? "danger" : severity === "Moderate" ? "warning" : "neutral";
  return <Badge tone={tone}>{severity === "Unknown" ? "Severity not stated" : severity}</Badge>;
}

export function FreshnessBadge({ freshness }: { freshness: AlertFreshness }) {
  const map = {
    ACTIVE: { tone: "ok", label: "Active" },
    EXPIRED: { tone: "neutral", label: "Expired" },
    STALE: { tone: "warning", label: "Stale — no expiry, >24 h old" },
    UNKNOWN: { tone: "neutral", label: "Timing unknown" },
  } as const;
  const m = map[freshness];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function DataModeBadge({ mode, at }: { mode: DataMode; at?: string | null }) {
  const map = {
    LIVE: { tone: "ok", icon: CheckCircle2, label: "Live official data" },
    CACHED: { tone: "warning", icon: Clock, label: "Cached — source unreachable" },
    STALE: { tone: "warning", icon: Clock, label: "Source feed is stale" },
    SIMULATED: { tone: "sim", icon: FlaskConical, label: "SIMULATED data" },
    UNAVAILABLE: { tone: "danger", icon: WifiOff, label: "Official data unavailable" },
  } as const;
  const m = map[mode];
  const Icon = m.icon;
  return (
    <Badge tone={m.tone} title={at ? `Retrieved ${formatDateTime(at)}` : undefined}>
      <Icon className="size-3" aria-hidden />
      {m.label}
      {at ? <span className="opacity-75">· {relativeTime(at)}</span> : null}
    </Badge>
  );
}

export function SourceLink({ href, children }: { href: string; children?: React.ReactNode }) {
  let host = href;
  try {
    host = new URL(href).hostname;
  } catch {
    /* keep raw */
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline break-all">
      {children ?? host}
      <ExternalLink className="size-3 shrink-0" aria-hidden />
    </a>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ icon: Icon = CircleHelp, title, children }: { icon?: React.ComponentType<{ className?: string }>; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center">
      <Icon className="size-6 text-muted-foreground" />
      <p className="font-medium">{title}</p>
      {children ? <div className="max-w-md text-sm text-muted-foreground">{children}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-lg border border-danger/40 bg-danger-soft p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
        <span>{message}</span>
      </div>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RefreshCw /> Retry
        </Button>
      ) : null}
    </div>
  );
}

export function SimulatedBanner({ children }: { children?: React.ReactNode }) {
  return (
    <div role="note" className="flex items-start gap-2 rounded-lg border-2 border-dashed border-sim bg-sim-soft p-3 text-sm text-sim">
      <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>
        <strong>SIMULATION — not real.</strong>{" "}
        {children ?? "Fictional district, shelters and populations for demonstration. Never use for real decisions."}
      </div>
    </div>
  );
}

export function NeedsPlace({ what }: { what: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <EmptyState icon={MapPin} title="Choose a location first">
          <p className="mb-3">{what} needs your district. You can share an approximate location or pick a district manually.</p>
          <Link href="/onboarding" className="font-medium text-primary underline">
            Set location
          </Link>
        </EmptyState>
      </CardContent>
    </Card>
  );
}

export function StorageNotice({ storage }: { storage?: string }) {
  if (storage !== "EPHEMERAL") return null;
  return (
    <p className="text-xs text-muted-foreground">
      Storage: ephemeral (in-memory). Data resets when the server restarts — configure MONGODB_URI for persistence.
    </p>
  );
}
