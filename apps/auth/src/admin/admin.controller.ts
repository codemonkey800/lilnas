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
import { ThrottlerGuard } from '@nestjs/throttler'
import type { z } from 'zod'

import { DB, type Db } from 'src/db/database.module'
import {
  listLinks,
  listUnlinkedIdentities,
  listUnlinkedUsers,
} from 'src/db/discord-link.repo'
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

import {
  BulkRejectBodySchema,
  LinkDiscordBodySchema,
  PreAuthorizeBodySchema,
  SetUserServicesBodySchema,
  UnlinkDiscordBodySchema,
} from './admin.dto'
import { AdminGuard, isAdminEmail } from './admin.guard'
import { UsersService } from './users.service'

export type QueueEntry = {
  id: number
  userId: string
  email: string
  serviceHost: string
  createdAt: string
  lastSeenAt: string
  // "4th request, rejected 3x" — the count of prior DECIDED rows for this
  // same (userId, serviceHost) pair, the only recovery route for a
  // mis-clicked rejection.
  priorDecisions: number
}

export type AdminUserEntry = {
  id: string
  email: string
  blockedAt: string | null
  // The user's FULL current grant set — read-only from this route's own
  // perspective (mutations go through setUserServices()'s explicit-deltas
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
  // The Discord account this person is linked to, or null for the common
  // case of no link. Carried on the People row itself — rather than left
  // to the dedicated /admin/discord/links route — purely so the People
  // table can render a chip without a second fetch and a client-side join;
  // the Discord management UI still reads the richer link list from that
  // route.
  discordUserId: string | null
  // The CURRENT handle, joined out of discord_identity at read time — a
  // display label with no identity meaning whatsoever (schema.ts is
  // explicit that nothing keys off it, and upsertIdentity() overwrites it
  // whenever Discord reports a rename). Null exactly when discordUserId is
  // null; the two always move together.
  discordUsername: string | null
}

// ──────────────────────────────────────────────────────────────────────────────
// The Discord link admin surface's three response shapes.
//
// All three are the repo layer's own row types with every Date serialized
// through .toISOString() — the same boundary rule QueueEntry above follows,
// for the same reason: a Date survives neither JSON.stringify's round trip
// nor the Next.js server-component fetch these feed, so converting once here
// beats every consumer guessing.
// ──────────────────────────────────────────────────────────────────────────────

// Left column of the link UI: lilnas people with no Discord link yet.
// Blocked users are already excluded by listUnlinkedUsers() itself — see
// that function's own comment for why offering one as a link target would be
// wrong.
export type DiscordUnlinkedPerson = {
  userId: string
  email: string
  name: string
}

// Right column: Discord accounts this system has OBSERVED that aren't linked
// to anyone. Ordered most-recently-seen first by the repo, and deliberately
// not re-sorted here — an admin linking an account has almost always just
// watched it run /download, so the row they want is the first one.
export type DiscordUnlinkedAccount = {
  discordUserId: string
  username: string
  displayName: string | null
  firstSeenAt: string
  lastSeenAt: string
}

// Every existing link, flattened for display and ordered by the person's
// email. Both labels (`name`, `username`/`displayName`) are joined from
// their own tables at read time, never stored on the link — so a Discord
// rename shows up here the moment the roster records it.
export type DiscordLinkEntry = {
  userId: string
  email: string
  name: string
  discordUserId: string
  username: string
  displayName: string | null
  createdAt: string
}

// ──────────────────────────────────────────────────────────────────────────────
// The admin API surface. Authorization is AdminGuard alone — see that
// file's header comment for why it never touches the grants table.
// ThrottlerGuard (S5) is layered on top of that, not instead of it — see
// app.module.ts's ThrottlerModule.forRoot() comment for the tier values
// and why this controller gets one but VerifyController does not.
// ──────────────────────────────────────────────────────────────────────────────
@UseGuards(AdminGuard, ThrottlerGuard)
@Controller('admin')
export class AdminController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly requestsService: RequestsService,
    private readonly serviceRegistry: ServiceRegistryService,
    private readonly usersService: UsersService,
  ) {}

  // The admin dashboard's service registry — every Traefik-routed host
  // discovered from the read-only compose-label bind mount, with which
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
  // RequestsService.rejectRequest()'s own return value so a caller
  // (queue-client.tsx, via actions.ts) can tell a genuine rejection from a
  // silent no-op, rather than every response reporting the same
  // `{ ok: true }` regardless.
  @Post('requests/:id/reject')
  reject(@Param('id', ParseIntPipe) id: number): {
    ok: true
    decided: boolean
  } {
    const decided = this.requestsService.rejectRequest(id)
    return { ok: true, decided }
  }

  // The queue's bulk-dismiss action — "dismiss" means reject, never
  // approve; there is no bulk-approve action (approving is deliberately a
  // one-at-a-time, look-before-you-grant action). `decided` is the subset
  // of `body.ids` this call actually rejected — see reject()'s own comment
  // above for why that matters.
  @Post('requests/bulk-reject')
  bulkReject(@Body() body: unknown): { ok: true; decided: number[] } {
    const { ids } = this.parseBody(BulkRejectBodySchema, body)
    const decided = this.requestsService.bulkReject(ids)
    return { ok: true, decided }
  }

  // ── User and grant management ──────────────────────────────────────────

  // Every user who has at least one grant, current or historical — see
  // grants.repo.ts's own comment on listUsersWithGrantHistory for the
  // everGrantedAt mechanism. Inline repo-calling + DTO mapping here rather
  // than delegated to UsersService, matching queue()'s own precedent
  // above: a plain read with no transaction/cache-invalidation to
  // orchestrate belongs directly in the controller; UsersService is
  // reserved for the actual mutations below.
  @Get('users')
  users(): AdminUserEntry[] {
    const adminEmails = env(EnvKeys.ADMIN_EMAILS)
    // ONE listLinks() call indexed by userId, rather than a
    // findLinkByUserId() per row — at homelab scale either is fine, but the
    // whole-table read is the cheaper shape and keeps this route's query
    // count independent of how many people are listed. Deliberately reuses
    // listLinks() rather than adding a links-by-user repo function: the
    // extra columns it returns cost nothing here and the repo stays one
    // function smaller.
    const linksByUserId = new Map(
      listLinks(this.db).map(link => [link.userId, link]),
    )
    return listUsersWithGrantHistory(this.db).map(row => {
      const link = linksByUserId.get(row.id)
      return {
        id: row.id,
        email: row.email,
        blockedAt: row.blockedAt?.toISOString() ?? null,
        services: listGrantsForUser(this.db, row.id).map(
          grant => grant.serviceHost,
        ),
        isAdmin: isAdminEmail(row.email, adminEmails),
        discordUserId: link?.discordUserId ?? null,
        discordUsername: link?.username ?? null,
      }
    })
  }

  // "Add by email," M3's batched form — one call for every service the
  // admin checked, not one call per checkbox (see
  // UsersService.preAuthorizeMany()'s own comment for the "one transaction
  // for the whole batch" half of this fix). EVERY host is validated
  // against the service registry BEFORE any of them are written (mirrors
  // requests.controller.ts's own parseServiceHost() precedent of validating
  // at the controller layer, not inside the service) — granting a service
  // not in the registry is rejected with a clear message, and that now
  // applies per host: one unknown host in the batch fails the whole
  // request, rather than partially applying the known ones first.
  @Post('users/pre-authorize')
  async preAuthorize(@Body() body: unknown): Promise<{ ok: true }> {
    const { email, serviceHosts } = this.parseBody(PreAuthorizeBodySchema, body)
    await Promise.all(
      serviceHosts.map(serviceHost => this.assertKnownServiceHost(serviceHost)),
    )
    this.usersService.preAuthorizeMany(email, serviceHosts)
    return { ok: true }
  }

  // "Edit a user's services," M3's batched form — a set of explicit
  // (serviceHost, grant) deltas applied in one call (see
  // UsersService.setUserServices()'s own comment for why this replaced the
  // earlier complete-desired-set shape, and for the "one transaction for
  // the whole batch" half of this fix that replaces the admin dashboard's
  // old per-checkbox loop). Registry validation runs ONLY on entries with
  // `grant: true`, and ALL of those are validated before anything is
  // written: a revoke never re-validates the host being removed, so an
  // existing grant for a host that has since left the registry (e.g. this
  // app's own cutover, which renamed login.lilnas.io to auth.lilnas.io)
  // stays revocable rather than permanently stuck — validation exists to
  // keep NEW grants confined to known hosts, not to gate removing old ones.
  @Post('users/:userId/services')
  async setUserServices(
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const { changes } = this.parseBody(SetUserServicesBodySchema, body)
    await Promise.all(
      changes
        .filter(change => change.grant)
        .map(change => this.assertKnownServiceHost(change.serviceHost)),
    )
    this.usersService.setUserServices(userId, changes)
    return { ok: true }
  }

  // "Remove" — revokes every current grant; see UsersService.removeUser()'s
  // own comment for why this is NOT the same as block() below.
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

  // S2b: the standalone "revoke all sessions" break-glass action — see
  // UsersService.revokeSessions()'s own comment for why this exists as its
  // own route rather than only ever firing implicitly through block().
  @Post('users/:userId/revoke-sessions')
  revokeSessions(@Param('userId') userId: string): {
    ok: true
    sessionsRevoked: number
  } {
    const sessionsRevoked = this.usersService.revokeSessions(userId)
    return { ok: true, sessionsRevoked }
  }

  // ── Discord links ──────────────────────────────────────────────────────

  // Both halves of the link UI's picker in ONE response. Returned together
  // rather than as two routes because they are never useful apart — the
  // form needs both columns to render at all, and one round trip keeps the
  // two sides consistent with each other (two calls could straddle another
  // admin's link and show an account in the right column that the left
  // column's person had just been linked to).
  //
  // Plain reads with no transaction or cache invalidation to orchestrate,
  // so they call the repo inline here rather than through UsersService —
  // queue()/users() above set that same precedent (see users()'s own
  // comment); UsersService owns the mutations below.
  @Get('discord/unlinked')
  discordUnlinked(): {
    people: DiscordUnlinkedPerson[]
    accounts: DiscordUnlinkedAccount[]
  } {
    return {
      people: listUnlinkedUsers(this.db).map(row => ({
        userId: row.userId,
        email: row.email,
        name: row.name,
      })),
      accounts: listUnlinkedIdentities(this.db).map(row => ({
        discordUserId: row.discordUserId,
        username: row.username,
        displayName: row.displayName,
        firstSeenAt: row.firstSeenAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
      })),
    }
  }

  @Get('discord/links')
  discordLinks(): DiscordLinkEntry[] {
    return listLinks(this.db).map(row => ({
      userId: row.userId,
      email: row.email,
      name: row.name,
      discordUserId: row.discordUserId,
      username: row.username,
      displayName: row.displayName,
      createdAt: row.createdAt.toISOString(),
    }))
  }

  // POST with a body rather than POST /discord/:userId/link, unlike the
  // user routes above: the identifying pair here is (person, account), and
  // putting half of it in the path and half in a body would split one
  // logical selection across two places. Still a POST, never a PUT/DELETE —
  // every mutation in this controller is a POST (see /remove, /block).
  //
  // Both ids are validated by LinkDiscordBodySchema; everything ELSE — does
  // this user exist, has this account ever been seen, is either side
  // already linked — is UsersService.linkDiscord()'s own concern, because
  // each of those questions has to be answered inside the same transaction
  // as the write. Contrast the service-host validation above, which is
  // genuinely a registry question this controller owns and no transaction
  // can help with.
  @Post('discord/link')
  linkDiscord(@Body() body: unknown): { ok: true } {
    const { userId, discordUserId } = this.parseBody(
      LinkDiscordBodySchema,
      body,
    )
    this.usersService.linkDiscord(userId, discordUserId)
    return { ok: true }
  }

  @Post('discord/unlink')
  unlinkDiscord(@Body() body: unknown): { ok: true } {
    const { userId } = this.parseBody(UnlinkDiscordBodySchema, body)
    this.usersService.unlinkDiscord(userId)
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

  // S3: every mutating route's @Body() is typed `unknown` and validated
  // here rather than trusted at face value — see admin.dto.ts's own header
  // comment for why a TypeScript annotation alone (the previous shape of
  // every route below) is not a real check at runtime.
  private parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'Invalid request body',
      )
    }
    return parsed.data
  }
}
