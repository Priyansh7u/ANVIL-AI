import "server-only";
import { z } from "zod";

/**
 * Server-only configuration. Every value is optional so the app can boot for a
 * demo; features that need a missing value report themselves as unavailable
 * instead of failing silently or pretending to work.
 */
const schema = z.object({
  MONGODB_URI: z.string().trim().optional(),
  TINYFISH_API_KEY: z.string().trim().optional(),
  TINYFISH_AGENT_ENABLED: z.string().optional(),
  AI_API_KEY: z.string().trim().optional(),
  AI_MODEL: z.string().trim().optional(),
  AI_PROVIDER: z.string().trim().optional(),
  AI_BASE_URL: z.string().trim().optional(),
  NEXT_PUBLIC_APP_URL: z.string().trim().optional(),
  GEOCODER_CONTACT: z.string().trim().optional(),
  MAP_TILE_URL: z.string().trim().optional(),
  MAP_TILE_ATTRIBUTION: z.string().trim().optional(),
  ROUTING_BASE_URL: z.string().trim().optional(),
  ADMIN_TOKEN: z.string().trim().optional(),
  CRON_SECRET: z.string().trim().optional(),
  OVERPASS_URL: z.string().trim().optional(),
});

const parsed = schema.parse(process.env);
const blank = (v: string | undefined) => (v && v.length > 0 ? v : undefined);

export const env = {
  mongodbUri: blank(parsed.MONGODB_URI),
  tinyfishApiKey: blank(parsed.TINYFISH_API_KEY),
  tinyfishAgentEnabled: parsed.TINYFISH_AGENT_ENABLED === "true",
  aiApiKey: blank(parsed.AI_API_KEY),
  aiProvider: (parsed.AI_PROVIDER?.toLowerCase() === "openai-compatible" ? "openai-compatible" : "anthropic") as
    | "anthropic"
    | "openai-compatible",
  aiModel: blank(parsed.AI_MODEL) ?? "claude-haiku-5-5",
  /** For AI_PROVIDER=openai-compatible: e.g. https://api.openai.com/v1 */
  aiBaseUrl: blank(parsed.AI_BASE_URL),
  appUrl: blank(parsed.NEXT_PUBLIC_APP_URL) ?? "http://localhost:3000",
  geocoderContact: blank(parsed.GEOCODER_CONTACT),
  mapTileUrl: blank(parsed.MAP_TILE_URL) ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  mapTileAttribution: blank(parsed.MAP_TILE_ATTRIBUTION) ?? "© OpenStreetMap contributors",
  routingBaseUrl: blank(parsed.ROUTING_BASE_URL) ?? "https://router.project-osrm.org",
  adminToken: blank(parsed.ADMIN_TOKEN),
  /** Bearer secret the scheduler (e.g. Vercel Cron) sends to /api/cron/monitor. */
  cronSecret: blank(parsed.CRON_SECRET),
  overpassUrl: blank(parsed.OVERPASS_URL) ?? "https://overpass-api.de/api/interpreter",
} as const;

/** Booleans only — safe to send to the client. Never expose the values themselves. */
export function capabilityFlags() {
  return {
    database: Boolean(env.mongodbUri),
    tinyfish: Boolean(env.tinyfishApiKey),
    tinyfishAgent: Boolean(env.tinyfishApiKey) && env.tinyfishAgentEnabled,
    ai: Boolean(env.aiApiKey) && (env.aiProvider === "anthropic" || Boolean(env.aiBaseUrl)),
    webPush: false,
    scheduler: Boolean(blank(parsed.CRON_SECRET)),
  };
}

export const USER_AGENT = `ANVIL-AI/0.1 (disaster-intelligence hackathon app${env.geocoderContact ? `; ${env.geocoderContact}` : ""})`;