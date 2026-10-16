"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import type { SourceDefinition } from "@/lib/core/source-registry";
import { formatDateTime } from "@/lib/utils";
import { apiFetch, type ApiError } from "@/hooks/use-api";
import { ErrorState, PageHeader, SourceLink } from "@/components/shared/status";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from "@/components/ui/primitives";

interface Probe { ok: boolean; status?: number | null; ms?: number; error?: string | null }
interface Health {
  authorized: boolean;
  checkedAt?: string;
  capabilities: Record<string, boolean>;
  storage: string;
  sources: SourceDefinition[];
  probes: null | {
    sachet: Probe & { feedPublishedAt: string | null; items: number };
    nominatim: Probe;
    osrm: Probe;
    database: Probe;
    tinyfish: { configured: boolean; agentEnabled: boolean; note: string };
    ai: { configured: boolean; model: string | null };
  };
  recentResearch?: { total: number; byStatus: Record<string, number> };
}

function ProbeRow({ name, probe, extra }: { name: string; probe: Probe; extra?: string }) {
  return (
    <li className="flex items-start justify-between gap-3 border-b py-2 text-sm last:border-0">
      <span className="flex items-center gap-2 font-medium">
        {probe.ok ? <CheckCircle2 className="size-4 text-ok" /> : <XCircle className="size-4 text-danger" />} {name}
      </span>
      <span className="text-right text-xs text-muted-foreground">
        {probe.ok ? "reachable" : probe.error ?? "unreachable"}
        {probe.ms != null ? ` · ${probe.ms} ms` : ""}
        {extra ? <span className="block">{extra}</span> : null}
      </span>
    </li>
  );
}

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [data, setData] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (t: string) => {
    setLoading(true);
    try {
      setData(await apiFetch<Health>("/api/health", { headers: t ? { "x-admin-token": t } : {}, timeoutMs: 30_000 }));
      setError(null);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  return (
    <>
      <PageHeader
        title="Source health"
        description="Which integrations are configured, whether official sources are reachable right now, and how each source is used."
        actions={<Button variant="outline" size="sm" onClick={() => load(token)} disabled={loading}>{loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} Re-check</Button>}
      />
      {error ? <ErrorState message={error} onRetry={() => load(token)} /> : null}

      {data && !data.authorized ? (
        <Card className="mb-4">
          <CardContent className="pt-5">
            <form onSubmit={(e) => { e.preventDefault(); void load(token); }} className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1">
                <Label htmlFor="tok">Admin token (required for live probes)</Label>
                <Input id="tok" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
              </div>
              <Button type="submit">Unlock</Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="size-4" /> Configuration</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {Object.entries(data.capabilities).map(([k, v]) => (
                <Badge key={k} tone={v ? "ok" : "neutral"}>{k}: {v ? "on" : "off"}</Badge>
              ))}
              <Badge tone={data.storage === "MONGODB" ? "ok" : "warning"}>storage: {data.storage}</Badge>
            </CardContent>
          </Card>

          {data.probes ? (
            <Card>
              <CardHeader><CardTitle>Live probes</CardTitle></CardHeader>
              <CardContent>
                <ul>
                  <ProbeRow
                    name="NDMA SACHET feed"
                    probe={data.probes.sachet}
                    extra={`${data.probes.sachet.items} items · feed published ${formatDateTime(data.probes.sachet.feedPublishedAt)}`}
                  />
                  <ProbeRow name="MongoDB" probe={data.probes.database} />
                  <ProbeRow name="Nominatim geocoder" probe={data.probes.nominatim} />
                  <ProbeRow name="OSRM routing" probe={data.probes.osrm} />
                  <ProbeRow name="TinyFish" probe={{ ok: data.probes.tinyfish.configured, error: "API key not configured" }} extra={data.probes.tinyfish.note} />
                  <ProbeRow name="AI provider" probe={{ ok: data.probes.ai.configured, error: "API key not configured" }} extra={data.probes.ai.model ?? undefined} />
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">Checked {formatDateTime(data.checkedAt)}</p>
                {data.recentResearch ? (
                  <p className="mt-2 text-xs">
                    Recent research tasks: {data.recentResearch.total}{" "}
                    {Object.entries(data.recentResearch.byStatus).map(([k, v]) => `${k} ${v}`).join(" · ")}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Source registry</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr><th className="py-2 pr-3">Source</th><th className="pr-3">Integration</th><th className="pr-3">Official</th><th>Notes</th></tr>
                </thead>
                <tbody>
                  {data.sources.map((s) => (
                    <tr key={s.id} className="border-t align-top">
                      <td className="py-2 pr-3">
                        <p className="font-medium">{s.name}</p>
                        <p className="text-xs text-muted-foreground">{s.owner}</p>
                        <SourceLink href={s.homepage} />
                      </td>
                      <td className="pr-3"><Badge>{s.kind.replaceAll("_", " ").toLowerCase()}</Badge></td>
                      <td className="pr-3">{s.official ? <Badge tone="ok">Govt.</Badge> : <Badge>Third-party</Badge>}</td>
                      <td className="text-xs text-muted-foreground">{s.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </>
  );
}
