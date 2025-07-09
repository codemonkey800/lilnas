export interface CacheKey {
  service: string
  userId?: string
  promptHash: string
  context?: Record<string, unknown>
  namespace?: string
}

export interface CacheEntry<T = unknown> {
  key: string
  value: T
  timestamp: number
  ttl?: number
  metadata?: Record<string, unknown>
}

export interface CacheMetrics {
  hits: number
  misses: number
  size: number
  hitRate: number
  totalRequests: number
  averageResponseTime: number
}

export interface CacheConfig {
  maxSize: number
  defaultTtl: number
  enableMetrics: boolean
  compressionEnabled: boolean
  namespace: string
}
