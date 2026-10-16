import "server-only";
import mongoose from "mongoose";
import { env } from "./env";

/**
 * Cached Mongoose connection that survives hot reloads and serverless reuse.
 * Returns null when MONGODB_URI is not configured so callers can fall back to
 * the clearly-labelled ephemeral store.
 */
type Cache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null; lastError: string | null };
const g = globalThis as unknown as { __anvilMongo?: Cache };
const cache: Cache = g.__anvilMongo ?? { conn: null, promise: null, lastError: null };
g.__anvilMongo = cache;

export function isDatabaseConfigured(): boolean {
  return Boolean(env.mongodbUri);
}

export async function connectToDatabase(): Promise<typeof mongoose | null> {
  if (!env.mongodbUri) return null;
  if (cache.conn) return cache.conn;
  if (!cache.promise) {
    cache.promise = mongoose
      .connect(env.mongodbUri, {
        bufferCommands: false,
        serverSelectionTimeoutMS: 8_000,
        maxPoolSize: 10,
      })
      .then((m) => {
        cache.lastError = null;
        return m;
      });
  }
  try {
    cache.conn = await cache.promise;
    return cache.conn;
  } catch (err) {
    cache.promise = null;
    cache.lastError = (err as Error).message;
    throw err;
  }
}

/** Like connectToDatabase but never throws — used where storage is best-effort. */
export async function tryConnect(): Promise<typeof mongoose | null> {
  try {
    return await connectToDatabase();
  } catch {
    return null;
  }
}

export function lastDatabaseError(): string | null {
  return cache.lastError;
}
