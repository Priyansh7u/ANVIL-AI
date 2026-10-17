"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { BatteryMedium, Check, Copy, Crosshair, Loader2, MapPin, MessageCircle, MessageSquare, Phone, Share2, Siren } from "lucide-react";
import { haversineKm, type LatLon } from "@/lib/core/geometry";
import { cn } from "@/lib/utils";
import { placeQuery, useApi } from "@/hooks/use-api";
import { usePlace } from "@/hooks/use-local-state";
import { useStored } from "@/hooks/use-stored";
import type { AlertsResponse, ShelterDto } from "@/types/api";
import { EMPTY_CARD, type FamilyCardData } from "@/components/plan/family-card";
import { PageHeader } from "@/components/shared/status";
import { SignalTools } from "@/components/sos/signal-tools";
import { Button, Input, Label } from "@/components/ui/primitives";

const NEEDS = [
  { id: "evac", label: "Need evacuation" },
  { id: "injured", label: "Someone is injured" },
  { id: "trapped", label: "Trapped" },
  { id: "medicine", label: "Need medicine" },
  { id: "water", label: "Need food / water" },
] as const;

type Fix = { lat: number; lon: number; accuracy: number | null; at: string; source: "gps" | "saved" };

export default function SosPage() {
  const [place] = usePlace();
  const reduce = useReducedMotion();
  const [card] = useStored<FamilyCardData>("anvil.familycard.v1", EMPTY_CARD);
  const [fix, setFix] = useState<Fix | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [needs, setNeeds] = useState<string[]>(["evac"]);
  const [people, setPeople] = useState(1);
  const [copied, setCopied] = useState(false);
  const [battery, setBattery] = useState<{ level: number; charging: boolean } | null>(null);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare("share" in navigator), []);

  const alerts = useApi<AlertsResponse>(place ? `/api/alerts?${placeQuery(place)}&scope=local` : null, { refreshMs: 3 * 60_000 });
  const shelters = useApi<{ shelters: ShelterDto[] }>(place ? `/api/shelters?${placeQuery(place)}` : null);

  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean; addEventListener: (t: string, f: () => void) => void; removeEventListener: (t: string, f: () => void) => void }> };
    let cleanup = () => {};
    void nav.getBattery?.().then((b) => {
      const on = () => setBattery({ level: b.level, charging: b.charging });
      on();
      b.addEventListener("levelchange", on);
      b.addEventListener("chargingchange", on);
      cleanup = () => {
        b.removeEventListener("levelchange", on);
        b.removeEventListener("chargingchange", on);
      };
    }).catch(() => undefined);
    return () => cleanup();
  }, []);

  // Fall back to the saved (approximate) area until a GPS fix arrives.
  const where: Fix | null = fix ?? (place?.lat != null && place?.lon != null ? { lat: place.lat, lon: place.lon, accuracy: null, at: new Date().toISOString(), source: "saved" } : null);

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setGeoError("This browser can't share location.");
      return;
    }
    setLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setFix({ lat: Math.round(p.coords.latitude * 1e5) / 1e5, lon: Math.round(p.coords.longitude * 1e5) / 1e5, accuracy: Math.round(p.coords.accuracy), at: new Date().toISOString(), source: "gps" });
        setLocating(false);
      },
      (e) => {
        setGeoError(e.code === e.PERMISSION_DENIED ? "Location permission was denied. Your saved area is used instead." : "Couldn't get a GPS fix. Try again outdoors.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  };

  const nearest = useMemo(() => {
    if (!where) return null;
    const me: LatLon = [where.lat, where.lon];
    return (
      (shelters.data?.shelters ?? [])
        .filter((s) => s.location?.precision === "GEOCODED_ADDRESS" && typeof s.location.lat === "number" && typeof s.location.lon === "number")
        .map((s) => ({ s, km: haversineKm(me, [s.location!.lat as number, s.location!.lon as number]) }))
        .sort((a, b) => a.km - b.km)[0] ?? null
    );
  }, [where, shelters.data]);

  const activeAlerts = (alerts.data?.alerts ?? []).filter((a) => a.freshness === "ACTIVE" && a.relevance !== "NONE");

  const message = useMemo(() => {
    const lines = [
      `SOS — I need help. ${people > 1 ? `${people} people with me.` : ""}`.trim(),
      needs.length ? NEEDS.filter((n) => needs.includes(n.id)).map((n) => n.label).join(", ") + "." : "",
      where
        ? `Location${where.source === "saved" ? " (approximate area)" : where.accuracy != null ? ` (±${where.accuracy} m)` : ""}: ${where.lat}, ${where.lon} https://maps.google.com/?q=${where.lat},${where.lon}`
        : place
          ? `Area: ${place.label}`
          : "",
      `Time: ${new Date(where?.at ?? Date.now()).toLocaleString("en-IN")}`,
      battery ? `Phone battery ${Math.round(battery.level * 100)}%.` : "",
      nearest ? `Nearest documented shelter: ${nearest.s.name} (~${Math.round(nearest.km * 10) / 10} km).` : "",
      "Sent from ANVIL. Emergency number: 112.",
    ];
    return lines.filter(Boolean).join("\n");
  }, [people, needs, where, place, battery, nearest]);


  const contacts = card.contacts.filter((c) => c.name.trim() && c.phone.trim());
  const smsTo = contacts.map((c) => c.phone.replace(/[^\d+]/g, "")).join(",");

  return (
    <>
      <PageHeader title="SOS & signal" description="Call for help, send your exact location to family in one tap, and signal rescuers with your torch, screen or a siren. Works on any phone browser." />

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        {/* Call first */}
        <section className="panel panel-danger flex flex-col items-center justify-center gap-4 p-6 text-center" aria-labelledby="call-h">
          <h2 id="call-h" className="sr-only">Emergency call</h2>
          <a href="tel:112" className="group relative grid size-48 place-items-center rounded-full bg-danger text-white shadow-[0_20px_60px_-15px_var(--danger)] outline-offset-4 transition-transform active:scale-95 sm:size-56" aria-label="Call 112, India's emergency number">
            {!reduce ? (
              <motion.span aria-hidden className="absolute inset-0 rounded-full border-4 border-danger" animate={{ scale: [1, 1.35], opacity: [0.7, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }} />
            ) : null}
            <span className="flex flex-col items-center">
              <Phone className="size-10" aria-hidden />
              <span className="num mt-1 text-6xl">112</span>
              <span className="text-sm opacity-90">Tap to call</span>
            </span>
          </a>
          <p className="max-w-[36ch] text-sm text-muted-foreground">India&apos;s single emergency number for police, fire and ambulance.</p>
          {contacts.length ? (
            <div className="w-full">
              <p className="label-caps mb-2">Family card contacts</p>
              <div className="flex flex-wrap justify-center gap-2">
                {contacts.map((c) => (
                  <a key={c.phone} href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="inline-flex min-h-11 items-center gap-2 rounded-full border bg-card px-4 text-sm hover:bg-muted">
                    <Phone className="size-4 text-primary" aria-hidden /> {c.name}
                  </a>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        {/* Location message */}
        <section className="panel space-y-4 p-4 sm:p-5" aria-labelledby="msg-h">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="msg-h" className="flex items-center gap-2 text-lg font-semibold"><Siren className="size-5 text-danger" aria-hidden /> Help message</h2>
            {battery ? (
              <span className={cn("inline-flex items-center gap-1 text-xs", battery.level < 0.2 && !battery.charging ? "text-danger" : "text-muted-foreground")}>
                <BatteryMedium className="size-4" aria-hidden /> {Math.round(battery.level * 100)}%{battery.charging ? " · charging" : battery.level < 0.2 ? " · lower brightness, close other apps" : ""}
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={locate} disabled={locating}>{locating ? <Loader2 className="animate-spin" /> : <Crosshair />} {fix ? "Update GPS position" : "Use my exact GPS position"}</Button>
            {where ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="size-3.5" aria-hidden />
                {where.source === "gps" ? `GPS ±${where.accuracy ?? "?"} m` : "Saved area (approximate)"}
              </span>
            ) : null}
          </div>
          {geoError ? <p className="text-sm text-warning" role="status">{geoError}</p> : null}

          <fieldset>
            <legend className="mb-2 text-sm font-medium">What do you need?</legend>
            <div className="flex flex-wrap gap-2">
              {NEEDS.map((n) => {
                const on = needs.includes(n.id);
                return (
                  <button key={n.id} type="button" aria-pressed={on} onClick={() => setNeeds((v) => (on ? v.filter((x) => x !== n.id) : [...v, n.id]))} className={cn("min-h-10 rounded-full border px-3 text-sm transition-colors", on ? "border-danger bg-danger-soft text-danger" : "hover:bg-muted")}>
                    {on ? <Check className="mr-1 inline size-3.5" aria-hidden /> : null}{n.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="w-40 space-y-1">
            <Label htmlFor="ppl">People with you</Label>
            <Input id="ppl" type="number" inputMode="numeric" min={1} max={200} value={people} onChange={(e) => setPeople(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} />
          </div>

          <pre className="whitespace-pre-wrap rounded-lg bg-muted p-3 font-sans text-sm" aria-label="Message preview">{message}</pre>

          <div className="grid gap-2 sm:grid-cols-2">
            {canShare ? (
              <Button onClick={() => void navigator.share({ title: "SOS", text: message }).catch(() => undefined)}><Share2 /> Share…</Button>
            ) : null}
            <a className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-[#25D366] px-4 text-sm font-medium text-black hover:brightness-95" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="size-4" aria-hidden /> WhatsApp
            </a>
            <a className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border bg-card px-4 text-sm font-medium hover:bg-muted" href={`sms:${smsTo}?&body=${encodeURIComponent(message)}`}>
              <MessageSquare className="size-4" aria-hidden /> SMS{contacts.length ? ` to ${contacts.length} family contact${contacts.length === 1 ? "" : "s"}` : ""}
            </a>
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(message).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2500);
                });
              }}
            >
              {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy text"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {place ? (alerts.data ? `${activeAlerts.length} active official alert${activeAlerts.length === 1 ? "" : "s"} for ${place.label}.` : "Checking official alerts…") : "Set your location to include nearby shelters and alerts."} Your location is not sent to ANVIL — only to the people you share with.
          </p>
        </section>
      </div>

      <section className="mt-4" aria-labelledby="sig-h">
        <h2 id="sig-h" className="mb-3 text-lg font-semibold">Signal rescuers</h2>
        <SignalTools />
        <p className="mt-3 text-xs text-muted-foreground">If you are trapped: stay where you are, conserve battery, and use three short whistle blasts or taps — the international distress signal.</p>
      </section>
    </>
  );
}