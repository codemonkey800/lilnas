import { CacheKey } from 'src/cache/types'

/**
 * Test utilities for cache testing
 */
export class TestUtils {
  /**
   * Create a sample cache key for testing
   */
  static createTestCacheKey(overrides: Partial<CacheKey> = {}): CacheKey {
    return {
      service: 'test-service',
      promptHash: 'test-hash-123',
      userId: 'test-user',
      ...overrides,
    }
  }

  /**
   * Wait for a specified amount of time
   */
  static async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Generate a random string for testing
   */
  static randomString(length: number = 10): string {
    const chars =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  /**
   * Create a sample cache value for testing
   */
  static createTestValue(size: 'small' | 'medium' | 'large' = 'small') {
    const base = { id: 'test-id', timestamp: Date.now() }

    switch (size) {
      case 'small':
        return { ...base, data: 'small test data' }
      case 'medium':
        return { ...base, data: this.randomString(1000) }
      case 'large':
        return { ...base, data: this.randomString(10000) }
      default:
        return base
    }
  }

  /**
   * Mock Date.now to return a specific timestamp
   */
  static mockDateNow(timestamp: number): jest.SpyInstance {
    return jest.spyOn(Date, 'now').mockReturnValue(timestamp)
  }

  /**
   * Assert that a promise rejects with a specific error message
   */
  static async expectRejection(
    promise: Promise<unknown>,
    expectedMessage?: string,
  ): Promise<Error> {
    let error: Error
    try {
      await promise
      throw new Error('Expected promise to reject, but it resolved')
    } catch (err) {
      error = err as Error
    }

    if (expectedMessage) {
      expect(error.message).toContain(expectedMessage)
    }

    return error
  }
}
