import { TestUtils } from 'src/__tests__/test-utils'
import { ResponseCacheService } from 'src/cache/response-cache.service'
import { CacheConfig, CacheKey } from 'src/cache/types'

// Mock implementation for testing the abstract class
class MockCacheService extends ResponseCacheService {
  private store = new Map<string, unknown>()

  async get<T>(key: CacheKey): Promise<T | null> {
    const keyString = JSON.stringify(key)
    return (this.store.get(keyString) as T) || null
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async set<T>(key: CacheKey, value: T, _ttl?: number): Promise<void> {
    const keyString = JSON.stringify(key)
    this.store.set(keyString, value)
  }

  async delete(key: CacheKey): Promise<boolean> {
    const keyString = JSON.stringify(key)
    return this.store.delete(keyString)
  }

  async clear(): Promise<void> {
    this.store.clear()
  }

  async has(key: CacheKey): Promise<boolean> {
    const keyString = JSON.stringify(key)
    return this.store.has(keyString)
  }

  async keys(): Promise<string[]> {
    return Array.from(this.store.keys())
  }

  async size(): Promise<number> {
    return this.store.size
  }

  async invalidateByPattern(pattern: string): Promise<number> {
    const regex = new RegExp(pattern)
    let count = 0
    for (const key of this.store.keys()) {
      if (regex.test(key)) {
        this.store.delete(key)
        count++
      }
    }
    return count
  }
}

describe('ResponseCacheService', () => {
  let cache: MockCacheService
  let testKey: CacheKey

  beforeEach(() => {
    cache = new MockCacheService()
    testKey = TestUtils.createTestCacheKey()
  })

  describe('constructor', () => {
    it('should initialize with default configuration', () => {
      const config = cache.getConfig()

      expect(config.maxSize).toBe(1000)
      expect(config.defaultTtl).toBe(3600)
      expect(config.enableMetrics).toBe(true)
      expect(config.compressionEnabled).toBe(false)
      expect(config.namespace).toBe('default')
    })

    it('should initialize with custom configuration', () => {
      const customConfig: Partial<CacheConfig> = {
        maxSize: 500,
        defaultTtl: 1800,
        enableMetrics: false,
        compressionEnabled: true,
        namespace: 'custom-namespace',
      }

      const customCache = new MockCacheService(customConfig)
      const config = customCache.getConfig()

      expect(config.maxSize).toBe(500)
      expect(config.defaultTtl).toBe(1800)
      expect(config.enableMetrics).toBe(false)
      expect(config.compressionEnabled).toBe(true)
      expect(config.namespace).toBe('custom-namespace')
    })

    it('should merge custom config with defaults', () => {
      const partialConfig: Partial<CacheConfig> = {
        maxSize: 200,
        enableMetrics: false,
      }

      const customCache = new MockCacheService(partialConfig)
      const config = customCache.getConfig()

      expect(config.maxSize).toBe(200)
      expect(config.enableMetrics).toBe(false)
      expect(config.defaultTtl).toBe(3600) // Should use default
      expect(config.namespace).toBe('default') // Should use default
    })

    it('should initialize metrics to zero', () => {
      const metrics = cache.getMetrics()

      expect(metrics.hits).toBe(0)
      expect(metrics.misses).toBe(0)
      expect(metrics.size).toBe(0)
      expect(metrics.hitRate).toBe(0)
      expect(metrics.totalRequests).toBe(0)
      expect(metrics.averageResponseTime).toBe(0)
    })
  })

  describe('metrics tracking', () => {
    it('should track cache hits', async () => {
      await cache.set(testKey, { data: 'test' })

      // Simulate cache hit by calling updateMetrics directly
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(cache as any).updateMetrics(true, 10)

      const metrics = cache.getMetrics()

      expect(metrics.hits).toBe(1)
      expect(metrics.misses).toBe(0)
      expect(metrics.totalRequests).toBe(1)
      expect(metrics.hitRate).toBe(1)
      expect(metrics.averageResponseTime).toBe(10)
    })

    it('should track cache misses', async () => {
      // Simulate cache miss by calling updateMetrics directly
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(cache as any).updateMetrics(false, 20)

      const metrics = cache.getMetrics()

      expect(metrics.hits).toBe(0)
      expect(metrics.misses).toBe(1)
      expect(metrics.totalRequests).toBe(1)
      expect(metrics.hitRate).toBe(0)
      expect(metrics.averageResponseTime).toBe(20)
    })

    it('should calculate hit rate correctly', async () => {
      // Simulate mixed hits and misses
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(cache as any).updateMetrics(true, 10) // Hit
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(cache as any).updateMetrics(false, 15) // Miss
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(cache as any).updateMetrics(true, 5) // Hit
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(cache as any).updateMetrics(false, 20) // Miss

      const metrics = cache.getMetrics()

      expect(metrics.hits).toBe(2)
      expect(metrics.misses).toBe(2)
      expect(metrics.totalRequests).toBe(4)
      expect(metrics.hitRate).toBe(0.5)
    })

    it('should calculate average response time correctly', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(cache as any).updateMetrics(true, 10)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(cache as any).updateMetrics(false, 20)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(cache as any).updateMetrics(true, 30)

      const metrics = cache.getMetrics()

      expect(metrics.averageResponseTime).toBe(20) // (10 + 20 + 30) / 3
    })

    it('should not track metrics when disabled', async () => {
      const noMetricsCache = new MockCacheService({ enableMetrics: false })

      // Simulate operations
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(noMetricsCache as any).updateMetrics(true, 10)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(noMetricsCache as any).updateMetrics(false, 20)

      const metrics = noMetricsCache.getMetrics()

      expect(metrics.hits).toBe(0)
      expect(metrics.misses).toBe(0)
      expect(metrics.totalRequests).toBe(0)
      expect(metrics.hitRate).toBe(0)
      expect(metrics.averageResponseTime).toBe(0)
    })

    it('should reset metrics correctly', async () => {
      // Add some metrics
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(cache as any).updateMetrics(true, 10)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(cache as any).updateMetrics(false, 20)

      cache.resetMetrics()
      const metrics = cache.getMetrics()

      expect(metrics.hits).toBe(0)
      expect(metrics.misses).toBe(0)
      expect(metrics.totalRequests).toBe(0)
      expect(metrics.hitRate).toBe(0)
      expect(metrics.averageResponseTime).toBe(0)
    })

    it('should return immutable metrics object', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(cache as any).updateMetrics(true, 10)

      const metrics1 = cache.getMetrics()
      const metrics2 = cache.getMetrics()

      expect(metrics1).not.toBe(metrics2) // Should be different objects
      expect(metrics1).toEqual(metrics2) // But with same values

      // Modifying returned object should not affect internal state
      metrics1.hits = 999

      const metrics3 = cache.getMetrics()
      expect(metrics3.hits).toBe(1) // Should still be the original value
    })
  })

  describe('configuration', () => {
    it('should return immutable configuration object', () => {
      const config1 = cache.getConfig()
      const config2 = cache.getConfig()

      expect(config1).not.toBe(config2) // Should be different objects
      expect(config1).toEqual(config2) // But with same values

      // Modifying returned object should not affect internal state
      config1.maxSize = 999

      const config3 = cache.getConfig()
      expect(config3.maxSize).toBe(1000) // Should still be the original value
    })

    it('should preserve configuration after operations', async () => {
      const originalConfig = cache.getConfig()

      // Perform various operations
      await cache.set(testKey, { data: 'test' })
      await cache.get(testKey)
      await cache.delete(testKey)
      cache.resetMetrics()

      const configAfterOps = cache.getConfig()

      expect(configAfterOps).toEqual(originalConfig)
    })
  })

  describe('abstract methods', () => {
    it('should require implementation of all abstract methods', () => {
      // This test ensures that all abstract methods are implemented
      const methods = [
        'get',
        'set',
        'delete',
        'clear',
        'has',
        'keys',
        'size',
        'invalidateByPattern',
      ]

      methods.forEach(method => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(typeof (cache as any)[method]).toBe('function')
      })
    })

    it('should maintain consistent method signatures', () => {
      // Test that the mock implementation follows the expected signatures
      expect(cache.get).toHaveLength(1)
      expect(cache.set).toHaveLength(3)
      expect(cache.delete).toHaveLength(1)
      expect(cache.clear).toHaveLength(0)
      expect(cache.has).toHaveLength(1)
      expect(cache.keys).toHaveLength(0)
      expect(cache.size).toHaveLength(0)
      expect(cache.invalidateByPattern).toHaveLength(1)
    })
  })

  describe('updateMetrics edge cases', () => {
    it('should handle zero response time', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(cache as any).updateMetrics(true, 0)

      const metrics = cache.getMetrics()

      expect(metrics.averageResponseTime).toBe(0)
    })

    it('should handle negative response time', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(cache as any).updateMetrics(true, -5)

      const metrics = cache.getMetrics()

      expect(metrics.averageResponseTime).toBe(-5)
    })

    it('should handle very large response times', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(cache as any).updateMetrics(true, Number.MAX_SAFE_INTEGER)

      const metrics = cache.getMetrics()

      expect(metrics.averageResponseTime).toBe(Number.MAX_SAFE_INTEGER)
    })

    it('should handle floating point response times', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(cache as any).updateMetrics(true, 10.5)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(cache as any).updateMetrics(false, 20.3)

      const metrics = cache.getMetrics()

      expect(metrics.averageResponseTime).toBeCloseTo(15.4)
    })

    it('should maintain precision with rolling average', () => {
      // Test rolling average calculation with multiple values
      const responseTimes = [10, 20, 30, 40, 50]

      responseTimes.forEach(time => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(cache as any).updateMetrics(true, time)
      })

      const metrics = cache.getMetrics()
      const expectedAverage =
        responseTimes.reduce((a, b) => a + b) / responseTimes.length

      expect(metrics.averageResponseTime).toBeCloseTo(expectedAverage)
    })
  })

  describe('inheritance', () => {
    it('should allow extending the abstract class', () => {
      expect(cache).toBeInstanceOf(ResponseCacheService)
      expect(cache).toBeInstanceOf(MockCacheService)
    })

    it('should provide access to protected members in subclasses', () => {
      // Test that subclasses can access protected config and metrics
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const subclassConfig = (cache as any).config
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const subclassMetrics = (cache as any).metrics

      expect(subclassConfig).toBeDefined()
      expect(subclassMetrics).toBeDefined()
      expect(subclassConfig.maxSize).toBe(1000)
      expect(subclassMetrics.hits).toBe(0)
    })

    it('should allow subclasses to call updateMetrics', () => {
      // This is tested implicitly in other tests, but we can verify it works
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(cache as any).updateMetrics(true, 10)
      }).not.toThrow()

      const metrics = cache.getMetrics()
      expect(metrics.hits).toBe(1)
    })
  })
})
