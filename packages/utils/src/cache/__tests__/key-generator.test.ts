import { CacheKeyGenerator } from 'src/cache/key-generator'
import { CacheKey } from 'src/cache/types'

describe('CacheKeyGenerator', () => {
  describe('hashString', () => {
    it('should generate consistent hash for same input', () => {
      const input = 'test string'
      const hash1 = CacheKeyGenerator.hashString(input)
      const hash2 = CacheKeyGenerator.hashString(input)

      expect(hash1).toBe(hash2)
      expect(hash1).toHaveLength(64) // SHA-256 hex length
    })

    it('should generate different hashes for different inputs', () => {
      const hash1 = CacheKeyGenerator.hashString('input1')
      const hash2 = CacheKeyGenerator.hashString('input2')

      expect(hash1).not.toBe(hash2)
    })

    it('should normalize whitespace', () => {
      const hash1 = CacheKeyGenerator.hashString('  hello   world  ')
      const hash2 = CacheKeyGenerator.hashString('hello world')

      expect(hash1).toBe(hash2)
    })

    it('should normalize line endings', () => {
      const hash1 = CacheKeyGenerator.hashString('line1\r\nline2')
      const hash2 = CacheKeyGenerator.hashString('line1\nline2')

      expect(hash1).toBe(hash2)
    })

    it('should handle empty string', () => {
      const hash = CacheKeyGenerator.hashString('')
      expect(hash).toHaveLength(64)
    })
  })

  describe('hashObject', () => {
    it('should generate consistent hash for same object', () => {
      const obj = { key1: 'value1', key2: 'value2' }
      const hash1 = CacheKeyGenerator.hashObject(obj)
      const hash2 = CacheKeyGenerator.hashObject(obj)

      expect(hash1).toBe(hash2)
      expect(hash1).toHaveLength(64)
    })

    it('should generate same hash for objects with same keys in different order', () => {
      const obj1 = { key1: 'value1', key2: 'value2' }
      const obj2 = { key2: 'value2', key1: 'value1' }

      const hash1 = CacheKeyGenerator.hashObject(obj1)
      const hash2 = CacheKeyGenerator.hashObject(obj2)

      expect(hash1).toBe(hash2)
    })

    it('should generate different hashes for different objects', () => {
      const obj1 = { key1: 'value1' }
      const obj2 = { key1: 'value2' }

      const hash1 = CacheKeyGenerator.hashObject(obj1)
      const hash2 = CacheKeyGenerator.hashObject(obj2)

      expect(hash1).not.toBe(hash2)
    })

    it('should handle nested objects', () => {
      const obj = { key1: { nested: 'value' }, key2: 'value2' }
      const hash = CacheKeyGenerator.hashObject(obj)

      expect(hash).toHaveLength(64)
    })

    it('should handle empty object', () => {
      const hash = CacheKeyGenerator.hashObject({})
      expect(hash).toHaveLength(64)
    })
  })

  describe('generateKey', () => {
    it('should generate key with all components', () => {
      const cacheKey: CacheKey = {
        service: 'test-service',
        promptHash: 'test-hash',
        userId: 'user123',
        namespace: 'test-namespace',
        context: { key: 'value' },
      }

      const key = CacheKeyGenerator.generateKey(cacheKey)

      expect(key).toContain('test-namespace')
      expect(key).toContain('test-service')
      expect(key).toContain('user:user123')
      expect(key).toContain('prompt:test-hash')
      expect(key).toContain('ctx:')
    })

    it('should generate key without optional components', () => {
      const cacheKey: CacheKey = {
        service: 'test-service',
        promptHash: 'test-hash',
      }

      const key = CacheKeyGenerator.generateKey(cacheKey)

      expect(key).toBe('test-service:prompt:test-hash')
    })

    it('should include user ID when provided', () => {
      const cacheKey: CacheKey = {
        service: 'test-service',
        promptHash: 'test-hash',
        userId: 'user123',
      }

      const key = CacheKeyGenerator.generateKey(cacheKey)

      expect(key).toBe('test-service:user:user123:prompt:test-hash')
    })

    it('should include namespace when provided', () => {
      const cacheKey: CacheKey = {
        service: 'test-service',
        promptHash: 'test-hash',
        namespace: 'my-namespace',
      }

      const key = CacheKeyGenerator.generateKey(cacheKey)

      expect(key).toBe('my-namespace:test-service:prompt:test-hash')
    })

    it('should include context hash when provided', () => {
      const cacheKey: CacheKey = {
        service: 'test-service',
        promptHash: 'test-hash',
        context: { model: 'gpt-4' },
      }

      const key = CacheKeyGenerator.generateKey(cacheKey)
      const parts = key.split(':')

      expect(parts).toHaveLength(5)
      expect(parts[0]).toBe('test-service')
      expect(parts[1]).toBe('prompt')
      expect(parts[2]).toBe('test-hash')
      expect(parts[3]).toBe('ctx')
      expect(parts[4]).toMatch(/^[a-f0-9]{64}$/)
    })

    it('should not include context hash for empty context', () => {
      const cacheKey: CacheKey = {
        service: 'test-service',
        promptHash: 'test-hash',
        context: {},
      }

      const key = CacheKeyGenerator.generateKey(cacheKey)

      expect(key).toBe('test-service:prompt:test-hash')
    })
  })

  describe('parseKey', () => {
    it('should parse key with all components', () => {
      const originalKey: CacheKey = {
        service: 'test-service',
        promptHash: 'test-hash',
        userId: 'user123',
        namespace: 'test-namespace',
        context: { key: 'value' },
      }

      const keyString = CacheKeyGenerator.generateKey(originalKey)
      const parsed = CacheKeyGenerator.parseKey(keyString)

      expect(parsed.service).toBe('test-service')
      expect(parsed.promptHash).toBe('test-hash')
      expect(parsed.userId).toBe('user123')
      expect(parsed.namespace).toBe('test-namespace')
      expect(parsed.context).toEqual({ _hasContext: true })
    })

    it('should parse simple key without optional components', () => {
      const originalKey: CacheKey = {
        service: 'test-service',
        promptHash: 'test-hash',
      }

      const keyString = CacheKeyGenerator.generateKey(originalKey)
      const parsed = CacheKeyGenerator.parseKey(keyString)

      expect(parsed.service).toBe('test-service')
      expect(parsed.promptHash).toBe('test-hash')
      expect(parsed.userId).toBeUndefined()
      expect(parsed.namespace).toBeUndefined()
      expect(parsed.context).toBeUndefined()
    })

    it('should parse key with namespace', () => {
      const originalKey: CacheKey = {
        service: 'test-service',
        promptHash: 'test-hash',
        namespace: 'my-namespace',
      }

      const keyString = CacheKeyGenerator.generateKey(originalKey)
      const parsed = CacheKeyGenerator.parseKey(keyString)

      expect(parsed.namespace).toBe('my-namespace')
      expect(parsed.service).toBe('test-service')
      expect(parsed.promptHash).toBe('test-hash')
    })

    it('should parse key with user ID', () => {
      const originalKey: CacheKey = {
        service: 'test-service',
        promptHash: 'test-hash',
        userId: 'user123',
      }

      const keyString = CacheKeyGenerator.generateKey(originalKey)
      const parsed = CacheKeyGenerator.parseKey(keyString)

      expect(parsed.service).toBe('test-service')
      expect(parsed.userId).toBe('user123')
      expect(parsed.promptHash).toBe('test-hash')
    })

    it('should handle malformed key gracefully', () => {
      const keyString = 'invalid:key:format'
      const parsed = CacheKeyGenerator.parseKey(keyString)

      // Since it's malformed and has no 'prompt' part, it should return minimal parsing
      expect(parsed.service).toBeUndefined()
      expect(parsed.promptHash).toBeUndefined()
      expect(parsed.userId).toBeUndefined()
    })
  })

  describe('simple', () => {
    it('should generate simple cache key', () => {
      const key = CacheKeyGenerator.simple('test-service', 'test content')

      expect(key).toMatch(/^test-service:prompt:[a-f0-9]{64}$/)
    })

    it('should generate simple cache key with user ID', () => {
      const key = CacheKeyGenerator.simple(
        'test-service',
        'test content',
        'user123',
      )

      expect(key).toMatch(/^test-service:user:user123:prompt:[a-f0-9]{64}$/)
    })

    it('should generate consistent keys for same input', () => {
      const key1 = CacheKeyGenerator.simple('test-service', 'test content')
      const key2 = CacheKeyGenerator.simple('test-service', 'test content')

      expect(key1).toBe(key2)
    })
  })

  describe('withContext', () => {
    it('should generate cache key with context', () => {
      const context = { model: 'gpt-4', temperature: 0.7 }
      const key = CacheKeyGenerator.withContext(
        'test-service',
        'test content',
        context,
      )

      expect(key).toMatch(/^test-service:prompt:[a-f0-9]{64}:ctx:[a-f0-9]{64}$/)
    })

    it('should generate cache key with context and user ID', () => {
      const context = { model: 'gpt-4' }
      const key = CacheKeyGenerator.withContext(
        'test-service',
        'test content',
        context,
        'user123',
      )

      expect(key).toMatch(
        /^test-service:user:user123:prompt:[a-f0-9]{64}:ctx:[a-f0-9]{64}$/,
      )
    })

    it('should generate cache key with context and namespace', () => {
      const context = { model: 'gpt-4' }
      const key = CacheKeyGenerator.withContext(
        'test-service',
        'test content',
        context,
        undefined,
        'my-namespace',
      )

      expect(key).toMatch(
        /^my-namespace:test-service:prompt:[a-f0-9]{64}:ctx:[a-f0-9]{64}$/,
      )
    })

    it('should generate cache key with all parameters', () => {
      const context = { model: 'gpt-4' }
      const key = CacheKeyGenerator.withContext(
        'test-service',
        'test content',
        context,
        'user123',
        'my-namespace',
      )

      expect(key).toMatch(
        /^my-namespace:test-service:user:user123:prompt:[a-f0-9]{64}:ctx:[a-f0-9]{64}$/,
      )
    })
  })

  describe('generatePattern', () => {
    it('should generate pattern for service only', () => {
      const pattern = CacheKeyGenerator.generatePattern('test-service')

      expect(pattern).toBe('test-service:*')
    })

    it('should generate pattern with user ID', () => {
      const pattern = CacheKeyGenerator.generatePattern(
        'test-service',
        'user123',
      )

      expect(pattern).toBe('test-service:user:user123:*')
    })

    it('should generate pattern with namespace', () => {
      const pattern = CacheKeyGenerator.generatePattern(
        'test-service',
        undefined,
        'my-namespace',
      )

      expect(pattern).toBe('my-namespace:test-service:*')
    })

    it('should generate pattern with all parameters', () => {
      const pattern = CacheKeyGenerator.generatePattern(
        'test-service',
        'user123',
        'my-namespace',
      )

      expect(pattern).toBe('my-namespace:test-service:user:user123:*')
    })
  })
})
