import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { DB, type Db } from 'src/db/database.module'
import {
  listGatedHostsSeenSince,
  upsertGatedHost,
} from 'src/db/gated-host.repo'

// ──────────────────────────────────────────────────────────────────────────────
// The service registry's second source: hosts learned from /verify itself.
//
// The compose-file scan (service-registry.service.ts) only sees this repo's
// own deploy.yml/infra files, so a project living anywhere else — e.g. a
// ~/dev project exposed at <name>.dev.lilnas.io per docs/lilnas-expose.md —
// never appears there, and a request for it is silently never created.
// Traefik, though, only calls /verify for routers carrying the lilnas-auth
// middleware, so every X-Forwarded-Host /verify sees is by definition a
// gated host. Recording those gives exact discovery with no Docker socket
// and no extra bind mounts into this internet-facing container.
//
// recordSeen() runs on the /verify hot path, so it is a Map lookup in the
// common case: the DB is only touched the first time a host is seen by this
// process and then at most once per WRITE_INTERVAL_MS. A failed write is
// logged and swallowed — discovery is best-effort, /verify must never fail
// because of it.
// ──────────────────────────────────────────────────────────────────────────────

const WRITE_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

// A host nobody has hit in this long is treated as torn down and drops out
// of the registry. Existing grants for it are unaffected (grants never
// consult the registry), and one visit brings it straight back.
export const GATED_HOST_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

// Only real lilnas.io hostnames. /verify on :8081 is reachable from sibling
// containers, not just Traefik, so this keeps a forged X-Forwarded-Host from
// recording anything outside the domain this box actually serves.
const GATED_HOST_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+lilnas\.io$/

const LOG_EVENTS = {
  recordFailed: 'gated-host-record-failed',
} as const

@Injectable()
export class GatedHostsService {
  private readonly lastWrittenMs = new Map<string, number>()

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly logger: PinoLogger,
  ) {}

  // `host` must already be normalizeHost()'d — VerifyController does that
  // before calling in.
  recordSeen(host: string, nowMs = Date.now()): void {
    if (!GATED_HOST_PATTERN.test(host)) return

    const lastWritten = this.lastWrittenMs.get(host)
    if (lastWritten !== undefined && nowMs - lastWritten < WRITE_INTERVAL_MS) {
      return
    }
    this.lastWrittenMs.set(host, nowMs)

    try {
      upsertGatedHost(this.db, host, new Date(nowMs))
    } catch (err) {
      this.logger.warn(
        {
          event: LOG_EVENTS.recordFailed,
          host,
          errName: err instanceof Error ? err.name : undefined,
        },
        'gated-hosts: could not record a host seen by /verify',
      )
    }
  }

  listActiveHosts(nowMs = Date.now()): string[] {
    return listGatedHostsSeenSince(
      this.db,
      new Date(nowMs - GATED_HOST_MAX_AGE_MS),
    ).map(row => row.host)
  }
}
