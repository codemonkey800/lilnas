interface CacheEntry<T> {
  data: T
  expiry: number
}

const cache = new Map<string, CacheEntry<unknown>>()

/**
 * Returns cached data if still fresh, otherwise calls `fn`, caches the result
 * for `ttlMs` milliseconds, and returns it.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const entry = cache.get(key) as CacheEntry<T> | undefined
  if (entry && Date.now() < entry.expiry) return entry.data
  const data = await fn()
  cache.set(key, { data, expiry: Date.now() + ttlMs })
  return data
}
