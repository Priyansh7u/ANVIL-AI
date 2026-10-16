import "server-only";
import mongoose, { Schema, type Model } from "mongoose";
import { randomUUID } from "node:crypto";

/**
 * Mongoose models. Conventions:
 *  - String UUID `_id`s so the in-memory fallback store and Mongo share IDs.
 *  - `expireAt` + TTL index implements the retention policy per collection.
 *  - No precise coordinates are stored anywhere except geocoded *public*
 *    shelter addresses. User data is keyed by an anonymous client id.
 *  - Simulated records live in their own collection and carry isSimulated: true.
 */

const DAY = 86_400_000;
const idField = { type: String, default: () => randomUUID() };
const ttl = (days: number) => ({ type: Date, default: () => new Date(Date.now() + days * DAY) });

function model<T>(name: string, schema: Schema): Model<T> {
  return (mongoose.models[name] as Model<T>) ?? mongoose.model<T>(name, schema);
}

const placeSchema = new Schema(
  { label: { type: String, maxlength: 200 }, district: { type: String, maxlength: 120 }, state: { type: String, maxlength: 120 } },
  { _id: false },
);

const evidenceSchema = new Schema(
  {
    sourceUrl: { type: String, required: true, maxlength: 2048 },
    evidenceQuote: { type: String, required: true, maxlength: 1000 },
    retrievedAt: { type: String, required: true },
    method: { type: String, required: true },
  },
  { _id: false },
);

// ── UserPreferences ─────────────────────────────────────────────────────────
const userPreferencesSchema = new Schema(
  {
    _id: idField,
    clientId: { type: String, required: true, unique: true, maxlength: 64 },
    place: placeSchema,
    language: { type: String, enum: ["en", "hi"], default: "en" },
    accessibility: {
      largeText: { type: Boolean, default: false },
      reducedMotion: { type: Boolean, default: false },
      highContrast: { type: Boolean, default: false },
    },
    notifications: {
      enabled: { type: Boolean, default: false },
      hazards: { type: [String], default: [] },
      minSeverity: { type: String, enum: ["Extreme", "Severe", "Moderate", "Minor", "Unknown"], default: "Moderate" },
    },
    expireAt: ttl(180),
  },
  { timestamps: true },
);
userPreferencesSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

// ── DisasterAlert (official alerts as retrieved) ─────────────────────────────
const disasterAlertSchema = new Schema(
  {
    _id: idField,
    alertId: { type: String, required: true, unique: true },
    source: { type: String, enum: ["SACHET_CAP"], required: true },
    issuer: String,
    headline: { type: String, required: true, maxlength: 2000 },
    event: String,
    hazard: { type: String, index: true },
    severity: { type: String, enum: ["Extreme", "Severe", "Moderate", "Minor", "Unknown"] },
    urgency: String,
    certainty: String,
    areaDesc: { type: String, maxlength: 4000 },
    instruction: { type: String, maxlength: 4000 },
    issuedAt: String,
    effectiveAt: String,
    expiresAt: String,
    capUrl: { type: String, required: true },
    partial: Boolean,
    dataMode: { type: String, enum: ["LIVE"], default: "LIVE" },
    firstRetrievedAt: String,
    lastRetrievedAt: String,
    expireAt: ttl(30),
  },
  { timestamps: true },
);
disasterAlertSchema.index({ issuedAt: -1 });
disasterAlertSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

// ── SourceRecord (every page the agent touched) ──────────────────────────────
const sourceRecordSchema = new Schema(
  {
    _id: idField,
    url: { type: String, required: true, unique: true, maxlength: 2048 },
    host: { type: String, index: true },
    title: String,
    official: Boolean,
    lastStatus: { type: String, enum: ["FETCHED", "FAILED", "SKIPPED"] },
    lastFetchedAt: String,
    injectionSuspected: { type: Boolean, default: false },
    newestYearMentioned: Number,
    via: String,
    expireAt: ttl(90),
  },
  { timestamps: true },
);
sourceRecordSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

// ── ResearchTask ─────────────────────────────────────────────────────────────
const researchTaskSchema = new Schema(
  {
    _id: idField,
    kind: { type: String, enum: ["AREA_BRIEFING", "HAZARD_INTEL"], default: "AREA_BRIEFING", index: true },
    place: placeSchema,
    status: { type: String, enum: ["PENDING", "RESEARCHING", "VALIDATING", "RUNNING", "COMPLETED", "PARTIAL", "FAILED", "CANCELLED"], index: true },
    events: [{ _id: false, at: String, state: String, stage: String, origin: String, message: String, url: String }],
    // HAZARD_INTEL fields
    hazard: { type: String, maxlength: 32 },
    stage: { type: String, maxlength: 32 },
    trigger: { type: String, enum: ["USER", "MONITOR"], default: "USER" },
    clientId: { type: String, maxlength: 64, index: true },
    monitorId: { type: String, maxlength: 64, index: true },
    cancelRequested: { type: Boolean, default: false },
    providerRuns: [{ _id: false, runId: String, status: String, startedAt: String }],
    counts: { type: Schema.Types.Mixed },
    report: { type: Schema.Types.Mixed },
    gaps: [String],
    sources: [{ _id: false, url: String, title: String, official: Boolean, status: String, fetchedAt: String, via: String, note: String }],
    flags: [{ _id: false, type: { type: String }, message: String, url: String }],
    result: {
      summary: String,
      summaryIsAiGenerated: Boolean,
      contacts: [{ _id: false, label: String, phone: String, evidence: evidenceSchema }],
      shelters: [{ _id: false, name: String, address: String, district: String, capacity: Number, accessibility: String, operationalStatus: String, evidence: evidenceSchema }],
      advisories: [{ _id: false, text: String, evidence: evidenceSchema }],
      roadClosures: [{ _id: false, road: String, status: String, evidence: evidenceSchema }],
    },
    capabilities: { ai: Boolean, agent: Boolean },
    error: String,
    startedAt: String,
    finishedAt: String,
    expireAt: ttl(30),
  },
  { timestamps: true },
);
researchTaskSchema.index({ "place.district": 1, "place.state": 1, createdAt: -1 });
researchTaskSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

// ── ResearchFinding (one evidence-linked finding of a HAZARD_INTEL task) ─────
const researchFindingSchema = new Schema(
  {
    _id: idField,
    taskId: { type: String, required: true, index: true },
    fingerprint: { type: String, required: true, maxlength: 16 },
    itemKey: { type: String, required: true, maxlength: 2100 },
    place: placeSchema,
    hazard: { type: String, maxlength: 32 },
    title: { type: String, required: true, maxlength: 400 },
    summary: { type: String, maxlength: 2000 },
    location: { type: String, maxlength: 300 },
    relevance: { type: String, enum: ["DISTRICT", "STATE", "NOT_LOCATION_SPECIFIC"] },
    sourceName: { type: String, maxlength: 200 },
    sourceUrl: { type: String, required: true, maxlength: 2048 },
    normalizedUrl: { type: String, maxlength: 2048, index: true },
    sourceCategory: { type: String, enum: ["OFFICIAL", "SECONDARY", "UNVERIFIED"], required: true },
    publishedAt: { type: String, default: null },
    publishedRaw: { type: String, maxlength: 80, default: null },
    publishedBasis: { type: String, enum: ["CAP_SENT", "PAGE_TEXT", "SEARCH_PROVIDER", null], default: null },
    retrievedAt: { type: String, required: true },
    evidenceQuote: { type: String, maxlength: 1000, default: null },
    evidenceVerified: { type: Boolean, default: false },
    freshness: { type: String, enum: ["FRESH", "RECENT", "POTENTIALLY_STALE", "TIMESTAMP_UNAVAILABLE"] },
    alertLevel: { type: String, enum: ["RED", "ORANGE", "YELLOW", "GREEN", null], default: null },
    withdrawal: Boolean,
    origin: { type: String, enum: ["SACHET_FEED", "TINYFISH_FETCH", "TINYFISH_AGENT"] },
    corroboratedBy: [{ _id: false, sourceName: String, sourceUrl: String, category: String }],
    conflictsWith: [String],
    instruction: { type: String, maxlength: 2000 },
    areaDesc: { type: String, maxlength: 1000 },
    expireAt: ttl(30),
  },
  { timestamps: true },
);
researchFindingSchema.index({ taskId: 1, fingerprint: 1 }, { unique: true });
researchFindingSchema.index({ "place.district": 1, "place.state": 1, hazard: 1, createdAt: -1 });
researchFindingSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

// ── ResearchSource (every source a HAZARD_INTEL task discovered or read) ─────
const researchSourceSchema = new Schema(
  {
    _id: idField,
    taskId: { type: String, required: true, index: true },
    url: { type: String, required: true, maxlength: 2048 },
    normalizedUrl: { type: String, required: true, maxlength: 2048 },
    host: { type: String, maxlength: 255 },
    title: { type: String, maxlength: 400 },
    sourceName: { type: String, maxlength: 200 },
    category: { type: String, enum: ["OFFICIAL", "SECONDARY", "UNVERIFIED"] },
    discoveredVia: { type: String, enum: ["SACHET_FEED", "TINYFISH_SEARCH", "TINYFISH_AGENT"] },
    providerDate: { type: String, default: null },
    status: { type: String, enum: ["DISCOVERED", "FETCHED", "FAILED", "SKIPPED"] },
    note: { type: String, maxlength: 400 },
    retrievedAt: String,
    publishedAt: { type: String, default: null },
    findingCount: { type: Number, default: 0 },
    injectionSuspected: { type: Boolean, default: false },
    expireAt: ttl(30),
  },
  { timestamps: true },
);
researchSourceSchema.index({ taskId: 1, normalizedUrl: 1 }, { unique: true });
researchSourceSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

// ── LocationMonitor (scheduled re-research of a place + hazard) ──────────────
const locationMonitorSchema = new Schema(
  {
    _id: idField,
    clientId: { type: String, required: true, index: true, maxlength: 64 },
    place: placeSchema,
    hazard: { type: String, required: true, maxlength: 32 },
    intervalMinutes: { type: Number, required: true, min: 15, max: 1440 },
    active: { type: Boolean, default: true, index: true },
    nextRunAt: { type: String, index: true },
    lastRunAt: String,
    lastSuccessAt: String,
    lastTaskId: String,
    lastStatus: String,
    lastError: { type: String, maxlength: 500 },
    consecutiveFailures: { type: Number, default: 0 },
    running: { type: Boolean, default: false },
    knownItems: { type: Schema.Types.Mixed, default: {} },
    changes: [{ _id: false, at: String, taskId: String, kind: { type: String, enum: ["NEW", "CHANGED"] }, title: String, sourceName: String, sourceUrl: String, category: String, publishedAt: String }],
    expireAt: ttl(30),
  },
  { timestamps: true, minimize: false },
);
locationMonitorSchema.index({ active: 1, nextRunAt: 1 });
locationMonitorSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

// ── Shelter (only source-documented entries) ─────────────────────────────────
const shelterSchema = new Schema(
  {
    _id: idField,
    name: { type: String, required: true, maxlength: 300 },
    address: { type: String, maxlength: 500 },
    district: { type: String, index: true },
    state: { type: String, index: true },
    sourceUrl: { type: String, required: true, maxlength: 2048 },
    capacity: Number,
    accessibility: String,
    operationalStatus: String,
    location: {
      lat: Number,
      lon: Number,
      precision: { type: String, enum: ["GEOCODED_ADDRESS", "NONE"], default: "NONE" },
    },
    verification: {
      status: { type: String, enum: ["SOURCE_DOCUMENTED"], required: true },
      evidence: { type: evidenceSchema, required: true },
      researchTaskId: String,
    },
    expireAt: ttl(30),
  },
  { timestamps: true },
);
shelterSchema.index({ name: 1, district: 1, sourceUrl: 1 }, { unique: true });
shelterSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

// ── SafetyPlan ───────────────────────────────────────────────────────────────
const safetyPlanSchema = new Schema(
  {
    _id: idField,
    clientId: { type: String, index: true, maxlength: 64 },
    place: placeSchema,
    language: { type: String, enum: ["en", "hi"] },
    household: { members: Number, children: Number, elderly: Number, mobilityNeeds: Boolean, medicalNeeds: Boolean, pets: Boolean },
    plan: { type: Schema.Types.Mixed },
    expireAt: ttl(90),
  },
  { timestamps: true },
);
safetyPlanSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

// ── Notification (history of browser notifications shown) ────────────────────
const notificationSchema = new Schema(
  {
    _id: idField,
    clientId: { type: String, required: true, index: true, maxlength: 64 },
    alertId: { type: String, required: true },
    title: { type: String, maxlength: 300 },
    severity: String,
    channel: { type: String, enum: ["browser"], default: "browser" },
    deliveredAt: String,
    expireAt: ttl(30),
  },
  { timestamps: true },
);
notificationSchema.index({ clientId: 1, alertId: 1 }, { unique: true });
notificationSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

// ── FamilyCheckIn (72 h retention, no location) ──────────────────────────────
const familyCheckInSchema = new Schema(
  {
    _id: idField,
    groupCode: { type: String, required: true, unique: true, maxlength: 16 },
    groupName: { type: String, maxlength: 60 },
    members: [
      {
        _id: false,
        memberId: String,
        tokenHash: String,
        displayName: { type: String, maxlength: 40 },
        status: { type: String, enum: ["SAFE", "NEED_ASSISTANCE", "NOT_CONFIRMED"] },
        note: { type: String, maxlength: 140 },
        consentAt: String,
        updatedAt: String,
      },
    ],
    expireAt: ttl(3),
  },
  { timestamps: true },
);
familyCheckInSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

// ── SimulationSession (synthetic data only) ──────────────────────────────────
const simulationSessionSchema = new Schema(
  {
    _id: idField,
    isSimulated: { type: Boolean, default: true, immutable: true, validate: (v: boolean) => v === true },
    scenarioId: String,
    inputs: { closedShelterIds: [String], demandMultiplier: Number },
    summary: { type: Schema.Types.Mixed },
    expireAt: ttl(7),
  },
  { timestamps: true },
);
simulationSessionSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export const Models = {
  get UserPreferences() { return model("UserPreferences", userPreferencesSchema); },
  get DisasterAlert() { return model("DisasterAlert", disasterAlertSchema); },
  get SourceRecord() { return model("SourceRecord", sourceRecordSchema); },
  get ResearchTask() { return model("ResearchTask", researchTaskSchema); },
  get Shelter() { return model("Shelter", shelterSchema); },
  get SafetyPlan() { return model("SafetyPlan", safetyPlanSchema); },
  get Notification() { return model("Notification", notificationSchema); },
  get FamilyCheckIn() { return model("FamilyCheckIn", familyCheckInSchema); },
  get SimulationSession() { return model("SimulationSession", simulationSessionSchema); },
  get ResearchFinding() { return model("ResearchFinding", researchFindingSchema); },
  get ResearchSource() { return model("ResearchSource", researchSourceSchema); },
  get LocationMonitor() { return model("LocationMonitor", locationMonitorSchema); },
};

export type ModelName = keyof typeof Models;