import { z } from "zod";

/** Shared Zod schemas for every API boundary (inputs) and every external payload (outputs). */

const name = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[\p{L}\p{M}\p{N} .,'&()-]+$/u, "contains unsupported characters");

export const lat = z.coerce.number().min(-90).max(90);
export const lon = z.coerce.number().min(-180).max(180);
export const clientId = z.string().uuid();

export const placeSchema = z.object({
  label: z.string().trim().min(2).max(200),
  district: name.nullable(),
  state: name.nullable(),
});
export type PlaceInput = z.infer<typeof placeSchema>;

export const alertsQuerySchema = z.object({
  district: name.optional(),
  state: name.optional(),
  scope: z.enum(["local", "all"]).default("local"),
});

export const reverseGeoQuerySchema = z.object({ lat, lon });
export const geoSearchQuerySchema = z.object({ q: z.string().trim().min(2).max(120) });

export const researchCreateSchema = z.object({
  place: placeSchema.refine((p) => p.district || p.state, "district or state is required"),
  kind: z.literal("AREA_BRIEFING").default("AREA_BRIEFING"),
});

export const householdSchema = z.object({
  members: z.number().int().min(1).max(30).default(1),
  children: z.number().int().min(0).max(20).default(0),
  elderly: z.number().int().min(0).max(20).default(0),
  mobilityNeeds: z.boolean().default(false),
  medicalNeeds: z.boolean().default(false),
  pets: z.boolean().default(false),
});

export const planCreateSchema = z.object({
  clientId: clientId.optional(),
  place: placeSchema,
  language: z.enum(["en", "hi"]).default("en"),
  household: householdSchema,
});

export const routeQuerySchema = z.object({
  fromLat: lat,
  fromLon: lon,
  toLat: lat,
  toLon: lon,
  district: name.optional(),
  state: name.optional(),
});

export const sheltersQuerySchema = z.object({
  district: name.optional(),
  state: name.optional(),
});

export const preferencesSchema = z.object({
  clientId,
  place: placeSchema.nullable().optional(),
  language: z.enum(["en", "hi"]).optional(),
  accessibility: z
    .object({ largeText: z.boolean(), reducedMotion: z.boolean(), highContrast: z.boolean() })
    .partial()
    .optional(),
  notifications: z
    .object({
      enabled: z.boolean(),
      hazards: z.array(z.string().max(30)).max(20),
      minSeverity: z.enum(["Extreme", "Severe", "Moderate", "Minor", "Unknown"]),
    })
    .partial()
    .optional(),
});

export const notificationLogSchema = z.object({
  clientId,
  alertId: z.string().min(1).max(200),
  title: z.string().max(300),
  severity: z.string().max(20).optional(),
});

export const familyCreateSchema = z.object({ groupName: z.string().trim().min(2).max(60) });
export const familyCodeSchema = z.string().regex(/^[A-HJ-NP-Z2-9]{8}$/, "invalid group code");
export const familyStatusSchema = z.object({
  displayName: z.string().trim().min(1).max(40),
  status: z.enum(["SAFE", "NEED_ASSISTANCE", "NOT_CONFIRMED"]),
  note: z.string().trim().max(140).optional().default(""),
  consent: z.literal(true, { message: "Explicit consent is required to share your status" }),
  memberToken: z.string().min(20).max(100).optional(),
});
export const familyLeaveSchema = z.object({ memberToken: z.string().min(20).max(100) });

export const simulatorSchema = z.object({
  scenarioId: z.literal("riverbend-flood-v1"),
  closedShelterIds: z.array(z.string().max(10)).max(10).default([]),
  demandMultiplier: z.number().min(0.5).max(3).default(1),
});

// ── External payload validation ──────────────────────────────────────────────

export const tinyfishSearchResponse = z.object({
  query: z.string().optional(),
  results: z
    .array(
      z.object({
        position: z.number().optional(),
        site_name: z.string().nullish(),
        title: z.string().nullish(),
        snippet: z.string().nullish(),
        url: z.string(),
        date: z.string().nullish(),
        publisher: z.string().nullish(),
      }),
    )
    .default([]),
});

export const tinyfishFetchResponse = z.object({
  results: z
    .array(
      z.object({
        url: z.string(),
        final_url: z.string().nullish(),
        title: z.string().nullish(),
        description: z.string().nullish(),
        language: z.string().nullish(),
        format: z.string().nullish(),
        text: z.union([z.string(), z.record(z.string(), z.unknown())]).nullish(),
      }),
    )
    .default([]),
  errors: z.array(z.object({ url: z.string().optional(), error: z.unknown().optional() }).passthrough()).default([]),
});

export const tinyfishSseEvent = z.object({
  type: z.enum(["STARTED", "STREAMING_URL", "PROGRESS", "HEARTBEAT", "COMPLETE"]),
  run_id: z.string().optional(),
  purpose: z.string().optional(),
  status: z.string().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
  timestamp: z.string().optional(),
});

const quote = z.string().trim().min(12).max(600);

/** Shape the AI must return for each official page. Every item needs a verbatim quote. */
export const pageExtractionSchema = z.object({
  shelters: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(200),
        address: z.string().trim().max(400).nullish(),
        capacity: z.number().int().positive().max(1_000_000).nullish(),
        accessibility: z.string().trim().max(200).nullish(),
        operationalStatus: z.string().trim().max(120).nullish(),
        evidenceQuote: quote,
      }),
    )
    .max(40)
    .default([]),
  contacts: z
    .array(z.object({ label: z.string().trim().min(2).max(120), phone: z.string().trim().min(3).max(30), evidenceQuote: quote }))
    .max(40)
    .default([]),
  advisories: z.array(z.object({ text: z.string().trim().min(10).max(400), evidenceQuote: quote })).max(20).default([]),
  roadClosures: z
    .array(z.object({ road: z.string().trim().min(3).max(160), status: z.string().trim().min(3).max(60), evidenceQuote: quote }))
    .max(20)
    .default([]),
});
export type PageExtraction = z.infer<typeof pageExtractionSchema>;

/** Agent output schema (TinyFish structured output subset). */
export const AGENT_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    shelters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          address: { type: "string" },
          source_url: { type: "string" },
          exact_text: { type: "string" },
        },
        required: ["name", "source_url", "exact_text"],
      },
    },
    contacts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          phone: { type: "string" },
          source_url: { type: "string" },
          exact_text: { type: "string" },
        },
        required: ["label", "phone", "source_url", "exact_text"],
      },
    },
  },
  required: ["shelters", "contacts"],
} as const;

export const agentResultSchema = z.object({
  shelters: z.array(z.object({ name: z.string(), address: z.string().nullish(), source_url: z.string(), exact_text: z.string() })).max(40).default([]),
  contacts: z.array(z.object({ label: z.string(), phone: z.string(), source_url: z.string(), exact_text: z.string() })).max(40).default([]),
});

export const aiChecklistSchema = z.object({
  items: z.array(z.object({ text: z.string().trim().min(5).max(300), reason: z.string().trim().max(200).nullish() })).min(3).max(15),
});

// ── Live hazard research agent ──────────────────────────────────────────────

export const RESEARCH_HAZARDS = ["all", "flood", "heavy_rain", "cyclone", "heatwave", "earthquake", "landslide", "thunderstorm", "cold_wave", "tsunami"] as const;
export const researchHazard = z.enum(RESEARCH_HAZARDS);

export const liveResearchCreateSchema = z.object({
  place: placeSchema.refine((p) => p.district || p.state, "district or state is required"),
  hazard: researchHazard.default("all"),
  clientId: clientId.optional(),
});

export const liveResearchListSchema = z.object({
  clientId: clientId.optional(),
  district: z.string().trim().max(120).optional(),
  state: z.string().trim().max(120).optional(),
  hazard: researchHazard.optional(),
});

export const monitorCreateSchema = z.object({
  clientId,
  place: placeSchema.refine((p) => p.district || p.state, "district or state is required"),
  hazard: researchHazard.default("all"),
  intervalMinutes: z.number().int().min(15).max(1440).default(60),
});

export const monitorUpdateSchema = z.object({
  clientId,
  active: z.boolean().optional(),
  intervalMinutes: z.number().int().min(15).max(1440).optional(),
});

export const clientOnlySchema = z.object({ clientId });

/** AI extraction of hazard findings from ONE page. Every item must carry a verbatim quote. */
export const hazardFindingExtractionSchema = z.object({
  findings: z
    .array(
      z.object({
        title: z.string().trim().min(5).max(200),
        summary: z.string().trim().min(10).max(600),
        affectedArea: z.string().trim().max(200).nullish(),
        dateText: z.string().trim().max(60).nullish(),
        instruction: z.string().trim().max(400).nullish(),
        evidenceQuote: z.string().trim().min(12).max(400),
      }),
    )
    .max(8)
    .default([]),
});

export const groundedSummarySchema = z.object({ summary: z.string().trim().min(20).max(1200) });

export const nearbyQuerySchema = z.object({
  lat,
  lon,
  radiusKm: z.coerce.number().min(1).max(25).default(8),
  kinds: z
    .string()
    .max(200)
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.enum(["hospital", "clinic", "assembly_point", "shelter", "fire_station", "police"])).max(6).optional()),
  district: z.string().trim().max(120).optional(),
  state: z.string().trim().max(120).optional(),
});