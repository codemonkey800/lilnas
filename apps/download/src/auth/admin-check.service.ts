import { AuthClient } from '@lilnas/utils/auth/client'
import { Injectable } from '@nestjs/common'

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
// eviction cap, no in-flight-request dedup. The email keyspace is bounded
// by real signed-in humans reaching this container through Traefik's
// lilnas-auth middleware, not arbitrary attacker-controlled input the way
// AccessCacheService's sessionCache has to defend against — so that
// cache's heavier defenses don't apply here.
@Injectable()
export class AdminCheckService {
  private static readonly TTL_MS = 60_000

  private readonly cache = new Map<string, CacheEntry>()
  private readonly authClient = AuthClient.dockerInstance

  async checkIsAdmin(email: string): Promise<boolean> {
    const key = email.trim().toLowerCase()
    const cached = this.cache.get(key)
    if (cached && cached.expiresAtMs > Date.now()) {
      return cached.isAdmin
    }

    const { isAdmin } = await this.authClient.checkIsAdmin(key)
    this.cache.set(key, {
      isAdmin,
      expiresAtMs: Date.now() + AdminCheckService.TTL_MS,
    })
    return isAdmin
  }
}
