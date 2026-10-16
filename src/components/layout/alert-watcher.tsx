"use client";

import { useEffect } from "react";
import { matchWatchArea, type WatchArea } from "@/lib/core/geofence";
import { apiFetch, placeQuery } from "@/hooks/use-api";
import { getOrCreateClientId, usePlace, usePrefs } from "@/hooks/use-local-state";
import { useWatchAreas } from "@/hooks/use-watch-areas";
import type { HazardDto, HazardMapResponse } from "@/types/api";

const SEEN_KEY = "anvil.seenAlerts.v1";
const POLL_MS = 5 * 60_000;

/**
 * Smart geofenced alerts (foreground). While ANVIL is open and the user has
 * opted in, every 5 minutes it fetches live hazard areas for each watch area
 * (or the selected place if none are set), matches them against the geofence
 * and shows a browser notification for each NEW matching official alert:
 * severity, source, time and the official instruction.
 * Limitations (shown in the UI): no delivery when the tab is closed, offline,
 * or when notification permission is denied.
 */
export function AlertWatcher() {
  const [place] = usePlace();
  const [prefs] = usePrefs();
  const { areas } = useWatchAreas();

  useEffect(() => {
    if (!prefs.notifications) return;
    if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") return;
    const watch: WatchArea[] = areas.length
      ? areas
      : place
        ? [{ id: "current", label: place.label, district: place.district, state: place.state, minSeverity: prefs.minSeverity, includeStateLevel: true }]
        : [];
    if (!watch.length) return;
    let cancelled = false;

    const check = async () => {
      let seen: string[] = [];
      try {
        seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as string[];
      } catch {
        seen = [];
      }
      const clientId = getOrCreateClientId();
      const newlySeen: string[] = [];
      for (const area of watch) {
        if (cancelled) return;
        try {
          const data = await apiFetch<HazardMapResponse>(`/api/hazard-map?${placeQuery(area)}`);
          const matches = matchWatchArea<HazardDto>(area, data.hazards);
          for (const { hazard: h, reason } of matches) {
            const key = `${area.id}:${h.id}`;
            if (seen.includes(key) || newlySeen.includes(key)) continue;
            newlySeen.push(key);
            const when = h.issuedAt ? new Date(h.issuedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) : "";
            const body = [
              `${h.severity === "Unknown" ? "Severity not stated" : h.severity} · ${h.issuer}${when ? ` · ${when} IST` : ""}`,
              h.headline.slice(0, 140),
              h.instruction ? `Official guidance: ${h.instruction.slice(0, 120)}` : "",
              reason === "INSIDE_ALERT_AREA" ? "Your watch area is inside the official alert area." : "",
            ]
              .filter(Boolean)
              .join("\n");
            const n = new Notification(`ANVIL · ${area.label}`, { body, tag: key });
            n.onclick = () => {
              window.focus();
              window.location.href = "/watch";
            };
            if (clientId) {
              void apiFetch("/api/notifications", {
                method: "POST",
                body: JSON.stringify({ clientId, alertId: key.slice(0, 200), title: `${area.label}: ${h.headline}`.slice(0, 300), severity: h.severity }),
              }).catch(() => undefined);
            }
          }
        } catch {
          /* offline or feed down: try again next interval */
        }
      }
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify([...newlySeen, ...seen].slice(0, 800)));
      } catch {
        /* ignore */
      }
    };

    void check();
    const t = setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [place, prefs.notifications, prefs.minSeverity, areas]);

  return null;
}