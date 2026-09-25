import { AuthClient } from '@lilnas/utils/auth/client'
import { Injectable, Logger } from '@nestjs/common'

interface CacheEntry {
  isAdmin: boolean
  expiresAtMs: number
}

// A short in-memory TTL cache in front of apps/auth's stateless
// GET /admin/check — once Phase 1 wires this into DownloadController, it
// will be called on most list/detail requests, so avoiding a network round
// trip per request matters from day one of that wiring.
//
// Deliberately simpler than apps/auth's own AccessCacheService: no
// write-through invalidation (nothing here ever changes admin status), no
// in-flight-request dedup. It does cap entries (MAX_CACHE_ENTRIES) as
// defense-in-depth, though: the email keyspace is header-supplied, and this
// container accepts `X-Forwarded-User` from anything reachable on the
// shared lilnas Docker network (see forwarded-user.ts's `ForwardedUser`
// comment), not only real signed-in humans routed through Traefik's
// lilnas-auth middleware — so, unlike a keyspace Traefik itself narrowed,
// nothing stops a peer container from growing this map with distinct
// forged emails.
@Injectable()
export class AdminCheckService {
  private static readonly TTL_MS = 60_000
  // Short TTL for a failed lookup — long enough that a sustained auth
  // outage isn't hammered once per request, short enough that recovery is
  // noticed quickly once auth comes back.
  private static readonly FAILURE_TTL_MS = 10_000
  // Oldest-entry eviction once the cache hits this size - see the class
  // comment on why the keyspace isn't otherwise bounded.
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

    // Fail-closed: an unreachable or erroring `auth` container (true for
    // the native `lilnas dev` flow, where the `auth` hostname doesn't
    // resolve; Docker dev does run apps/auth, so the admin branch IS
    // reachable there — see .env.example's DEV_USER_EMAIL note — and
    // production can hit this during an outage) must never leak hidden
    // attribution. `AuthClient.checkIsAdmin()` can reject outright (network
    // error, timeout) or throw on a non-2xx/malformed body; either way,
    // treat it as "not an admin" rather than letting it propagate and 500
    // every read that touches attribution.
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
