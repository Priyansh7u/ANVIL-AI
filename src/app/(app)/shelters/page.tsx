"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Accessibility, Bot, House, Quote } from "lucide-react";
import { relativeTime } from "@/lib/core/freshness";
import { cn } from "@/lib/utils";
import { placeQuery, useApi } from "@/hooks/use-api";
import { usePlace } from "@/hooks/use-local-state";
import type { ShelterDto } from "@/types/api";
import { EmptyState, ErrorState, NeedsPlace, PageHeader, SourceLink, StorageNotice } from "@/components/shared/status";
import { Badge, buttonVariants, Card, CardContent, Input, Label, Skeleton } from "@/components/ui/primitives";

export default function SheltersPage() {
  const [place] = usePlace();
  const { data, error, loading, reload } = useApi<{ shelters: ShelterDto[]; note: string; storage: string }>(
    place ? `/api/shelters?${placeQuery(place)}` : null,
  );
  const [filter, setFilter] = useState("");
  const [onlyAccessible, setOnlyAccessible] = useState(false);
  const [onlyMapped, setOnlyMapped] = useState(false);

  const list = useMemo(
    () =>
      (data?.shelters ?? []).filter(
        (s) =>
          (!filter || `${s.name} ${s.address ?? ""}`.toLowerCase().includes(filter.toLowerCase())) &&
          (!onlyAccessible || Boolean(s.accessibility)) &&
          (!onlyMapped || s.location?.precision === "GEOCODED_ADDRESS"),
      ),
    [data, filter, onlyAccessible, onlyMapped],
  );

  if (!place) {
    return (
      <>
        <PageHeader title="Verified shelter finder" />
        <NeedsPlace what="The shelter finder" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Verified shelter finder"
        description="Relief camps and shelters that an official government page lists for your district, each with the exact quote and link. ANVIL never marks a place as safe or open unless the source says so."
        actions={
          <>
            <Link href="/nearby" className={cn(buttonVariants({ size: "sm" }))}>
              <House /> Nearby help on a map
            </Link>
            <Link href="/agent" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              <Bot /> Research this area
            </Link>
          </>
        }
      />

      <div className="mb-4 rounded-lg border border-warning/50 bg-warning-soft p-3 text-sm text-warning">
        Availability, capacity and safety change quickly during an emergency. Always confirm with the district control room or follow evacuation instructions from officials.
      </div>

      <div className="mb-4 grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-3 sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="sf">Filter by name or address</Label>
          <Input id="sf" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="e.g. school" />
        </div>
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={onlyAccessible} onChange={(e) => setOnlyAccessible(e.target.checked)} />
          Accessibility documented
        </label>
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={onlyMapped} onChange={(e) => setOnlyMapped(e.target.checked)} />
          Has map position
        </label>
      </div>

      {error ? <ErrorState message={error.message} onRetry={reload} /> : null}

      {loading && !data ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={House} title={data?.shelters.length ? "No shelters match these filters" : "No documented shelters yet for this area"}>
          {data?.shelters.length ? null : (
            <>
              Run the <Link href="/agent" className="text-primary underline">research agent</Link> to look for relief camps on official district and SDMA pages. If none are published, ANVIL will say so rather than guess.
            </>
          )}
        </EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {list.map((s) => (
            <li key={s.id}>
              <Card className="h-full">
                <CardContent className="space-y-2 pt-4 sm:pt-5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="ok">Listed on official page</Badge>
                    {s.location?.precision === "GEOCODED_ADDRESS" ? <Badge>Mapped (approx.)</Badge> : <Badge>No map position</Badge>}
                  </div>
                  <h2 className="font-semibold">{s.name}</h2>
                  {s.address ? <p className="text-sm text-muted-foreground">{s.address}</p> : null}
                  <dl className="grid grid-cols-2 gap-1 text-xs">
                    <dt className="text-muted-foreground">Capacity</dt>
                    <dd>{s.capacity != null ? `${s.capacity} (as published)` : "Not published"}</dd>
                    <dt className="text-muted-foreground">Status</dt>
                    <dd>{s.operationalStatus ?? "Not published — unverified"}</dd>
                    <dt className="text-muted-foreground"><Accessibility className="mr-1 inline size-3" />Accessibility</dt>
                    <dd>{s.accessibility ?? "Not documented"}</dd>
                  </dl>
                  <blockquote className="flex gap-2 rounded-md bg-muted p-2 text-xs">
                    <Quote className="size-3 shrink-0" aria-hidden />
                    <span>{s.verification.evidence.evidenceQuote}</span>
                  </blockquote>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <SourceLink href={s.verification.evidence.sourceUrl} />
                    <span>Verified against page {relativeTime(s.verification.evidence.retrievedAt)}</span>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4">
        <StorageNotice storage={data?.storage} />
      </div>
    </>
  );
}