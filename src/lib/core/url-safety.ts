/**
 * URL safety and source-trust helpers.
 *
 * ANVIL's own server only ever requests fixed, allow-listed hosts (SACHET,
 * Nominatim, OSRM, TinyFish, the AI provider). URLs discovered on the web
 * (search results, agent output) are forwarded to TinyFish — never fetched by
 * our server — but are still validated so we never pass internal or
 * credential-bearing URLs anywhere.
 */

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /\.lan$/i,
  /^metadata\.google\.internal$/i,
];

export function isIpLiteral(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (host.startsWith("[") || host.includes(":")) return true; // IPv6
  if (/^0x[0-9a-f]+$/i.test(host) || /^\d+$/.test(host)) return true; // integer / hex encodings
  return false;
}

export interface UrlCheck {
  ok: boolean;
  reason?: string;
  url?: URL;
}

export function checkPublicHttpsUrl(raw: string): UrlCheck {
  if (typeof raw !== "string" || raw.length > 2048) return { ok: false, reason: "invalid length" };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "unparseable URL" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "only https is allowed" };
  if (url.username || url.password) return { ok: false, reason: "credentials in URL are not allowed" };
  if (url.port && url.port !== "443") return { ok: false, reason: "non-standard port" };
  const host = url.hostname.toLowerCase();
  if (isIpLiteral(host)) return { ok: false, reason: "IP literal hosts are not allowed" };
  if (!host.includes(".")) return { ok: false, reason: "single-label host" };
  if (PRIVATE_HOST_PATTERNS.some((re) => re.test(host))) return { ok: false, reason: "private host" };
  return { ok: true, url };
}

/** Government of India domains we treat as official sources. */
const OFFICIAL_SUFFIXES = [".gov.in", ".nic.in"];
const OFFICIAL_EXACT = new Set(["gov.in", "nic.in"]);

export function isOfficialIndianDomain(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (OFFICIAL_EXACT.has(h)) return true;
  return OFFICIAL_SUFFIXES.some((s) => h.endsWith(s));
}

export function isOfficialUrl(raw: string): boolean {
  const c = checkPublicHttpsUrl(raw);
  return c.ok && !!c.url && isOfficialIndianDomain(c.url.hostname);
}

/** Strip tracking params and fragments so the same page dedupes. */
export function canonicalizeUrl(raw: string): string {
  const c = checkPublicHttpsUrl(raw);
  if (!c.ok || !c.url) return raw;
  const u = c.url;
  u.hash = "";
  for (const k of Array.from(u.searchParams.keys())) {
    if (/^(utm_|fbclid|gclid)/i.test(k)) u.searchParams.delete(k);
  }
  return u.toString();
}
