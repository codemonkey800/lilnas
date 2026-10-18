import { BadRequestException, Controller, Get, Query } from '@nestjs/common'

import { HostActivityService } from 'src/services/host-activity.service'
import { normalizeHost } from 'src/services/normalize-host'

// Longest window a caller can ask about. host_visit rows never age out, so
// there is no hard limit; this just rejects nonsense.
const MAX_WINDOW_HOURS = 24 * 30

export type HostActivityResponse = {
  host: string
  windowHours: number
  // Distinct users let through to `host` within the window.
  activeUsers: number
  // ISO timestamp of the most recent visit by anyone, regardless of the
  // window; null if /verify has never recorded one for this host.
  lastVisitAt: string | null
}

// Guard-free by design, exactly like discord-internal.controller.ts — see
// that file's comment for the full precedent: port 8081 has no Traefik router
// and publishes no host port, so only containers on the shared Docker network
// (the dev-idle-reaper) can reach it. The network is the trust boundary.
//
// Always HTTP 200 when this app answers, with `activeUsers: 0` for a host it
// has never seen — a 404 is left to mean "this auth deploy predates the
// route", which lets the reaper tell a missing route from a real zero.
@Controller('internal')
export class HostActivityController {
  constructor(private readonly hostActivity: HostActivityService) {}

  @Get('host-activity')
  hostActivityFor(
    @Query('host') rawHost?: string,
    @Query('hours') rawHours?: string,
  ): HostActivityResponse {
    const host = rawHost ? normalizeHost(rawHost) : ''
    if (!host) {
      throw new BadRequestException('host is required')
    }

    const windowHours = Number(rawHours)
    if (
      rawHours === undefined ||
      !Number.isFinite(windowHours) ||
      windowHours <= 0 ||
      windowHours > MAX_WINDOW_HOURS
    ) {
      throw new BadRequestException(
        `hours must be a number greater than 0 and at most ${MAX_WINDOW_HOURS}`,
      )
    }

    const { activeUsers, lastVisitAt } = this.hostActivity.summarize(
      host,
      windowHours,
    )
    return {
      host,
      windowHours,
      activeUsers,
      lastVisitAt: lastVisitAt ? lastVisitAt.toISOString() : null,
    }
  }
}
