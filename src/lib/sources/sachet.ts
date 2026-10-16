import "server-only";
import { dedupeAlerts, normalizeAlert, parseCap, parseRss, type CapDocument, type RssFeed } from "../core/cap";
import { mapWithConcurrency, TtlCache } from "../core/concurrency";
import { assessFeedMode } from "../core/freshness";
import { matchAlertToPlace } from "../core/location-match";
import { SACHET_RSS_URL } from "../core/source-registry";
import { checkPublicHttpsUrl } from "../core/url-safety";
import { parsePolygonXml, type Polygon } from "../core/geometry";
import type { DataMode, NormalizedAlert, Place } from "../core/types";
import { fetchWithTimeout, readTextCapped } from "../http";
import { upsert } from "../repo";

/**
 * Official alert ingestion from NDMA SACHET.
 * 1. Fetch the all-India RSS index (cached 3 min; last good copy kept for outages).
 * 2. Fetch CAP XML for recent items with bounded concurrency (CAP docs are immutable → cached).
 * 3. Normalize, dedupe, assess freshness, match to the user's place.
 */

const FEED_TTL_MS = 3 * 60_000;
const RECENT_WINDOW_MS = 48 * 3_600_000;
const MAX_CAP_FETCHES = 60;
const CAP_CONCURRENCY = 6;

const feedCache = new TtlCache<{ feed: RssFeed; fetchedAt: string }>(FEED_TTL_MS, 4);
const capCache = new TtlCache<CapDocument | null>(7 * 24 * 3_600_000, 3_000);
const polygonCache = new TtlCache<Polygon[]>(7 * 24 * 3_600_000, 2_000);
const MAX_POLYGON_FETCHES = 15;

function isSachetUrl(raw: string): boolean {
  const c = checkPublicHttpsUrl(raw);
  return c.ok && c.url?.hostname === "sachet.ndma.gov.in";
}

async function loadFeed(): Promise<{ feed: RssFeed | null; fetchedAt: string | null; live: boolean; error: string | null }> {
  const cached = feedCache.get("india");
  if (cached?.fresh) return { feed: cached.value.feed, fetchedAt: cached.value.fetchedAt, live: true, error: null };
  try {
    const res = await fetchWithTimeout(SACHET_RSS_URL, { timeoutMs: 12_000, headers: { Accept: "application/rss+xml, application/xml" } });
    if (!res.ok) throw new Error(`SACHET HTTP ${res.status}`);
    const feed = parseRss(await readTextCapped(res, 5_000_000));
    if (feed.items.length === 0) throw new Error("SACHET feed parsed with zero items");
    const fetchedAt = new Date().toISOString();
    feedCache.set("india", { feed, fetchedAt });
    return { feed, fetchedAt, live: true, error: null };
  } catch (err) {
    // Serve the last good copy, explicitly marked as not live.
    if (cached) return { feed: cached.value.feed, fetchedAt: cached.value.fetchedAt, live: false, error: (err as Error).message };
    return { feed: null, fetchedAt: null, live: false, error: (err as Error).message };
  }
}

async function loadCap(url: string): Promise<CapDocument | null> {
  const hit = capCache.get(url);
  if (hit) return hit.value;
  if (!isSachetUrl(url)) return null; // never follow links off the official host
  const res = await fetchWithTimeout(url, { timeoutMs: 8_000 });
  if (!res.ok) throw new Error(`CAP HTTP ${res.status}`);
  const doc = parseCap(await readTextCapped(res, 500_000));
  capCache.set(url, doc);
  return doc;
}

export interface AlertsResult {
  dataMode: DataMode;
  feedPublishedAt: string | null;
  retrievedAt: string | null;
  sourceUrl: string;
  error: string | null;
  capFailures: number;
  alerts: NormalizedAlert[];
}

/**
 * Official alert-area polygons. SACHET CAP documents carry a "Polygon URL"
 * parameter (FetchPolygonXMLFile?identifier=…). We fetch it for the given
 * alerts only, parse defensively (CAP or KML coordinate layouts), and attach
 * nothing when the document cannot be read — never a guessed shape.
 */
export async function attachPolygons(alerts: NormalizedAlert[]): Promise<NormalizedAlert[]> {
  const targets = alerts.slice(0, MAX_POLYGON_FETCHES);
  const results = await mapWithConcurrency(targets, 4, async (a) => {
    const id = new URL(a.capUrl).searchParams.get("identifier");
    if (!id || !/^[\w-]{4,64}$/.test(id)) return [] as Polygon[];
    const url = `https://sachet.ndma.gov.in/cap_public_website/FetchPolygonXMLFile?identifier=${encodeURIComponent(id)}`;
    const hit = polygonCache.get(url);
    if (hit) return hit.value;
    const res = await fetchWithTimeout(url, { timeoutMs: 8_000 });
    if (!res.ok) throw new Error(`Polygon HTTP ${res.status}`);
    const polys = parsePolygonXml(await readTextCapped(res, 4_000_000));
    polygonCache.set(url, polys);
    return polys;
  });
  return alerts.map((a, i) => {
    const r = results[i];
    return r && r.ok && r.value.length ? { ...a, polygons: r.value } : a;
  });
}

export async function getAlerts(place: Pick<Place, "district" | "state"> | null, scope: "local" | "all"): Promise<AlertsResult> {
  const { feed, fetchedAt, live, error } = await loadFeed();
  const base = { sourceUrl: SACHET_RSS_URL, retrievedAt: fetchedAt, error };
  if (!feed || !fetchedAt) {
    return { ...base, dataMode: "UNAVAILABLE", feedPublishedAt: null, capFailures: 0, alerts: [] };
  }
  const now = new Date();
  const recent = feed.items.filter((i) => !i.pubDate || now.getTime() - Date.parse(i.pubDate) <= RECENT_WINDOW_MS);
  const toEnrich = recent.slice(0, MAX_CAP_FETCHES);
  const caps = await mapWithConcurrency(toEnrich, CAP_CONCURRENCY, (item) => loadCap(item.link));
  let capFailures = 0;

  const normalized = toEnrich.map((item, i) => {
    const r = caps[i];
    const cap = r && r.ok ? r.value : null;
    if (!r || !r.ok) capFailures++;
    return normalizeAlert(item, cap, fetchedAt, now);
  });
  // Items beyond the enrichment budget are kept as RSS-only (partial) entries.
  for (const item of recent.slice(MAX_CAP_FETCHES)) normalized.push(normalizeAlert(item, null, fetchedAt, now));

  const withRelevance: NormalizedAlert[] = dedupeAlerts(normalized).map((a) => ({
    ...a,
    relevance: place ? matchAlertToPlace(a, place) : "NONE",
  }));

  const alerts = scope === "local" && place ? withRelevance.filter((a) => a.relevance !== "NONE") : withRelevance;
  alerts.sort((a, b) => Date.parse(b.issuedAt ?? "0") - Date.parse(a.issuedAt ?? "0"));

  // Best-effort persistence of official alerts (no user data involved).
  void persistAlerts(alerts.slice(0, 50));

  return {
    ...base,
    dataMode: assessFeedMode({ feedPublishedAt: feed.publishedAt, fetchedLive: live, now }),
    feedPublishedAt: feed.publishedAt,
    capFailures,
    alerts,
  };
}

async function persistAlerts(alerts: NormalizedAlert[]) {
  try {
    for (const a of alerts) {
      await upsert("DisasterAlert", { alertId: a.id }, {
        source: a.source,
        issuer: a.issuer,
        headline: a.headline,
        event: a.event,
        hazard: a.hazard,
        severity: a.severity,
        urgency: a.urgency,
        certainty: a.certainty,
        areaDesc: a.areaDesc,
        instruction: a.instruction,
        issuedAt: a.issuedAt,
        effectiveAt: a.effectiveAt,
        expiresAt: a.expiresAt,
        capUrl: a.capUrl,
        partial: a.partial,
        lastRetrievedAt: a.retrievedAt,
      });
    }
  } catch {
    // Storage is not on the critical path for showing official alerts.
  }
}

export async function probeSachet(): Promise<{ ok: boolean; feedPublishedAt: string | null; items: number; error: string | null; ms: number }> {
  const t0 = Date.now();
  const r = await loadFeed();
  return { ok: Boolean(r.feed) && r.live, feedPublishedAt: r.feed?.publishedAt ?? null, items: r.feed?.items.length ?? 0, error: r.error, ms: Date.now() - t0 };
}