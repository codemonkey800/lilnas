interface CacheEntry<T> {
  data: T
  expiry: number
}

const MAX_CACHE_SIZE = 500
const cache = new Map<string, CacheEntry<unknown>>()

function evictOldest(): void {
  let oldestKey: string | undefined
  let oldestExpiry = Infinity
  for (const [key, entry] of cache) {
    if (entry.expiry < oldestExpiry) {
      oldestExpiry = entry.expiry
      oldestKey = key
    }
  }
  if (oldestKey !== undefined) {
    cache.delete(oldestKey)
  }
}

/**
 * Returns cached data if still fresh, otherwise calls `fn`, caches the result
 * for `ttlMs` milliseconds, and returns it. The cache is capped at
 * MAX_CACHE_SIZE entries; when full, the entry with the earliest expiry is
 * evicted before inserting the new one.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const entry = cache.get(key) as CacheEntry<T> | undefined
  if (entry && Date.now() < entry.expiry) return entry.data
  const data = await fn()
  if (cache.size >= MAX_CACHE_SIZE && !cache.has(key)) {
    evictOldest()
  }
  cache.set(key, { data, expiry: Date.now() + ttlMs })
  return data
}
