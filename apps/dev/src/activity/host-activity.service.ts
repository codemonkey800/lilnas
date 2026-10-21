import { env } from '@lilnas/utils/env'
import { Injectable } from '@nestjs/common'

import { EnvKeys } from 'src/env'

const DEFAULT_AUTH_URL = 'http://auth:8081'
const REQUEST_TIMEOUT_MS = 3000
const CACHE_TTL_MS = 30_000

export interface HostActivity {
  host: string
  windowHours: number
  activeUsers: number
  lastVisitAt: string | null
}

function isHostActivity(body: unknown): body is HostActivity {
  if (typeof body !== 'object' || body === null) return false
  const b = body as Record<string, unknown>
  return (
    typeof b.host === 'string' &&
    typeof b.windowHours === 'number' &&
    typeof b.activeUsers === 'number' &&
    Number.isFinite(b.activeUsers) &&
    (b.lastVisitAt === null || typeof b.lastVisitAt === 'string')
  )
}

interface CacheEntry {
  expiresAt: number
  result: Promise<HostActivity | null>
}

// Asks the auth service the same question dev-idle-reaper asks, so the
// dashboard shows what the reaper will see. Failures are never cached.
@Injectable()
export class HostActivityService {
  private readonly cache = new Map<string, CacheEntry>()

  get(host: string, hours: number): Promise<HostActivity | null> {
    const key = `${host}|${hours}`
    const now = Date.now()
    const hit = this.cache.get(key)
    if (hit && hit.expiresAt > now) return hit.result

    const result = this.fetchActivity(host, hours).then(activity => {
      if (!activity && this.cache.get(key)?.result === result) {
        this.cache.delete(key)
      }
      return activity
    })
    this.cache.set(key, { expiresAt: now + CACHE_TTL_MS, result })
    return result
  }

  private async fetchActivity(
    host: string,
    hours: number,
  ): Promise<HostActivity | null> {
    const base = env(EnvKeys.AUTH_URL, DEFAULT_AUTH_URL).replace(/\/+$/, '')
    const url = new URL(`${base}/internal/host-activity`)
    url.searchParams.set('host', host)
    url.searchParams.set('hours', String(hours))

    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (res.status !== 200) return null
      const body: unknown = await res.json()
      return isHostActivity(body) ? body : null
    } catch {
      return null
    }
  }
}

export interface ReapEstimate {
  enabled: boolean
  maxIdleHours: number
  lastActiveAt?: string
  idleHours?: number
  reapsAt?: string
  activeUsers?: number
  basis: 'auth' | 'container-start' | 'unknown' | 'disabled'
}

const HOUR_MS = 3_600_000

// Mirrors dev-idle-reaper/reaper.sh: last activity is the later of the
// container start and the latest visit auth has seen on any routed host, and
// the reaper leaves a unit alone while any lookup failed or users are active.
//   startedAt:  the running container's StartedAt, undefined when not running
//   activities: one entry per routed host, null where the lookup failed
export function estimateReap(
  idleReap: { enabled: boolean; maxIdleHours: number },
  startedAt: string | undefined,
  activities: (HostActivity | null)[],
  now: Date = new Date(),
): ReapEstimate {
  const { enabled, maxIdleHours } = idleReap
  if (!enabled) return { enabled, maxIdleHours, basis: 'disabled' }

  const started = startedAt ? Date.parse(startedAt) : NaN
  if (Number.isNaN(started)) {
    return { enabled, maxIdleHours, basis: 'unknown' }
  }

  if (activities.length === 0 || activities.some(a => a === null)) {
    return { enabled, maxIdleHours, basis: 'unknown' }
  }

  let lastActive = started
  let movedByAuth = false
  let activeUsers = 0
  for (const activity of activities) {
    if (!activity) continue
    activeUsers += activity.activeUsers
    const visit = activity.lastVisitAt ? Date.parse(activity.lastVisitAt) : NaN
    if (!Number.isNaN(visit) && visit > lastActive) {
      lastActive = visit
      movedByAuth = true
    }
  }

  const idleHours = Math.max(
    0,
    Math.floor((now.getTime() - lastActive) / HOUR_MS),
  )
  return {
    enabled,
    maxIdleHours,
    lastActiveAt: new Date(lastActive).toISOString(),
    idleHours,
    reapsAt:
      activeUsers === 0
        ? new Date(lastActive + maxIdleHours * HOUR_MS).toISOString()
        : undefined,
    activeUsers,
    basis: movedByAuth || activeUsers > 0 ? 'auth' : 'container-start',
  }
}
