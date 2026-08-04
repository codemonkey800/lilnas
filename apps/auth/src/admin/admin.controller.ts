import { env } from '@lilnas/utils/env'
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common'

import { DB, type Db } from 'src/db/database.module'
import { EnvKeys } from 'src/env'
import {
  listGrantsForUser,
  listUsersWithGrantHistory,
} from 'src/grants/grants.repo'
import {
  countPriorDecisions,
  listPendingQueue,
} from 'src/requests/requests.repo'
import { RequestsService } from 'src/requests/requests.service'
import type { ServiceRegistryEntry } from 'src/services/service-registry.service'
import { ServiceRegistryService } from 'src/services/service-registry.service'

import { AdminGuard, isAdminEmail } from './admin.guard'
import { UsersService } from './users.service'

export type QueueEntry = {
  id: number
  userId: string
  email: string
  serviceHost: string
  createdAt: string
  lastSeenAt: string
  // R12: "4th request, rejected 3x" — the count of prior DECIDED rows for
  // this same (userId, serviceHost) pair, the only recovery route for a
  // mis-clicked rejection.
  priorDecisions: number
}

export type AdminUserEntry = {
  id: string
  email: string
  blockedAt: string | null
  // The user's FULL current grant set — read-only from this route's own
  // perspective (mutations go through setUserService()'s single-host
  // shape below, never a resubmission of this array). Seeds which
  // checkboxes the admin UI's service list starts checked, INCLUDING any
  // host the user holds a grant for that has since left the service
  // registry — the union of this array with the registry's own hosts is
  // what makes such a stale/off-registry grant visible and revocable
  // rather than silently invisible.
  services: string[]
  // DERIVED from the same ADMIN_EMAILS allowlist AdminGuard itself checks
  // (isAdminEmail(), re-exported from admin.guard.ts) — never a stored
  // role, mirroring me.controller.ts's identical MeResponse.isAdmin. Lets
  // the admin dashboard's People table flag an admin row without a second
  // source of truth for "who is an admin."
  isAdmin: boolean
}

// ──────────────────────────────────────────────────────────────────────────────
// U7 (R10, R11, R12, R17; F2, F3; AE5): the admin API surface. Every route
// is gated by AdminGuard alone — see that file's header comment for why it
// never touches the grants table.
// ──────────────────────────────────────────────────────────────────────────────
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly requestsService: RequestsService,
    private readonly serviceRegistry: ServiceRegistryService,
    private readonly usersService: UsersService,
  ) {}

  // U8 (R13): the admin dashboard's service registry — every Traefik-routed
  // host discovered from the read-only compose-label bind mount, with which
  // middleware (if any) currently gates it. See
  // src/services/service-registry.service.ts's own header comment for why
  // this reads compose files rather than the Docker socket.
  @Get('services')
  async services(): Promise<ServiceRegistryEntry[]> {
    return this.serviceRegistry.getServices()
  }

  @Get('queue')
  queue(): QueueEntry[] {
    return listPendingQueue(this.db).map(row => ({
      id: row.id,
      userId: row.userId,
      email: row.email,
      serviceHost: row.serviceHost,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      priorDecisions: countPriorDecisions(this.db, row.userId, row.serviceHost),
    }))
  }

  @Post('requests/:id/approve')
  approve(@Param('id', ParseIntPipe) id: number): { ok: true } {
    this.requestsService.approveRequest(id)
    return { ok: true }
  }

  // `decided` reports whether this call ACTUALLY changed the row (false
  // for an already-decided one) — passed straight through from
  // RequestsService.rejectRequest()'s own return value (#24 from
  // REVIEW.md) so a caller (queue-client.tsx, via actions.ts) can tell a
  // genuine rejection from a silent no-op, rather than every response
  // reporting the same `{ ok: true }` regardless.
  @Post('requests/:id/reject')
  reject(@Param('id', ParseIntPipe) id: number): {
    ok: true
    decided: boolean
  } {
    const decided = this.requestsService.rejectRequest(id)
    return { ok: true, decided }
  }

  // The queue's bulk-dismiss action (R10) — "dismiss" means reject, never
  // approve; there is no bulk-approve action (approving is deliberately a
  // one-at-a-time, look-before-you-grant action). `decided` is the subset
  // of `body.ids` this call actually rejected — see reject()'s own comment
  // above for why that matters.
  @Post('requests/bulk-reject')
  bulkReject(@Body() body: { ids: number[] }): { ok: true; decided: number[] } {
    const decided = this.requestsService.bulkReject(body.ids)
    return { ok: true, decided }
  }

  // ── U9 (R14, R15, R16; AE6): user and grant management ────────────────

  // R14: every user who has at least one grant, current or historical —
  // see grants.repo.ts's own comment on listUsersWithGrantHistory for the
  // everGrantedAt mechanism. Inline repo-calling + DTO mapping here rather
  // than delegated to UsersService, matching queue()'s own precedent
  // above: a plain read with no transaction/cache-invalidation to
  // orchestrate belongs directly in the controller; UsersService is
  // reserved for the actual mutations below.
  @Get('users')
  users(): AdminUserEntry[] {
    const adminEmails = env(EnvKeys.ADMIN_EMAILS)
    return listUsersWithGrantHistory(this.db).map(row => ({
      id: row.id,
      email: row.email,
      blockedAt: row.blockedAt?.toISOString() ?? null,
      services: listGrantsForUser(this.db, row.id).map(
        grant => grant.serviceHost,
      ),
      isAdmin: isAdminEmail(row.email, adminEmails),
    }))
  }

  // R15's "add by email." Validated against U8's service registry here
  // (mirrors requests.controller.ts's own parseServiceHost() precedent of
  // validating at the controller layer, not inside the service) — U9's own
  // error-path test scenario: "granting a service not in the registry is
  // rejected with a clear message."
  @Post('users/pre-authorize')
  async preAuthorize(
    @Body() body: { email: string; serviceHost: string },
  ): Promise<{ ok: true }> {
    await this.assertKnownServiceHost(body.serviceHost)
    this.usersService.preAuthorize(body.email, body.serviceHost)
    return { ok: true }
  }

  // R15's "edit a user's services" — a single-host grant/revoke mutation
  // (see UsersService.setUserService()'s own comment for why this replaced
  // the earlier complete-desired-set shape). Registry validation runs ONLY
  // when granting: a revoke never re-validates the host being removed, so
  // an existing grant for a host that has since left the registry (e.g.
  // this app's own cutover, which renamed login.lilnas.io to
  // auth.lilnas.io) stays revocable rather than permanently stuck —
  // validation exists to keep NEW grants confined to known hosts, not to
  // gate removing old ones.
  @Post('users/:userId/services')
  async setUserService(
    @Param('userId') userId: string,
    @Body() body: { serviceHost: string; grant: boolean },
  ): Promise<{ ok: true }> {
    if (body.grant) {
      await this.assertKnownServiceHost(body.serviceHost)
    }
    this.usersService.setUserService(userId, body.serviceHost, body.grant)
    return { ok: true }
  }

  // R15's "remove" — revokes every current grant; see
  // UsersService.removeUser()'s own comment for why this is NOT the same
  // as R16's block() below.
  @Post('users/:userId/remove')
  remove(@Param('userId') userId: string): { ok: true } {
    this.usersService.removeUser(userId)
    return { ok: true }
  }

  @Post('users/:userId/block')
  block(@Param('userId') userId: string): { ok: true } {
    this.usersService.blockUser(userId)
    return { ok: true }
  }

  @Post('users/:userId/unblock')
  unblock(@Param('userId') userId: string): { ok: true } {
    this.usersService.unblockUser(userId)
    return { ok: true }
  }

  private async assertKnownServiceHost(serviceHost: string): Promise<void> {
    const services = await this.serviceRegistry.getServices()
    if (!services.some(service => service.host === serviceHost)) {
      throw new BadRequestException(
        `"${serviceHost}" is not a known service — check the registry (GET /admin/services) for currently discovered hosts.`,
      )
    }
  }
}
