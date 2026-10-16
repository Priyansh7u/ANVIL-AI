/** Run `fn` over items with at most `limit` in flight. Results keep input order; failures become `{ ok: false }`. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<({ ok: true; value: R } | { ok: false; error: unknown })[]> {
  const results: ({ ok: true; value: R } | { ok: false; error: unknown })[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { ok: true, value: await fn(items[i] as T, i) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/** Small TTL cache with a size bound; used for feed and geocoding responses. */
export class TtlCache<V> {
  private store = new Map<string, { value: V; expiresAt: number; storedAt: number }>();
  constructor(
    private ttlMs: number,
    private maxEntries = 500,
  ) {}
  get(key: string, now = Date.now()): { value: V; storedAt: number; fresh: boolean } | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    return { value: e.value, storedAt: e.storedAt, fresh: e.expiresAt > now };
  }
  set(key: string, value: V, now = Date.now()): void {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, storedAt: now, expiresAt: now + this.ttlMs });
  }
}
