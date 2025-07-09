import { createHash } from 'crypto'

import { CacheKey } from './types'

export class CacheKeyGenerator {
  private static readonly SEPARATOR = ':'
  private static readonly HASH_ALGORITHM = 'sha256'

  /**
   * Generate a cache key string from CacheKey object
   */
  static generateKey(cacheKey: CacheKey): string {
    const parts: string[] = []

    // Add namespace if provided
    if (cacheKey.namespace) {
      parts.push(cacheKey.namespace)
    }

    // Add service name
    parts.push(cacheKey.service)

    // Add user ID if provided (for user-specific caching)
    if (cacheKey.userId) {
      parts.push(`user:${cacheKey.userId}`)
    }

    // Add prompt hash
    parts.push(`prompt:${cacheKey.promptHash}`)

    // Add context hash if provided
    if (cacheKey.context && Object.keys(cacheKey.context).length > 0) {
      const contextHash = this.hashObject(cacheKey.context)
      parts.push(`ctx:${contextHash}`)
    }

    return parts.join(this.SEPARATOR)
  }

  /**
   * Generate SHA-256 hash for a string (typically prompt content)
   */
  static hashString(content: string): string {
    // Normalize the content (remove extra whitespace, normalize line endings)
    const normalized = content
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\r\n/g, '\n')

    return createHash(this.HASH_ALGORITHM)
      .update(normalized, 'utf8')
      .digest('hex')
  }

  /**
   * Generate hash for an object (typically context data)
   */
  static hashObject(obj: Record<string, unknown>): string {
    // Sort keys for consistent hashing
    const sortedKeys = Object.keys(obj).sort()
    const normalizedObj: Record<string, unknown> = {}

    for (const key of sortedKeys) {
      normalizedObj[key] = obj[key]
    }

    const jsonString = JSON.stringify(normalizedObj)
    return createHash(this.HASH_ALGORITHM)
      .update(jsonString, 'utf8')
      .digest('hex')
  }

  /**
   * Parse a cache key string back to its components
   */
  static parseKey(keyString: string): Partial<CacheKey> {
    const parts = keyString.split(this.SEPARATOR)
    const result: Partial<CacheKey> = {}

    // Look for prefixed parts to determine structure
    const userIndex = parts.findIndex(part => part === 'user')
    const promptIndex = parts.findIndex(part => part === 'prompt')
    const ctxIndex = parts.findIndex(part => part === 'ctx')

    // If we have a prompt part and there are parts before it without prefixes,
    // we can determine the structure
    if (promptIndex > 0) {
      // Everything before the first prefixed part is either namespace+service or just service
      const prefixedParts = [userIndex, promptIndex, ctxIndex].filter(
        i => i > 0,
      )
      const firstPrefixIndex = Math.min(...prefixedParts)

      const beforePrefixes = parts.slice(0, firstPrefixIndex)

      if (beforePrefixes.length === 2) {
        // namespace + service
        const namespaceValue = beforePrefixes[0]
        const serviceValue = beforePrefixes[1]
        if (namespaceValue) {
          result.namespace = namespaceValue
        }
        if (serviceValue) {
          result.service = serviceValue
        }
      } else if (beforePrefixes.length === 1) {
        // just service
        const serviceValue = beforePrefixes[0]
        if (serviceValue) {
          result.service = serviceValue
        }
      }
    }

    // Parse prefixed parts
    if (userIndex >= 0 && userIndex + 1 < parts.length) {
      const userValue = parts[userIndex + 1]
      if (userValue) {
        result.userId = userValue
      }
    }

    if (promptIndex >= 0 && promptIndex + 1 < parts.length) {
      const promptValue = parts[promptIndex + 1]
      if (promptValue) {
        result.promptHash = promptValue
      }
    }

    if (ctxIndex >= 0 && ctxIndex + 1 < parts.length) {
      // Context hash is not reversible, so we just note it exists
      result.context = { _hasContext: true }
    }

    return result
  }

  /**
   * Generate cache key for simple string-based caching
   */
  static simple(service: string, content: string, userId?: string): string {
    const cacheKey: CacheKey = {
      service,
      promptHash: this.hashString(content),
      ...(userId && { userId }),
    }

    return this.generateKey(cacheKey)
  }

  /**
   * Generate cache key with context
   */
  static withContext(
    service: string,
    content: string,
    context: Record<string, unknown>,
    userId?: string,
    namespace?: string,
  ): string {
    const cacheKey: CacheKey = {
      service,
      promptHash: this.hashString(content),
      context,
      ...(userId && { userId }),
      ...(namespace && { namespace }),
    }

    return this.generateKey(cacheKey)
  }

  /**
   * Generate pattern for cache invalidation
   */
  static generatePattern(
    service: string,
    userId?: string,
    namespace?: string,
  ): string {
    const parts: string[] = []

    if (namespace) {
      parts.push(namespace)
    }

    parts.push(service)

    if (userId) {
      parts.push(`user:${userId}`)
    }

    // Add wildcard for remaining parts
    parts.push('*')

    return parts.join(this.SEPARATOR)
  }
}
