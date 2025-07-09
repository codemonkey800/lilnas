import { LRUCache } from 'lru-cache'

import { CacheKeyGenerator } from './key-generator'
import { ResponseCacheService } from './response-cache.service'
import { CacheConfig, CacheKey } from './types'

interface InMemoryCacheEntry<T = unknown> {
  value: T
  timestamp: number
  ttl?: number
}

export class InMemoryCacheService extends ResponseCacheService {
  private cache: LRUCache<string, InMemoryCacheEntry>

  constructor(config: Partial<CacheConfig> = {}) {
    super(config)

    this.cache = new LRUCache<string, InMemoryCacheEntry>({
      max: this.config.maxSize,
      ttl: this.config.defaultTtl * 1000, // Convert to milliseconds
      updateAgeOnGet: true,
      updateAgeOnHas: true,
    })
  }

  async get<T>(key: CacheKey): Promise<T | null> {
    const startTime = Date.now()
    const keyString = CacheKeyGenerator.generateKey(key)

    try {
      const entry = this.cache.get(keyString)

      if (entry) {
        // Check if entry has expired (additional TTL check)
        if (entry.ttl && Date.now() - entry.timestamp > entry.ttl * 1000) {
          this.cache.delete(keyString)
          this.updateMetrics(false, Date.now() - startTime)
          return null
        }

        this.updateMetrics(true, Date.now() - startTime)
        return entry.value as T
      }

      this.updateMetrics(false, Date.now() - startTime)
      return null
    } catch (error) {
      this.updateMetrics(false, Date.now() - startTime)
      throw new Error(
        `Cache get error: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async set<T>(key: CacheKey, value: T, ttl?: number): Promise<void> {
    const keyString = CacheKeyGenerator.generateKey(key)
    const timestamp = Date.now()

    const entry: InMemoryCacheEntry<T> = {
      value,
      timestamp,
      ttl: ttl || this.config.defaultTtl,
    }

    try {
      // Use specific TTL if provided, otherwise use default
      const cacheTtl = ttl ? ttl * 1000 : this.config.defaultTtl * 1000

      this.cache.set(keyString, entry, { ttl: cacheTtl })

      // Update metrics size
      this.metrics.size = this.cache.size
    } catch (error) {
      throw new Error(
        `Cache set error: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async delete(key: CacheKey): Promise<boolean> {
    const keyString = CacheKeyGenerator.generateKey(key)

    try {
      const result = this.cache.delete(keyString)
      this.metrics.size = this.cache.size
      return result
    } catch (error) {
      throw new Error(
        `Cache delete error: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async clear(): Promise<void> {
    try {
      this.cache.clear()
      this.metrics.size = 0
    } catch (error) {
      throw new Error(
        `Cache clear error: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async has(key: CacheKey): Promise<boolean> {
    const keyString = CacheKeyGenerator.generateKey(key)

    try {
      return this.cache.has(keyString)
    } catch (error) {
      throw new Error(
        `Cache has error: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async keys(): Promise<string[]> {
    try {
      return Array.from(this.cache.keys())
    } catch (error) {
      throw new Error(
        `Cache keys error: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async size(): Promise<number> {
    try {
      return this.cache.size
    } catch (error) {
      throw new Error(
        `Cache size error: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async invalidateByPattern(pattern: string): Promise<number> {
    try {
      const keys = Array.from(this.cache.keys())
      const regex = new RegExp(pattern.replace(/\*/g, '.*'))
      let deletedCount = 0

      for (const key of keys) {
        if (regex.test(key)) {
          this.cache.delete(key)
          deletedCount++
        }
      }

      this.metrics.size = this.cache.size
      return deletedCount
    } catch (error) {
      throw new Error(
        `Cache invalidateByPattern error: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * Get all cache entries (for debugging/admin purposes)
   */
  async getAllEntries(): Promise<
    Array<{ key: string; entry: InMemoryCacheEntry }>
  > {
    try {
      const entries: Array<{ key: string; entry: InMemoryCacheEntry }> = []

      for (const [key, entry] of this.cache.entries()) {
        entries.push({ key, entry })
      }

      return entries
    } catch (error) {
      throw new Error(
        `Cache getAllEntries error: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * Force eviction of expired entries
   */
  async purgeExpired(): Promise<number> {
    try {
      const now = Date.now()
      const keys = Array.from(this.cache.keys())
      let purgedCount = 0

      for (const key of keys) {
        const entry = this.cache.get(key)
        if (entry && entry.ttl && now - entry.timestamp > entry.ttl * 1000) {
          this.cache.delete(key)
          purgedCount++
        }
      }

      this.metrics.size = this.cache.size
      return purgedCount
    } catch (error) {
      throw new Error(
        `Cache purgeExpired error: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      cacheSize: this.cache.size,
      maxSize: this.config.maxSize,
      calculatedSize: this.cache.calculatedSize,
      ...this.getMetrics(),
    }
  }
}
