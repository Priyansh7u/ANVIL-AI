import "server-only";
import { randomUUID } from "node:crypto";
import type { Model } from "mongoose";
import { Models, type ModelName } from "@/models";
import { connectToDatabase, isDatabaseConfigured } from "./mongodb";

/**
 * Tiny repository abstraction. With MONGODB_URI set, data goes to MongoDB
 * Atlas through Mongoose (validation, indexes, TTL retention). Without it, an
 * in-memory store is used and every API response reports `storage:
 * "EPHEMERAL"` so the UI can say so — nothing pretends to be persisted.
 */

export type StorageMode = "MONGODB" | "EPHEMERAL";
export type Doc = { _id: string } & Record<string, unknown>;
type Filter = Record<string, unknown>;

export function storageMode(): StorageMode {
  return isDatabaseConfigured() ? "MONGODB" : "EPHEMERAL";
}

function M(name: ModelName): Model<Record<string, unknown>> {
  return Models[name] as unknown as Model<Record<string, unknown>>;
}

// ── in-memory fallback ──────────────────────────────────────────────────────
const g = globalThis as unknown as { __anvilMem?: Map<ModelName, Map<string, Doc>> };
const mem = g.__anvilMem ?? new Map<ModelName, Map<string, Doc>>();
g.__anvilMem = mem;
const MEM_LIMIT = 2_000;

function table(name: ModelName): Map<string, Doc> {
  let t = mem.get(name);
  if (!t) {
    t = new Map();
    mem.set(name, t);
  }
  return t;
}

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function matches(doc: Doc, filter: Filter): boolean {
  return Object.entries(filter).every(([k, v]) => getPath(doc, k) === v);
}

/** Apply a Mongo-style $set (dotted keys allowed) to a plain object. */
function applySet(target: Record<string, unknown>, set: Record<string, unknown>): Record<string, unknown> {
  const out = clone(target);
  for (const [path, value] of Object.entries(set)) {
    const keys = path.split(".");
    let cur: Record<string, unknown> = out;
    keys.slice(0, -1).forEach((k) => {
      if (!cur[k] || typeof cur[k] !== "object") cur[k] = {};
      cur = cur[k] as Record<string, unknown>;
    });
    cur[keys[keys.length - 1] as string] = clone(value);
  }
  return out;
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

function sweepExpired(t: Map<string, Doc>) {
  const now = Date.now();
  for (const [id, d] of t) {
    const exp = d.expireAt instanceof Date ? d.expireAt.getTime() : typeof d.expireAt === "string" ? Date.parse(d.expireAt) : NaN;
    if (!Number.isNaN(exp) && exp < now) t.delete(id);
  }
  while (t.size > MEM_LIMIT) {
    const first = t.keys().next().value;
    if (first === undefined) break;
    t.delete(first);
  }
}

function lean(d: unknown): Doc {
  return JSON.parse(JSON.stringify(d)) as Doc;
}

// ── public API ──────────────────────────────────────────────────────────────
export async function create(name: ModelName, data: Record<string, unknown>): Promise<Doc> {
  const conn = await connectToDatabase();
  if (conn) {
    const created = await M(name).create(data);
    return lean(created.toObject());
  }
  const t = table(name);
  sweepExpired(t);
  const doc = applySet({ _id: randomUUID(), createdAt: new Date().toISOString() }, data) as Doc;
  doc.updatedAt = doc.createdAt;
  t.set(doc._id, doc);
  return clone(doc);
}

export async function findById(name: ModelName, id: string): Promise<Doc | null> {
  const conn = await connectToDatabase();
  if (conn) {
    const d = await M(name).findById(id).lean();
    return d ? lean(d) : null;
  }
  const d = table(name).get(id);
  return d ? clone(d) : null;
}

export async function findOne(name: ModelName, filter: Filter): Promise<Doc | null> {
  const [d] = await find(name, filter, { limit: 1 });
  return d ?? null;
}

export async function find(
  name: ModelName,
  filter: Filter,
  opts: { sortDesc?: string; limit?: number } = {},
): Promise<Doc[]> {
  const limit = Math.min(opts.limit ?? 50, 500);
  const conn = await connectToDatabase();
  if (conn) {
    let q = M(name).find(filter);
    if (opts.sortDesc) q = q.sort({ [opts.sortDesc]: -1 });
    const rows = await q.limit(limit).lean();
    return rows.map(lean);
  }
  const t = table(name);
  sweepExpired(t);
  let rows = Array.from(t.values()).filter((d) => matches(d, filter));
  if (opts.sortDesc) {
    const k = opts.sortDesc;
    rows = rows.sort((a, b) => String(getPath(b, k) ?? "").localeCompare(String(getPath(a, k) ?? "")));
  }
  return rows.slice(0, limit).map(clone);
}

export async function updateById(name: ModelName, id: string, set: Record<string, unknown>): Promise<Doc | null> {
  const conn = await connectToDatabase();
  if (conn) {
    const d = await M(name).findByIdAndUpdate(id, { $set: set }, { new: true, runValidators: true }).lean();
    return d ? lean(d) : null;
  }
  const t = table(name);
  const d = t.get(id);
  if (!d) return null;
  const next = applySet(d, { ...set, updatedAt: new Date().toISOString() }) as Doc;
  t.set(id, next);
  return clone(next);
}

/** Upsert on an equality filter (filter fields are merged into the new doc). */
export async function upsert(name: ModelName, filter: Filter, set: Record<string, unknown>): Promise<Doc> {
  const conn = await connectToDatabase();
  if (conn) {
    const d = await M(name)
      .findOneAndUpdate(filter, { $set: set }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true })
      .lean();
    return lean(d);
  }
  const existing = (await find(name, filter, { limit: 1 }))[0];
  if (existing) return (await updateById(name, existing._id, set)) as Doc;
  const flatFilter = Object.fromEntries(Object.entries(filter).filter(([k]) => !k.includes(".")));
  return create(name, { ...flatFilter, ...set });
}

export async function deleteById(name: ModelName, id: string): Promise<boolean> {
  const conn = await connectToDatabase();
  if (conn) {
    const r = await M(name).deleteOne({ _id: id });
    return r.deletedCount > 0;
  }
  return table(name).delete(id);
}

export async function deleteMany(name: ModelName, filter: Filter): Promise<number> {
  const conn = await connectToDatabase();
  if (conn) {
    const r = await M(name).deleteMany(filter);
    return r.deletedCount;
  }
  const t = table(name);
  let n = 0;
  for (const [id, d] of t) if (matches(d, filter)) n += t.delete(id) ? 1 : 0;
  return n;
}
