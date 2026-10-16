"use client";

import { useEffect, useState } from "react";
import { Copy, HeartHandshake, Loader2, LogOut, RefreshCw } from "lucide-react";
import { relativeTime } from "@/lib/core/freshness";
import { cn } from "@/lib/utils";
import { apiFetch, type ApiError } from "@/hooks/use-api";
import { EmptyState, ErrorState, PageHeader } from "@/components/shared/status";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Textarea } from "@/components/ui/primitives";

type Status = "SAFE" | "NEED_ASSISTANCE" | "NOT_CONFIRMED";
interface Member { memberId: string; displayName: string; status: Status; note: string; updatedAt: string }
interface Saved { code: string; memberToken?: string; displayName?: string }

const KEY = "anvil.family.v1";
const STATUS: Record<Status, { label: string; tone: "ok" | "danger" | "neutral" }> = {
  SAFE: { label: "Safe", tone: "ok" },
  NEED_ASSISTANCE: { label: "Need assistance", tone: "danger" },
  NOT_CONFIRMED: { label: "Not confirmed", tone: "neutral" },
};

function loadSaved(): Saved | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null") as Saved | null;
  } catch {
    return null;
  }
}
function storeSaved(s: Saved | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export default function FamilyPage() {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [group, setGroup] = useState<{ groupName: string; expiresAt: string; members: Member[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState<Status>("SAFE");
  const [note, setNote] = useState("");
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    const s = loadSaved();
    // Allow invite links like /family?code=ABCD2345
    const urlCode = new URLSearchParams(window.location.search).get("code");
    if (urlCode && (!s || s.code !== urlCode.toUpperCase())) {
      const next = { code: urlCode.toUpperCase() };
      storeSaved(next);
      setSaved(next);
    } else if (s) {
      setSaved(s);
      setDisplayName(s.displayName ?? "");
    }
  }, []);

  const refresh = async (code: string) => {
    try {
      setGroup(await apiFetch(`/api/family/${code}`));
      setError(null);
    } catch (e) {
      const err = e as ApiError;
      setError(err.message);
      if (err.status === 404) {
        storeSaved(null);
        setSaved(null);
        setGroup(null);
      }
    }
  };

  useEffect(() => {
    if (!saved?.code) return;
    void refresh(saved.code);
    const t = setInterval(() => refresh(saved.code), 30_000);
    return () => clearInterval(t);
  }, [saved?.code]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await apiFetch<{ code: string }>("/api/family", { method: "POST", body: JSON.stringify({ groupName }) });
      const next = { code: r.code };
      storeSaved(next);
      setSaved(next);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const next = { code: joinCode.trim().toUpperCase() };
    storeSaved(next);
    setSaved(next);
  };

  const postStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!saved) return;
    setBusy(true);
    try {
      const r = await apiFetch<{ memberToken: string; members: Member[] }>(`/api/family/${saved.code}`, {
        method: "POST",
        body: JSON.stringify({ displayName, status, note, consent, ...(saved.memberToken ? { memberToken: saved.memberToken } : {}) }),
      });
      const next = { ...saved, memberToken: r.memberToken, displayName };
      storeSaved(next);
      setSaved(next);
      setGroup((g) => (g ? { ...g, members: r.members } : g));
      setError(null);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    if (!saved) return;
    if (saved.memberToken) {
      await apiFetch(`/api/family/${saved.code}`, { method: "DELETE", body: JSON.stringify({ memberToken: saved.memberToken }) }).catch(() => undefined);
    }
    storeSaved(null);
    setSaved(null);
    setGroup(null);
  };

  const inviteUrl = saved ? `${typeof window !== "undefined" ? window.location.origin : ""}/family?code=${saved.code}` : "";

  return (
    <>
      <PageHeader
        title="Family safety check-in"
        description="Opt-in status sharing with people you choose. No location, no tracking, no automatic emergency dispatch. Groups delete themselves after 72 hours."
      />
      <div className="mb-4 rounded-lg border border-danger/40 bg-danger-soft p-3 text-sm">
        Marking &quot;Need assistance&quot; only informs your group. It does <strong>not</strong> alert emergency services — call <a href="tel:112" className="font-semibold underline">112</a> for help.
      </div>
      {error ? <div className="mb-4"><ErrorState message={error} /></div> : null}

      {!saved ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Start a group</CardTitle><CardDescription>You&apos;ll get a code to share with family.</CardDescription></CardHeader>
            <CardContent>
              <form onSubmit={create} className="space-y-3">
                <Label htmlFor="gname">Group name</Label>
                <Input id="gname" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="e.g. Sharma family" minLength={2} maxLength={60} required />
                <Button type="submit" disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <HeartHandshake />} Create group</Button>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Join a group</CardTitle><CardDescription>Enter the 8-character code you were sent.</CardDescription></CardHeader>
            <CardContent>
              <form onSubmit={join} className="space-y-3">
                <Label htmlFor="jcode">Group code</Label>
                <Input id="jcode" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="ABCD2345" maxLength={8} pattern="[A-Za-z2-9]{8}" required className="uppercase tracking-widest" />
                <Button type="submit" variant="outline">Join</Button>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{group?.groupName ?? "Loading group…"}</CardTitle>
              <CardDescription>
                Code <strong className="tracking-widest">{saved.code}</strong>
                {group ? ` · auto-deletes ${relativeTime(group.expiresAt)}` : ""}
              </CardDescription>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(inviteUrl)}><Copy /> Copy invite link</Button>
                <Button size="sm" variant="ghost" onClick={() => refresh(saved.code)}><RefreshCw /> Refresh</Button>
                <Button size="sm" variant="ghost" onClick={leave}><LogOut /> Leave &amp; delete my entry</Button>
              </div>
            </CardHeader>
            <CardContent>
              {!group || group.members.length === 0 ? (
                <EmptyState icon={HeartHandshake} title="No one has checked in yet" />
              ) : (
                <ul className="divide-y">
                  {group.members.map((m) => (
                    <li key={m.memberId} className="flex items-start justify-between gap-3 py-2">
                      <div>
                        <p className="font-medium">{m.displayName}</p>
                        {m.note ? <p className="text-sm text-muted-foreground">{m.note}</p> : null}
                        <p className="text-xs text-muted-foreground">Updated {relativeTime(m.updatedAt)}</p>
                      </div>
                      <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{saved.memberToken ? "Update my status" : "Share my status"}</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={postStatus} className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="dn">Display name (a nickname is fine)</Label>
                  <Input id="dn" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} required />
                </div>
                <fieldset className="grid gap-2 sm:grid-cols-3">
                  <legend className="mb-1 text-sm font-medium">Status</legend>
                  {(Object.keys(STATUS) as Status[]).map((s) => (
                    <label key={s} className={cn("flex min-h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm", status === s && "border-primary bg-muted")}>
                      <input type="radio" name="status" value={s} checked={status === s} onChange={() => setStatus(s)} />
                      {STATUS[s].label}
                    </label>
                  ))}
                </fieldset>
                <div className="space-y-1">
                  <Label htmlFor="note">Short note (optional, max 140)</Label>
                  <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} rows={2} placeholder="Do not include your exact address" />
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5 size-4" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
                  I agree to share this name, status and note with anyone who has this group&apos;s code, for up to 72 hours.
                </label>
                <Button type="submit" disabled={busy || !consent}>{busy ? <Loader2 className="animate-spin" /> : null} Share status</Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
