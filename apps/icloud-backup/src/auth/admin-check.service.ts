import { AuthClient } from '@lilnas/utils/auth/client'
import { Injectable, Logger } from '@nestjs/common'

interface CacheEntry {
  isAdmin: boolean
  expiresAtMs: number
}

// A short in-memory TTL cache in front of apps/auth's stateless
// GET /admin/check. It caps entries because the email keyspace is
// header-supplied and any container on the lilnas network can send
// `X-Forwarded-User`, so nothing else bounds the map.
@Injectable()
export class AdminCheckService {
  private static readonly TTL_MS = 60_000
  // Short TTL for a failed lookup — long enough that a sustained auth
  // outage isn't hammered once per request, short enough that recovery is
  // noticed quickly.
  private static readonly FAILURE_TTL_MS = 10_000
  // Oldest-entry eviction once the cache hits this size.
  private static readonly MAX_CACHE_ENTRIES = 500

  private readonly cache = new Map<string, CacheEntry>()
  private readonly authClient = AuthClient.dockerInstance
  private readonly logger = new Logger(AdminCheckService.name)

  async checkIsAdmin(email: string): Promise<boolean> {
    const key = email.trim().toLowerCase()
    const cached = this.cache.get(key)
    if (cached && cached.expiresAtMs > Date.now()) {
      return cached.isAdmin
    }

    // Fail-closed: an unreachable or erroring `auth` container (or a
    // non-2xx/malformed body) is treated as "not an admin" rather than
    // propagating and failing every request that checks admin status.
    try {
      const { isAdmin } = await this.authClient.checkIsAdmin(key)
      this.setCacheEntry(key, {
        isAdmin,
        expiresAtMs: Date.now() + AdminCheckService.TTL_MS,
      })
      return isAdmin
    } catch (err) {
      this.logger.warn(
        {
          action: 'checkIsAdmin',
          email: key,
          error: err instanceof Error ? err.message : String(err),
        },
        'Failed to reach auth for admin check — treating as non-admin',
      )
      this.setCacheEntry(key, {
        isAdmin: false,
        expiresAtMs: Date.now() + AdminCheckService.FAILURE_TTL_MS,
      })
      return false
    }
  }

  private setCacheEntry(key: string, entry: CacheEntry): void {
    if (
      !this.cache.has(key) &&
      this.cache.size >= AdminCheckService.MAX_CACHE_ENTRIES
    ) {
      // Map iterates keys in insertion order - the first key yielded is
      // the oldest entry still held, evicted to make room for this one.
      const oldestKey = this.cache.keys().next().value
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey)
      }
    }
    this.cache.set(key, entry)
  }
}
