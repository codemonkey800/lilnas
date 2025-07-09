import { TestUtils } from 'src/__tests__/test-utils'
import { InMemoryCacheService } from 'src/cache/in-memory-cache.service'
import { CacheKey } from 'src/cache/types'

describe('InMemoryCacheService', () => {
  let cache: InMemoryCacheService
  let testKey: CacheKey

  beforeEach(() => {
    cache = new InMemoryCacheService({
      maxSize: 100,
      defaultTtl: 3600,
      enableMetrics: true,
    })
    testKey = TestUtils.createTestCacheKey()
  })

  describe('constructor', () => {
    it('should create cache with default configuration', () => {
      const defaultCache = new InMemoryCacheService()
      const config = defaultCache.getConfig()

      expect(config.maxSize).toBe(1000)
      expect(config.defaultTtl).toBe(3600)
      expect(config.enableMetrics).toBe(true)
      expect(config.compressionEnabled).toBe(false)
      expect(config.namespace).toBe('default')
    })

    it('should create cache with custom configuration', () => {
      const customCache = new InMemoryCacheService({
        maxSize: 500,
        defaultTtl: 1800,
        enableMetrics: false,
        namespace: 'custom',
      })
      const config = customCache.getConfig()

      expect(config.maxSize).toBe(500)
      expect(config.defaultTtl).toBe(1800)
      expect(config.enableMetrics).toBe(false)
      expect(config.namespace).toBe('custom')
    })
  })

  describe('set and get', () => {
    it('should store and retrieve value', async () => {
      const testValue = { data: 'test' }

      await cache.set(testKey, testValue)
      const result = await cache.get(testKey)

      expect(result).toEqual(testValue)
    })

    it('should return null for non-existent key', async () => {
      const nonExistentKey = TestUtils.createTestCacheKey({
        promptHash: 'non-existent',
      })

      const result = await cache.get(nonExistentKey)

      expect(result).toBeNull()
    })

    it('should handle different data types', async () => {
      const testCases = [
        { value: 'string', expected: 'string' },
        { value: 123, expected: 123 },
        { value: true, expected: true },
        { value: null, expected: null },
        {
          value: { nested: { data: 'complex' } },
          expected: { nested: { data: 'complex' } },
        },
        { value: [1, 2, 3], expected: [1, 2, 3] },
      ]

      for (const { value, expected } of testCases) {
        const key = TestUtils.createTestCacheKey({
          promptHash: `test-${typeof value}`,
        })

        await cache.set(key, value)
        const result = await cache.get(key)

        expect(result).toEqual(expected)
      }
    })

    it('should overwrite existing value', async () => {
      const initialValue = { data: 'initial' }
      const newValue = { data: 'updated' }

      await cache.set(testKey, initialValue)
      await cache.set(testKey, newValue)
      const result = await cache.get(testKey)

      expect(result).toEqual(newValue)
    })
  })

  describe('TTL functionality', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('should expire entries after TTL', async () => {
      const testValue = { data: 'test' }

      await cache.set(testKey, testValue, 1) // 1 second TTL

      // Should be available immediately
      let result = await cache.get(testKey)
      expect(result).toEqual(testValue)

      // Fast forward time by 1.5 seconds
      jest.advanceTimersByTime(1500)

      // Should be expired
      result = await cache.get(testKey)
      expect(result).toBeNull()
    })

    it('should use default TTL when not specified', async () => {
      const shortTtlCache = new InMemoryCacheService({
        defaultTtl: 1, // 1 second
      })

      await shortTtlCache.set(testKey, { data: 'test' })

      // Should be available immediately
      let result = await shortTtlCache.get(testKey)
      expect(result).toEqual({ data: 'test' })

      // Fast forward time by 1.5 seconds
      jest.advanceTimersByTime(1500)

      // Should be expired
      result = await shortTtlCache.get(testKey)
      expect(result).toBeNull()
    })

    it('should handle custom TTL per entry', async () => {
      const value1 = { data: 'short' }
      const value2 = { data: 'long' }
      const key1 = TestUtils.createTestCacheKey({ promptHash: 'short' })
      const key2 = TestUtils.createTestCacheKey({ promptHash: 'long' })

      await cache.set(key1, value1, 1) // 1 second TTL
      await cache.set(key2, value2, 5) // 5 second TTL

      // Fast forward by 2 seconds
      jest.advanceTimersByTime(2000)

      expect(await cache.get(key1)).toBeNull() // Should be expired
      expect(await cache.get(key2)).toEqual(value2) // Should still be available
    })
  })

  describe('delete', () => {
    it('should delete existing entry', async () => {
      await cache.set(testKey, { data: 'test' })

      const deleted = await cache.delete(testKey)
      const result = await cache.get(testKey)

      expect(deleted).toBe(true)
      expect(result).toBeNull()
    })

    it('should return false for non-existent entry', async () => {
      const nonExistentKey = TestUtils.createTestCacheKey({
        promptHash: 'non-existent',
      })

      const deleted = await cache.delete(nonExistentKey)

      expect(deleted).toBe(false)
    })
  })

  describe('clear', () => {
    it('should clear all entries', async () => {
      const key1 = TestUtils.createTestCacheKey({ promptHash: 'key1' })
      const key2 = TestUtils.createTestCacheKey({ promptHash: 'key2' })

      await cache.set(key1, { data: 'value1' })
      await cache.set(key2, { data: 'value2' })

      await cache.clear()

      expect(await cache.get(key1)).toBeNull()
      expect(await cache.get(key2)).toBeNull()
      expect(await cache.size()).toBe(0)
    })
  })

  describe('has', () => {
    it('should return true for existing entry', async () => {
      await cache.set(testKey, { data: 'test' })

      const exists = await cache.has(testKey)

      expect(exists).toBe(true)
    })

    it('should return false for non-existent entry', async () => {
      const nonExistentKey = TestUtils.createTestCacheKey({
        promptHash: 'non-existent',
      })

      const exists = await cache.has(nonExistentKey)

      expect(exists).toBe(false)
    })
  })

  describe('keys', () => {
    it('should return all cache keys', async () => {
      const key1 = TestUtils.createTestCacheKey({ promptHash: 'key1' })
      const key2 = TestUtils.createTestCacheKey({ promptHash: 'key2' })

      await cache.set(key1, { data: 'value1' })
      await cache.set(key2, { data: 'value2' })

      const keys = await cache.keys()

      expect(keys).toHaveLength(2)
      expect(keys).toContain('test-service:user:test-user:prompt:key1')
      expect(keys).toContain('test-service:user:test-user:prompt:key2')
    })

    it('should return empty array for empty cache', async () => {
      const keys = await cache.keys()

      expect(keys).toEqual([])
    })
  })

  describe('size', () => {
    it('should return correct cache size', async () => {
      expect(await cache.size()).toBe(0)

      await cache.set(testKey, { data: 'test' })
      expect(await cache.size()).toBe(1)

      const key2 = TestUtils.createTestCacheKey({ promptHash: 'key2' })
      await cache.set(key2, { data: 'test2' })
      expect(await cache.size()).toBe(2)

      await cache.delete(testKey)
      expect(await cache.size()).toBe(1)
    })
  })

  describe('invalidateByPattern', () => {
    it('should invalidate entries matching pattern', async () => {
      const userKey1 = TestUtils.createTestCacheKey({
        userId: 'user1',
        promptHash: 'prompt1',
      })
      const userKey2 = TestUtils.createTestCacheKey({
        userId: 'user1',
        promptHash: 'prompt2',
      })
      const otherUserKey = TestUtils.createTestCacheKey({
        userId: 'user2',
        promptHash: 'prompt3',
      })

      await cache.set(userKey1, { data: 'value1' })
      await cache.set(userKey2, { data: 'value2' })
      await cache.set(otherUserKey, { data: 'value3' })

      const deletedCount = await cache.invalidateByPattern('.*user:user1.*')

      expect(deletedCount).toBe(2)
      expect(await cache.get(userKey1)).toBeNull()
      expect(await cache.get(userKey2)).toBeNull()
      expect(await cache.get(otherUserKey)).toEqual({ data: 'value3' })
    })

    it('should return 0 for non-matching pattern', async () => {
      await cache.set(testKey, { data: 'test' })

      const deletedCount = await cache.invalidateByPattern(
        'non-matching-pattern',
      )

      expect(deletedCount).toBe(0)
      expect(await cache.get(testKey)).toEqual({ data: 'test' })
    })
  })

  describe('metrics', () => {
    it('should track cache hits and misses', async () => {
      await cache.set(testKey, { data: 'test' })

      // Hit
      await cache.get(testKey)

      // Miss
      const nonExistentKey = TestUtils.createTestCacheKey({
        promptHash: 'non-existent',
      })
      await cache.get(nonExistentKey)

      const metrics = cache.getMetrics()

      expect(metrics.hits).toBe(1)
      expect(metrics.misses).toBe(1)
      expect(metrics.totalRequests).toBe(2)
      expect(metrics.hitRate).toBe(0.5)
    })

    it('should track response times', async () => {
      await cache.set(testKey, { data: 'test' })
      await cache.get(testKey)

      const metrics = cache.getMetrics()

      expect(metrics.averageResponseTime).toBeGreaterThanOrEqual(0)
    })

    it('should reset metrics', async () => {
      await cache.set(testKey, { data: 'test' })
      await cache.get(testKey)

      cache.resetMetrics()
      const metrics = cache.getMetrics()

      expect(metrics.hits).toBe(0)
      expect(metrics.misses).toBe(0)
      expect(metrics.totalRequests).toBe(0)
      expect(metrics.hitRate).toBe(0)
      expect(metrics.averageResponseTime).toBe(0)
    })

    it('should not track metrics when disabled', async () => {
      const noMetricsCache = new InMemoryCacheService({
        enableMetrics: false,
      })

      await noMetricsCache.set(testKey, { data: 'test' })
      await noMetricsCache.get(testKey)

      const metrics = noMetricsCache.getMetrics()

      expect(metrics.hits).toBe(0)
      expect(metrics.misses).toBe(0)
      expect(metrics.totalRequests).toBe(0)
    })
  })

  describe('LRU eviction', () => {
    it('should evict least recently used entries when cache is full', async () => {
      const smallCache = new InMemoryCacheService({ maxSize: 2 })

      const key1 = TestUtils.createTestCacheKey({ promptHash: 'key1' })
      const key2 = TestUtils.createTestCacheKey({ promptHash: 'key2' })
      const key3 = TestUtils.createTestCacheKey({ promptHash: 'key3' })

      await smallCache.set(key1, { data: 'value1' })
      await smallCache.set(key2, { data: 'value2' })
      await smallCache.set(key3, { data: 'value3' }) // Should evict key1

      expect(await smallCache.get(key1)).toBeNull()
      expect(await smallCache.get(key2)).toEqual({ data: 'value2' })
      expect(await smallCache.get(key3)).toEqual({ data: 'value3' })
    })

    it('should update LRU order on access', async () => {
      const smallCache = new InMemoryCacheService({ maxSize: 2 })

      const key1 = TestUtils.createTestCacheKey({ promptHash: 'key1' })
      const key2 = TestUtils.createTestCacheKey({ promptHash: 'key2' })
      const key3 = TestUtils.createTestCacheKey({ promptHash: 'key3' })

      await smallCache.set(key1, { data: 'value1' })
      await smallCache.set(key2, { data: 'value2' })

      // Access key1 to make it most recently used
      await smallCache.get(key1)

      await smallCache.set(key3, { data: 'value3' }) // Should evict key2

      expect(await smallCache.get(key1)).toEqual({ data: 'value1' })
      expect(await smallCache.get(key2)).toBeNull()
      expect(await smallCache.get(key3)).toEqual({ data: 'value3' })
    })
  })

  describe('getAllEntries', () => {
    it('should return all cache entries', async () => {
      const key1 = TestUtils.createTestCacheKey({ promptHash: 'key1' })
      const key2 = TestUtils.createTestCacheKey({ promptHash: 'key2' })

      await cache.set(key1, { data: 'value1' })
      await cache.set(key2, { data: 'value2' })

      const entries = await cache.getAllEntries()

      expect(entries).toHaveLength(2)
      expect(entries[0]).toHaveProperty('key')
      expect(entries[0]).toHaveProperty('entry')
      expect(entries[0]?.entry).toHaveProperty('value')
      expect(entries[0]?.entry).toHaveProperty('timestamp')
    })

    it('should return empty array for empty cache', async () => {
      const entries = await cache.getAllEntries()

      expect(entries).toEqual([])
    })
  })

  describe('purgeExpired', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('should purge expired entries', async () => {
      const key1 = TestUtils.createTestCacheKey({ promptHash: 'key1' })
      const key2 = TestUtils.createTestCacheKey({ promptHash: 'key2' })

      await cache.set(key1, { data: 'value1' }, 1) // 1 second TTL
      await cache.set(key2, { data: 'value2' }, 5) // 5 second TTL

      // Fast forward by 2 seconds
      jest.advanceTimersByTime(2000)

      const purgedCount = await cache.purgeExpired()

      expect(purgedCount).toBe(1)
      expect(await cache.get(key1)).toBeNull()
      expect(await cache.get(key2)).toEqual({ data: 'value2' })
    })

    it('should return 0 when no entries are expired', async () => {
      await cache.set(testKey, { data: 'test' })

      const purgedCount = await cache.purgeExpired()

      expect(purgedCount).toBe(0)
      expect(await cache.get(testKey)).toEqual({ data: 'test' })
    })
  })

  describe('getStats', () => {
    it('should return cache statistics', async () => {
      await cache.set(testKey, { data: 'test' })
      await cache.get(testKey)

      const stats = cache.getStats()

      expect(stats).toHaveProperty('cacheSize')
      expect(stats).toHaveProperty('maxSize')
      expect(stats).toHaveProperty('calculatedSize')
      expect(stats).toHaveProperty('hits')
      expect(stats).toHaveProperty('misses')
      expect(stats).toHaveProperty('totalRequests')
      expect(stats).toHaveProperty('hitRate')
      expect(stats).toHaveProperty('averageResponseTime')

      expect(stats.cacheSize).toBe(1)
      expect(stats.maxSize).toBe(100)
      expect(stats.hits).toBe(1)
      expect(stats.totalRequests).toBe(1)
    })
  })

  describe('error handling', () => {
    it('should handle cache operation errors gracefully', async () => {
      // Force an error by corrupting the cache
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(cache as any).cache = null

      await expect(cache.get(testKey)).rejects.toThrow('Cache get error')
      await expect(cache.set(testKey, { data: 'test' })).rejects.toThrow(
        'Cache set error',
      )
      await expect(cache.delete(testKey)).rejects.toThrow('Cache delete error')
      await expect(cache.clear()).rejects.toThrow('Cache clear error')
      await expect(cache.has(testKey)).rejects.toThrow('Cache has error')
      await expect(cache.keys()).rejects.toThrow('Cache keys error')
      await expect(cache.size()).rejects.toThrow('Cache size error')
      await expect(cache.invalidateByPattern('.*')).rejects.toThrow(
        'Cache invalidateByPattern error',
      )
    })
  })
})
