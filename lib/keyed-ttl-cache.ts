/**
 * Small in-process cache with a TTL per key, a hard cap on the number of keys, shared in-flight loads and a
 * generation guard:
 *   - a fresh entry is served from memory;
 *   - concurrent callers for the same key share one load;
 *   - invalidate() bumps the generation, so a load that started before it is returned to its own callers but never
 *     stored (a write that commits while a slow read is running cannot be hidden behind a stale entry);
 *   - load errors propagate and are not cached;
 *   - at most `maxKeys` entries; storing a new key evicts the entry stored longest ago.
 */
export type KeyedTtlCacheOptions = { ttlMs: number; maxKeys: number; clock?: () => number };

export type KeyedTtlCache<K, V> = {
  get(key: K, load: () => Promise<V>): Promise<V>;
  invalidate(): void;
  size(): number;
};

export function createKeyedTtlCache<K, V>(options: KeyedTtlCacheOptions): KeyedTtlCache<K, V> {
  if (!(options.ttlMs > 0)) throw new RangeError("KEYED_TTL_CACHE_TTL_INVALID");
  if (!Number.isInteger(options.maxKeys) || options.maxKeys < 1) throw new RangeError("KEYED_TTL_CACHE_MAX_KEYS_INVALID");
  const clock = options.clock ?? Date.now;
  const entries = new Map<K, { value: V; until: number }>();
  const inFlight = new Map<K, { generation: number; promise: Promise<V> }>();
  let generation = 0;

  function store(key: K, value: V) {
    entries.delete(key); // re-insert so Map order is "stored longest ago" first
    entries.set(key, { value, until: clock() + options.ttlMs });
    while (entries.size > options.maxKeys) entries.delete(entries.keys().next().value as K);
  }

  return {
    get(key, load) {
      const hit = entries.get(key);
      if (hit && clock() < hit.until) return Promise.resolve(hit.value);
      const pending = inFlight.get(key);
      if (pending && pending.generation === generation) return pending.promise;
      const started = generation;
      // load() starts on a later microtask, so the in-flight entry is registered before it can settle.
      const promise: Promise<V> = Promise.resolve()
        .then(load)
        .then((value) => {
          if (started === generation) store(key, value);
          return value;
        })
        .finally(() => {
          if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
        });
      inFlight.set(key, { generation: started, promise });
      return promise;
    },
    invalidate() {
      generation += 1;
      entries.clear();
    },
    size: () => entries.size,
  };
}
