import { CacheConfig, CacheKey, CacheMetrics } from './types'

export abstract class ResponseCacheService {
  protected config: CacheConfig
  protected metrics: CacheMetrics

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      maxSize: config.maxSize ?? 1000,
      defaultTtl: config.defaultTtl ?? 3600, // 1 hour
      enableMetrics: config.enableMetrics ?? true,
      compressionEnabled: config.compressionEnabled ?? false,
      namespace: config.namespace ?? 'default',
    }

    this.metrics = {
      hits: 0,
      misses: 0,
      size: 0,
      hitRate: 0,
      totalRequests: 0,
      averageResponseTime: 0,
    }
  }

  /**
   * Get cached value by key
   */
  abstract get<T>(key: CacheKey): Promise<T | null>

  /**
   * Set cached value with optional TTL
   */
  abstract set<T>(key: CacheKey, value: T, ttl?: number): Promise<void>

  /**
   * Delete cached value by key
   */
  abstract delete(key: CacheKey): Promise<boolean>

  /**
   * Clear all cached values
   */
  abstract clear(): Promise<void>

  /**
   * Check if key exists in cache
   */
  abstract has(key: CacheKey): Promise<boolean>

  /**
   * Get all cache keys (for debugging/admin)
   */
  abstract keys(): Promise<string[]>

  /**
   * Get cache size
   */
  abstract size(): Promise<number>

  /**
   * Invalidate cache entries by pattern
   */
  abstract invalidateByPattern(pattern: string): Promise<number>

  /**
   * Get cache metrics
   */
  getMetrics(): CacheMetrics {
    return { ...this.metrics }
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      size: 0,
      hitRate: 0,
      totalRequests: 0,
      averageResponseTime: 0,
    }
  }

  /**
   * Update metrics after cache operation
   */
  protected updateMetrics(hit: boolean, responseTime: number): void {
    if (!this.config.enableMetrics) return

    this.metrics.totalRequests++
    if (hit) {
      this.metrics.hits++
    } else {
      this.metrics.misses++
    }

    this.metrics.hitRate = this.metrics.hits / this.metrics.totalRequests

    // Calculate rolling average response time
    this.metrics.averageResponseTime =
      (this.metrics.averageResponseTime * (this.metrics.totalRequests - 1) +
        responseTime) /
      this.metrics.totalRequests
  }

  /**
   * Get cache configuration
   */
  getConfig(): CacheConfig {
    return { ...this.config }
  }
}
