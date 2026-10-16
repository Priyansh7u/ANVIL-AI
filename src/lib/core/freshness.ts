import type { AlertFreshness, DataMode } from "./types";

/** Alerts without an explicit expiry are treated as stale after this many hours. */
export const DEFAULT_ALERT_MAX_AGE_HOURS = 24;
/** A feed whose own pubDate is older than this is flagged as stale. */
export const FEED_STALE_AFTER_HOURS = 6;

const HOUR = 3_600_000;

export function assessAlertFreshness(args: {
  issuedAt: string | null;
  expiresAt: string | null;
  now?: Date;
  maxAgeHours?: number;
}): AlertFreshness {
  const now = (args.now ?? new Date()).getTime();
  const maxAge = (args.maxAgeHours ?? DEFAULT_ALERT_MAX_AGE_HOURS) * HOUR;
  const expires = args.expiresAt ? Date.parse(args.expiresAt) : NaN;
  const issued = args.issuedAt ? Date.parse(args.issuedAt) : NaN;

  if (!Number.isNaN(expires)) {
    return expires < now ? "EXPIRED" : "ACTIVE";
  }
  if (Number.isNaN(issued)) return "UNKNOWN";
  if (issued > now + 10 * 60_000) return "UNKNOWN"; // clock skew / bad data — don't trust
  return now - issued > maxAge ? "STALE" : "ACTIVE";
}

export function assessFeedMode(args: {
  feedPublishedAt: string | null;
  fetchedLive: boolean;
  now?: Date;
}): DataMode {
  if (!args.fetchedLive) return args.feedPublishedAt ? "CACHED" : "UNAVAILABLE";
  if (!args.feedPublishedAt) return "LIVE";
  const age = (args.now ?? new Date()).getTime() - Date.parse(args.feedPublishedAt);
  return age > FEED_STALE_AFTER_HOURS * HOUR ? "STALE" : "LIVE";
}

/** Human "x min ago" without Intl dependency surprises on old phones. */
export function relativeTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "unknown time";
  const diff = now.getTime() - Date.parse(iso);
  if (Number.isNaN(diff)) return "unknown time";
  const future = diff < 0;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60_000);
  let text: string;
  if (mins < 1) text = "just now";
  else if (mins < 60) text = `${mins} min`;
  else if (mins < 48 * 60) text = `${Math.round(mins / 60)} h`;
  else text = `${Math.round(mins / 1440)} d`;
  if (text === "just now") return text;
  return future ? `in ${text}` : `${text} ago`;
}
