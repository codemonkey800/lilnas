import type {
  DiscordIdentity,
  DiscordLinkedUser,
  DiscordLinkLookupResponse,
} from '@lilnas/utils/auth/types'
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
} from '@nestjs/common'
import type { z } from 'zod'

import { DB, type Db } from 'src/db/database.module'
import {
  findIdentity,
  findLinkByDiscordUserId,
  findLinkByEmail,
  findLinkByUserId,
  upsertIdentity,
} from 'src/db/discord-link.repo'

import { RegisterDiscordIdentityBodySchema } from './discord-internal.dto'

// ──────────────────────────────────────────────────────────────────────────────
// The Discord half of this app's INTERNAL (server-to-server) surface. Two
// controllers, one read and one write, registered flat in app.module.ts's
// `controllers` array alongside AdminCheckController — this app has no
// per-feature modules.
//
// Consumers: apps/download (resolving the Discord account behind a job into a
// lilnas person) and apps/tdr-bot (reporting the Discord account that just ran
// /download). Both reach these routes through
// packages/utils/src/auth/client.ts's AuthClient, which is the wire contract
// these responses must satisfy — note that it validates the lookup envelope
// only SHALLOWLY (`isObjectOrNull` on each half, no inner-field check), so a
// partial `identity` would be cast to a complete one and lie to the caller.
// Both halves below are therefore always built whole or left null.
// ──────────────────────────────────────────────────────────────────────────────

// Shared by both routes below, mirroring admin.controller.ts's private
// parseBody()/its 400-on-first-issue shape. Module-scoped rather than a
// method on either class because both controllers in this file want it and
// neither owns the other.
function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new BadRequestException(
      parsed.error.issues[0]?.message ?? 'Invalid request body',
    )
  }
  return parsed.data
}

// A query parameter that is present-but-empty (`?email=`) is treated as
// absent. Express hands back '' for that, and counting it as "supplied" would
// turn a caller's empty variable into a lookup for the empty string — a
// guaranteed miss reported as a legitimate "not linked" — instead of the 400
// the exactly-one rule is there to produce.
function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

const NOT_FOUND: DiscordLinkLookupResponse = { identity: null, user: null }

// Guard-free by design, exactly like admin/admin-check.controller.ts — see
// that file's comment for the full precedent. The short version: port 8081
// (where every one of this app's Nest routes lives) has no Traefik router at
// all and publishes no host port, so it is reached only container-to-container
// on the shared Docker network, the same mechanism Traefik's own
// forwardauth.address=http://auth:8081/verify uses. The network IS the trust
// boundary here; there is no session cookie to check because the callers
// (apps/download's DiscordLinkService, apps/tdr-bot) are servers with no
// session of their own.
//
// No @UseGuards(ThrottlerGuard) either, for the same reason AdminCheckController
// and VerifyController skip it: this is a container-to-container path called
// once per Discord-attributed job render, and the app's default tiers (5/min
// from one IP — and behind a shared Docker network every caller is effectively
// one IP) would make the route useless rather than safer.
@Controller('internal')
export class DiscordLinkLookupController {
  constructor(@Inject(DB) private readonly db: Db) {}

  // Exactly one of the three keys, enforced here rather than by three separate
  // routes: the caller-side contract
  // (packages/utils/src/auth/types.ts's DiscordLinkLookupParams) is a union of
  // three single-key objects, and one route keeps the "these are three ways of
  // asking the same question" relationship visible in one place.
  //
  // Always HTTP 200 when this app answers at all, never a 404 for a miss —
  // types.ts spells out why: keeping "unknown" a 200 leaves a 404 meaning
  // "this auth deploy predates the route", which is what lets a caller that
  // fails open tell deploy skew apart from a real answer.
  @Get('discord-link')
  discordLink(
    @Query('discordUserId') rawDiscordUserId?: string,
    @Query('userId') rawUserId?: string,
    @Query('email') rawEmail?: string,
  ): DiscordLinkLookupResponse {
    const discordUserId = present(rawDiscordUserId)
    const userId = present(rawUserId)
    const email = present(rawEmail)

    const supplied = [discordUserId, userId, email].filter(
      value => value !== undefined,
    )
    if (supplied.length !== 1) {
      throw new BadRequestException(
        'Supply exactly one of discordUserId, userId, or email',
      )
    }

    if (discordUserId) {
      return this.byDiscordUserId(discordUserId)
    }

    if (userId) {
      const link = findLinkByUserId(this.db, userId)
      // No link means there is nothing this app can say about the caller's
      // user in DISCORD terms — the `identity` half is only ever reachable
      // from this direction through the link — so both halves are null even
      // for a user row that certainly exists.
      return link ? this.byDiscordUserId(link.discordUserId) : NOT_FOUND
    }

    // email. findLinkByEmail() lowers BOTH sides of the comparison (see its
    // own comment): `user.email` is written by Better Auth straight from
    // Google's userinfo and never normalized, so matching a normalized
    // argument against the raw column would report "not linked" for someone
    // who is. Any email-keyed lookup added here must keep using it rather
    // than grants.repo.ts's findUserByEmail().
    const link = email ? findLinkByEmail(this.db, email) : undefined
    return link ? this.byDiscordUserId(link.discordUserId) : NOT_FOUND
  }

  // All three directions funnel through here, so the three null-shapes the
  // contract describes are produced in exactly one place:
  //
  //   unseen snowflake     -> { identity: null, user: null }
  //   observed but unlinked -> { identity: {...}, user: null }
  //   linked                -> both present
  //
  // Note that the second half is a genuinely separate query and not derivable
  // from the first: findIdentity() returns the roster row (which knows nothing
  // about any lilnas user), while findLinkByDiscordUserId() joins through
  // discord_link to `user` and returns precisely a DiscordLinkedUser.
  private byDiscordUserId(discordUserId: string): DiscordLinkLookupResponse {
    const row = findIdentity(this.db, discordUserId)

    // Projected field-by-field rather than spread: DiscordIdentityRow also
    // carries firstSeenAt/lastSeenAt, which are this app's own bookkeeping and
    // not part of the wire contract. Serializing them would ship Date objects
    // no caller asked for and quietly widen the published shape.
    const identity: DiscordIdentity | null = row
      ? {
          discordUserId: row.discordUserId,
          username: row.username,
          displayName: row.displayName,
        }
      : null

    const user: DiscordLinkedUser | null =
      findLinkByDiscordUserId(this.db, discordUserId) ?? null

    return { identity, user }
  }
}

// The ONE write endpoint on this app's internal surface, and the reason it is
// split into its own guard-free class rather than hidden among the reads:
// everything said above about the trust boundary applies here too, which means
// ANY container on the shared Docker network can call this and append to (or
// relabel a row in) the discord_identity roster. That is accepted
// deliberately, so the blast radius is worth stating plainly.
//
// What a rogue caller on the network could do: create a roster entry for a
// snowflake nobody has seen, or overwrite the cached username/displayName of
// an account that already exists. That is a wrong LABEL on the admin's
// link-picker list — nothing more. What it explicitly CANNOT do:
//
//   - create a link. discord_link is written only by the admin UI, behind
//     AdminGuard; this route never touches that table.
//   - delete or move a link. Renaming an identity does not repoint anything;
//     the link keys off discord_user_id, which this route never changes (it is
//     the lookup key, not a writable field).
//   - grant access to anything. The roster confers no authorization at all —
//     it is an observation log.
//
// So the worst outcome is an admin seeing a misleading display name next to an
// UNLINKED Discord account in a picker, which the admin resolves by not
// linking it. The schema's "never accept a hand-typed Discord handle" rule
// (schema.ts) is what keeps that outcome bounded: labels are cosmetic, and
// nothing in this system keys off them.
@Controller('internal')
export class DiscordIdentityController {
  constructor(@Inject(DB) private readonly db: Db) {}

  // Idempotent by construction: upsertIdentity() re-posts of an unchanged
  // identity are one SELECT plus one UPDATE that writes the same labels back
  // and bumps lastSeenAt, reporting 'unchanged'. Callers (tdr-bot on every
  // /download invocation) can therefore fire this unconditionally rather than
  // tracking what they have already registered.
  //
  // The outcome upsertIdentity() distinguishes ('inserted' | 'updated' |
  // 'unchanged') is intentionally NOT returned: AuthClient.registerDiscordIdentity()
  // ignores the body entirely, and a bare { ok: true } keeps this free to stay
  // best-effort on the caller's side. The distinction still exists in the repo
  // for the admin-notification consumer that wants it.
  @Post('discord-identity')
  registerIdentity(@Body() body: unknown): { ok: true } {
    const input = parseBody(RegisterDiscordIdentityBodySchema, body)

    // BEGIN IMMEDIATE because upsertIdentity() is read-then-write — the house
    // convention for that shape. Without it, two observations of the same
    // brand-new snowflake arriving together would race between the SELECT and
    // the INSERT, and the loser would throw on the discord_user_id primary
    // key. tdr-bot posting once per command makes that a real (if rare) shape,
    // not a theoretical one.
    this.db.transaction(tx => upsertIdentity(tx, input, new Date()), {
      behavior: 'immediate',
    })

    return { ok: true }
  }
}
