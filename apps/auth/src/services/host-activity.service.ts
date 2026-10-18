import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { DB, type Db } from 'src/db/database.module'
import {
  type HostActivitySummary,
  summarizeHostActivity,
  upsertHostVisit,
} from 'src/db/host-visit.repo'

// ──────────────────────────────────────────────────────────────────────────────
// "How many distinct users actually visited this host in the last N hours" —
// the signal the dev-idle-reaper uses to decide a dev server is unused.
//
// Network-byte counters can't answer that: background chatter on the shared
// Docker network (UPnP broadcasts, *arr polling) moves them with nobody
// there. /verify can, because Traefik calls it for every request to a host
// behind lilnas-auth and the decision carries the user. VerifyController
// calls recordVisit() on each `allow`; the cache that short-circuits
// decide() sits below the controller, so cache hits are recorded too.
//
// recordVisit() runs on the /verify hot path, so like GatedHostsService it is
// a Map lookup in the common case: the DB is only touched the first time a
// (host, user) pair is seen by this process and then at most once per
// WRITE_INTERVAL_MS. A failed write is logged and swallowed — /verify must
// never fail because of activity tracking.
//
// The write throttle bounds how stale a visit can look to a reader at
// WRITE_INTERVAL_MS, which is nothing against the hours-long windows asked
// about.
// ──────────────────────────────────────────────────────────────────────────────

const WRITE_INTERVAL_MS = 60 * 1000 // 1 minute

// Same guard as GatedHostsService: /verify on :8081 is reachable from sibling
// containers, so only real lilnas.io hostnames are recorded.
const HOST_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+lilnas\.io$/

const HOUR_MS = 60 * 60 * 1000

const LOG_EVENTS = {
  recordFailed: 'host-activity-record-failed',
} as const

@Injectable()
export class HostActivityService {
  // Keyed `${host}\0${userId}` — neither part can contain a NUL.
  private readonly lastWrittenMs = new Map<string, number>()

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly logger: PinoLogger,
  ) {}

  // `host` must already be normalizeHost()'d — VerifyController does that
  // before calling in.
  recordVisit(host: string, userId: string, nowMs = Date.now()): void {
    if (!HOST_PATTERN.test(host)) return

    const key = `${host}\0${userId}`
    const lastWritten = this.lastWrittenMs.get(key)
    if (lastWritten !== undefined && nowMs - lastWritten < WRITE_INTERVAL_MS) {
      return
    }
    this.lastWrittenMs.set(key, nowMs)

    try {
      upsertHostVisit(this.db, host, userId, new Date(nowMs))
    } catch (err) {
      this.logger.warn(
        {
          event: LOG_EVENTS.recordFailed,
          host,
          errName: err instanceof Error ? err.name : undefined,
        },
        'host-activity: could not record a visit',
      )
    }
  }

  summarize(
    host: string,
    windowHours: number,
    nowMs = Date.now(),
  ): HostActivitySummary {
    return summarizeHostActivity(
      this.db,
      host,
      new Date(nowMs - windowHours * HOUR_MS),
    )
  }
}
