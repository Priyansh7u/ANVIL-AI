"use client";

import { useEffect, useState } from "react";
import { Bell, Cloud, Loader2, MapPin, ShieldCheck, Trash2 } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import { apiFetch, useApi, type ApiError } from "@/hooks/use-api";
import { clearAllLocalData, getOrCreateClientId, resetClientId, useClientId, usePlace, usePrefs, type UiPrefs } from "@/hooks/use-local-state";
import { LocationPicker } from "@/components/shared/location-picker";
import { ErrorState, PageHeader } from "@/components/shared/status";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Label, Select } from "@/components/ui/primitives";

type Perm = NotificationPermission | "unsupported";

export default function SettingsPage() {
  const [place, setPlace] = usePlace();
  const [prefs, setPrefs] = usePrefs();
  const clientId = useClientId();
  const [perm, setPerm] = useState<Perm>("default");
  const [changingPlace, setChangingPlace] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const history = useApi<{ notifications: { _id: string; title: string; severity?: string; deliveredAt: string }[] }>(
    clientId ? `/api/notifications?clientId=${clientId}` : null,
  );

  useEffect(() => {
    setPerm(typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported");
  }, []);

  const toggleNotifications = async (on: boolean) => {
    setError(null);
    if (!on) {
      setPrefs({ notifications: false });
      return;
    }
    if (perm === "unsupported") {
      setError("This browser does not support notifications.");
      return;
    }
    const p = await Notification.requestPermission();
    setPerm(p);
    if (p === "granted") {
      getOrCreateClientId();
      setPrefs({ notifications: true });
    } else {
      setError("Notification permission was not granted. You can change this in your browser's site settings.");
    }
  };

  const sync = async () => {
    const id = getOrCreateClientId();
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/preferences", {
        method: "PUT",
        body: JSON.stringify({
          clientId: id,
          place: place ? { label: place.label, district: place.district, state: place.state } : null,
          language: prefs.language,
          accessibility: { largeText: prefs.largeText, reducedMotion: prefs.reducedMotion, highContrast: false },
          notifications: { enabled: prefs.notifications, hazards: [], minSeverity: prefs.minSeverity },
        }),
      });
      setMsg("Preferences saved to the server under your anonymous ID (district only — no coordinates).");
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const deleteAll = async () => {
    if (!window.confirm("Delete all ANVIL data for this device, on the server and in this browser?")) return;
    setBusy(true);
    setError(null);
    try {
      if (clientId) await apiFetch(`/api/preferences?clientId=${clientId}`, { method: "DELETE" });
      clearAllLocalData();
      resetClientId();
      setMsg("All your ANVIL data has been deleted. Family check-in entries can be removed from the Family page (they also auto-delete after 72 h).");
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (k: keyof Pick<UiPrefs, "largeText" | "reducedMotion">, label: string) => (
    <label className="flex min-h-10 items-center justify-between gap-2 text-sm">
      {label}
      <input type="checkbox" className="size-4" checked={prefs[k]} onChange={(e) => setPrefs({ [k]: e.target.checked })} />
    </label>
  );

  return (
    <>
      <PageHeader title="Settings & privacy" />
      {msg ? <p role="status" className="mb-4 rounded-md bg-ok-soft p-3 text-sm text-ok">{msg}</p> : null}
      {error ? <div className="mb-4"><ErrorState message={error} /></div> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><MapPin className="size-4" /> Location</CardTitle>
            <CardDescription>{place ? `${place.label} · ${place.source === "gps" ? "approximate location" : place.source === "demo" ? "demo preset" : "manual"}` : "Not set"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {changingPlace ? (
              <LocationPicker onPicked={(p) => { setPlace(p); setChangingPlace(false); }} />
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setChangingPlace(true)}>Change location</Button>
                {place ? <Button variant="ghost" onClick={() => setPlace(null)}>Forget location</Button> : null}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Display & accessibility</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="theme">Theme</Label>
                <Select id="theme" value={prefs.theme} onChange={(e) => setPrefs({ theme: e.target.value as UiPrefs["theme"] })}>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="lang">Language for plans</Label>
                <Select id="lang" value={prefs.language} onChange={(e) => setPrefs({ language: e.target.value as UiPrefs["language"] })}>
                  <option value="en">English</option>
                  <option value="hi">हिन्दी</option>
                </Select>
              </div>
            </div>
            {toggle("largeText", "Larger text")}
            {toggle("reducedMotion", "Reduce motion")}
          </CardContent>
        </Card>

        <Card id="notifications">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Bell className="size-4" /> Alert notifications</CardTitle>
            <CardDescription>
              Browser permission: <Badge tone={perm === "granted" ? "ok" : perm === "denied" ? "danger" : "neutral"}>{perm}</Badge>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <label className="flex min-h-10 items-center justify-between gap-2">
              Notify me about new official alerts for {place?.label ?? "my district"}
              <input type="checkbox" className="size-4" checked={prefs.notifications} onChange={(e) => toggleNotifications(e.target.checked)} disabled={!place} />
            </label>
            <div className="space-y-1">
              <Label htmlFor="minsev">Minimum severity</Label>
              <Select id="minsev" value={prefs.minSeverity} onChange={(e) => setPrefs({ minSeverity: e.target.value as UiPrefs["minSeverity"] })}>
                <option value="Extreme">Extreme only</option>
                <option value="Severe">Severe and above</option>
                <option value="Moderate">Moderate and above</option>
                <option value="Minor">Minor and above</option>
                <option value="Unknown">All, including unstated severity</option>
              </Select>
            </div>
            <p className="rounded-md bg-warning-soft p-2 text-xs text-warning">
              Limitations: notifications only arrive while ANVIL is open in a browser tab (checked every 5 minutes), with permission granted and an internet connection. Background push is not implemented in this version. Do not rely on ANVIL as your only warning channel — official SMS/cell broadcast alerts from SACHET reach phones directly.
            </p>
            <div>
              <p className="mb-1 font-medium">Notification history</p>
              {history.data?.notifications.length ? (
                <ul className="max-h-48 space-y-1 overflow-auto text-xs">
                  {history.data.notifications.map((n) => (
                    <li key={n._id} className="rounded border px-2 py-1">
                      <span className="text-muted-foreground">{formatDateTime(n.deliveredAt)}</span> — {n.title}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">No notifications shown yet.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4" /> Privacy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>No accounts. An anonymous random ID identifies this browser only if you save plans, sync preferences or receive notifications.</li>
              <li>GPS coordinates are rounded to ~1 km on your device, used once to find your district, and never stored on the server.</li>
              <li>Server retention: preferences 180 days of inactivity, saved plans 90 days, notification history 30 days, family check-ins 72 hours, simulations 7 days.</li>
              <li>Research tasks and documented shelters contain public government information only.</li>
            </ul>
            <p className="text-xs">Anonymous ID: <code className="break-all">{clientId ?? "not created"}</code></p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={sync} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Cloud />} Save preferences to server</Button>
              <Button variant="danger" onClick={deleteAll} disabled={busy}><Trash2 /> Delete all my data</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
