import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { revokeSessionsForUser } from 'src/db/auth-session.repo'
import { DB, type Db } from 'src/db/database.module'
import {
  deleteLinkForUser,
  findIdentity,
  findLinkByDiscordUserId,
  findLinkByUserId,
  insertLink,
} from 'src/db/discord-link.repo'
import {
  deleteGrant,
  deletePreAuthorizedGrant,
  findPreAuthorizedGrantsByEmail,
  findUserByEmail,
  findUserById,
  grantExists,
  insertGrant,
  insertPreAuthorizedGrant,
  listGrantsForUser,
  setBlockedAt,
} from 'src/grants/grants.repo'
import { NotifyBusService } from 'src/sse/notify-bus.service'
import { AccessCacheService } from 'src/verify/access-cache.service'

import { normalizeEmail } from './normalize-email'

export type ServiceChange = { serviceHost: string; grant: boolean }

// Kept local rather than graduated into a shared cross-file registry —
// matches access-cache.service.ts's own established per-file convention
// (see that file's LOG_EVENTS comment) for the same reason: not enough
// call sites yet to warrant a shared registry.
const LOG_EVENTS = {
  sessionRevokeRequested: 'admin-session-revoke-requested',
  sessionRevokeCompleted: 'admin-session-revoke-completed',
} as const

// ──────────────────────────────────────────────────────────────────────────────
// The admin user-management write surface — home for these mutations' own
// transaction + cache-invalidation orchestration. Mirrors
// requests.service.ts's own shape: every method here wraps its DB write(s)
// in one BEGIN IMMEDIATE transaction, then — outside the transaction, in
// that order — updates AccessCacheService's in-memory maps. AdminController
// stays the thin caller (and owns service-host-against-the-registry
// validation, mirroring requests.controller.ts's own parseServiceHost()
// precedent of validating at the controller layer) — this class assumes
// its inputs are already valid.
//
// Admin dashboard live updates: every mutation below also calls
// NotifyBusService.publishAdminChange() — the SAME bus and topic
// requests.service.ts's own mutations publish to (see that file's header
// comment) — as its OWN last step, after its own cache-invalidation call.
// A second admin's dashboard reacting to, say, this admin blocking a user
// is exactly the same class of "something changed" this bus already
// exists to carry; there is no reason for it to have a separate mechanism
// just because the write happens to live in this file instead of
// requests.service.ts.
// ──────────────────────────────────────────────────────────────────────────────

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly accessCache: AccessCacheService,
    private readonly notifyBus: NotifyBusService,
    private readonly logger: PinoLogger,
  ) {}

  /**
   * "Add by email," in M3's batched form — every serviceHost in ONE BEGIN
   * IMMEDIATE transaction rather than the admin dashboard's old
   * per-checkbox loop (one HTTP round trip and one transaction per host).
   * Two branches, both idempotent, now applied per host:
   *
   * - The email already has a `user` row (a real, signed-in identity) —
   *   write a REAL grant immediately, exactly like an admin approving a
   *   request. Attaching to the existing user rather than creating a
   *   duplicate is this branch's entire point: there is no reason to
   *   route through the pending-by-email mechanism for someone who has
   *   already signed in. Also consumes any pre_authorized_grant row
   *   already pending for this exact (email, serviceHost) pair — without
   *   this, a later AccessCacheService.bindPreAuthorizedGrant() call for
   *   the same pair would find a real grant AND a pending row both
   *   present and throw on grant's own unique index (see that method's
   *   own comment on the grantExists guard it needs specifically because
   *   of this).
   * - No `user` row yet — insert a pending, email-keyed
   *   pre_authorized_grant row (schema.ts's own table for exactly this
   *   case) and register it with AccessCacheService so a first sign-in
   *   passes straight through from the very next verify — see
   *   AccessCacheService.bindPreAuthorizedGrant()'s own header comment
   *   for the full binding design.
   *
   * The existing-user lookup and the pre-authorized-rows read both happen
   * INSIDE the same `tx` this method writes under (not via the plain live
   * `db`, as this used to) — per
   * docs/archive/solutions/conventions/begin-immediate-for-read-then-write-mutations-2026-05-27.md,
   * every other read-then-write mutation in this app already reads inside
   * its own transaction; this was the one that read outside it.
   *
   * `rawEmail` is normalized (trim + lowercase) before ANY use — the
   * lookup, the DB write, and the cache write all key off the SAME
   * normalized form, matching what AccessCacheService.
   * bindPreAuthorizedGrant()'s own lookup requires to ever match a real
   * sign-in's Google-provided email.
   */
  preAuthorizeMany(rawEmail: string, serviceHosts: string[]): void {
    const email = normalizeEmail(rawEmail)

    const result = this.db.transaction(
      tx => {
        const existingUser = findUserByEmail(tx, email)
        if (existingUser) {
          for (const serviceHost of serviceHosts) {
            if (!grantExists(tx, existingUser.id, serviceHost)) {
              insertGrant(tx, existingUser.id, serviceHost, new Date())
            }
            for (const row of findPreAuthorizedGrantsByEmail(tx, email)) {
              if (row.serviceHost === serviceHost) {
                deletePreAuthorizedGrant(tx, row.id)
              }
            }
          }
          return { kind: 'granted' as const, userId: existingUser.id }
        }

        for (const serviceHost of serviceHosts) {
          insertPreAuthorizedGrant(tx, email, serviceHost, new Date())
        }
        return { kind: 'pre-authorized' as const }
      },
      { behavior: 'immediate' },
    )

    if (result.kind === 'granted') {
      for (const serviceHost of serviceHosts) {
        this.accessCache.addGrant(result.userId, serviceHost)
        this.accessCache.removePreAuthorization(email, serviceHost)
      }
    } else {
      for (const serviceHost of serviceHosts) {
        this.accessCache.addPreAuthorization(email, serviceHost)
      }
    }
    this.notifyBus.publishAdminChange()
  }

  // Single-host convenience wrapper — kept for callers (this file's own
  // test suite included) that only ever have one host in hand. Every real
  // behavior lives in preAuthorizeMany() above.
  preAuthorize(rawEmail: string, serviceHost: string): void {
    this.preAuthorizeMany(rawEmail, [serviceHost])
  }

  /**
   * "Edit a user's services" — a set of EXPLICIT (serviceHost, grant)
   * deltas, not a full-desired-set diff, applied in ONE BEGIN IMMEDIATE
   * transaction (M3: the admin dashboard used to call the
   * single-host form of this once per checkbox — one HTTP round trip and
   * one transaction per host). This replaces the earlier
   * editServices(userId, string[]) design, which took the admin UI's
   * complete checkbox-list state and computed the add/remove diff against
   * current grants itself — a shape that made every checkbox toggle
   * implicitly authoritative over every OTHER service that same user
   * holds. Two ways that went wrong in practice:
   *
   * - A stale client-side `user.services` snapshot (e.g. right after
   *   preAuthorizeMany() granted a service directly, with no revalidation
   *   anywhere in this app) meant the NEXT unrelated checkbox toggle would
   *   silently revoke that just-granted service — it was simply missing
   *   from the "desired" array the stale client sent.
   * - Every host in the full submitted set — including ones the admin
   *   never touched this click — was re-validated against the service
   *   registry. A host that later dropped out of the registry (e.g. this
   *   app's own cutover, which renamed login.lilnas.io to auth.lilnas.io —
   *   itself in HOST_BLOCKLIST) would then fail that validation on every
   *   subsequent toggle for that user, permanently locking their whole row
   *   from further edits.
   *
   * A set of explicit deltas has no wire-level way to express either
   * failure mode: there is no "complete set" a stale snapshot could get
   * wrong, and revoking an off-registry stale grant never re-validates
   * hosts the admin isn't touching (AdminController only validates a
   * change with `grant: true` — see that file's own comment). Each change
   * is applied independently and in array order; a grant that's already
   * held, or a revoke of a host never granted, is a no-op for that one
   * entry rather than an error for the whole batch.
   */
  setUserServices(userId: string, changes: ServiceChange[]): void {
    const grantedHosts: string[] = []
    const revokedHosts: string[] = []

    this.db.transaction(
      tx => {
        for (const { serviceHost, grant } of changes) {
          if (grant) {
            if (!grantExists(tx, userId, serviceHost)) {
              insertGrant(tx, userId, serviceHost, new Date())
              grantedHosts.push(serviceHost)
            }
          } else {
            deleteGrant(tx, userId, serviceHost)
            revokedHosts.push(serviceHost)
          }
        }
      },
      { behavior: 'immediate' },
    )

    for (const serviceHost of grantedHosts) {
      this.accessCache.addGrant(userId, serviceHost)
    }
    for (const serviceHost of revokedHosts) {
      this.accessCache.removeGrant(userId, serviceHost)
    }
    // Same "only publish on a genuine change" gate as removeUser() below —
    // a batch where every grant was already held and every revoke target
    // was already absent has nothing new to tell the dashboard. A revoke
    // entry always counts as a change regardless of whether the grant
    // actually existed (deleteGrant is a no-op DELETE either way, but the
    // admin's intent — "this box is now unchecked" — is a real action).
    if (grantedHosts.length > 0 || revokedHosts.length > 0) {
      this.notifyBus.publishAdminChange()
    }
  }

  // Single-host convenience wrapper — kept for callers (this file's own
  // test suite included) that only ever have one (serviceHost, grant) pair
  // in hand. Every real behavior lives in setUserServices() above.
  setUserService(userId: string, serviceHost: string, grant: boolean): void {
    this.setUserServices(userId, [{ serviceHost, grant }])
  }

  /**
   * "Remove" — revokes every CURRENT grant, but deliberately leaves the
   * `user` row (and its permanent everGrantedAt marker, schema.ts's own
   * mechanism for that) untouched. This is "un-authorize," not "ban": a
   * removed user falls back to the normal no-grant flow (pending page,
   * can request again) exactly like someone who was never granted
   * anything — block() below is the separate, stronger action for "must
   * never reach anything again." The claim "removing a user with an
   * active session immediately stops that session from passing verify" is
   * only interesting if the user ROW and SESSION still exist; if "remove"
   * deleted the user row, the session would already be gone via
   * schema.ts's own ON DELETE CASCADE, making the claim trivially true for
   * an uninteresting reason.
   */
  removeUser(userId: string): void {
    // Read INSIDE the same `tx` this method writes under (not the plain
    // live `db`, as this used to) — see preAuthorize()'s own comment on
    // the same convention. This is the revoke-all-access path
    // specifically, where a concurrently-inserted grant reading outside
    // the transaction could survive both the delete loop and the cache
    // eviction below.
    const currentGrants = this.db.transaction(
      tx => {
        const grants = listGrantsForUser(tx, userId)
        for (const { serviceHost } of grants) {
          deleteGrant(tx, userId, serviceHost)
        }
        return grants
      },
      { behavior: 'immediate' },
    )

    for (const { serviceHost } of currentGrants) {
      this.accessCache.removeGrant(userId, serviceHost)
    }
    // Same "only publish on a genuine change" gate as
    // requests.service.ts's bulkReject() — a remove on a user with no
    // current grants (e.g. a double-click) has nothing new to tell the
    // dashboard.
    if (currentGrants.length > 0) {
      this.notifyBus.publishAdminChange()
    }
  }

  /**
   * Writes user.blockedAt, then updates AccessCacheService.blockUser()'s
   * in-memory Set — "it must take effect on the very next verify" is
   * exactly what that in-memory write buys, matching VerifyService's own
   * checked-fresh-every-decision design for isBlocked().
   *
   * S2b: also revokes every session this user currently holds (see
   * revokeSessions() below) — what makes Block a real kill switch rather
   * than a /verify-only gate. Without this, a blocked ADMIN's existing
   * session would keep full, unrestricted /admin access indefinitely,
   * since AdminGuard's own session check is deliberately independent of
   * blockedAt (see verify.service.ts's S2a header comment).
   *
   * S6: throws NotFoundException instead of silently succeeding when
   * `userId` matches no row — see grants.repo.ts's own comment on
   * setBlockedAt's return value for why: without this check, a nonexistent
   * userId would still add a permanent phantom entry to
   * AccessCacheService's blockedUserIds Set.
   */
  blockUser(userId: string): void {
    const now = new Date()
    const changed = this.db.transaction(tx => setBlockedAt(tx, userId, now), {
      behavior: 'immediate',
    })
    if (changed === 0) {
      throw new NotFoundException(`user ${userId} not found`)
    }
    this.accessCache.blockUser(userId)
    this.revokeSessions(userId)
    this.notifyBus.publishAdminChange()
  }

  /**
   * S2b: the "revoke all sessions" break-glass action — mirrors
   * apps/tdr-code/src/console/auth-admin.controller.ts's identical
   * logger.warn-before/logger.warn-after audit-trail shape around the
   * actual repo call (src/db/auth-session.repo.ts's revokeSessionsForUser).
   * Exposed both as a standalone admin action (an operator can revoke
   * sessions without also blocking future access — e.g. "this one cookie
   * looks stolen, but the account itself is fine") and called from
   * blockUser() above, so blocking someone is always a full kill switch.
   *
   * Deliberately does NOT call notifyBus.publishAdminChange() — unlike
   * every other mutation in this file, revoking a session changes no
   * queue/grant/blockedAt state the dashboard renders, so there is nothing
   * for another open admin tab to refresh.
   */
  revokeSessions(userId: string): number {
    this.logger.warn(
      { userId, event: LOG_EVENTS.sessionRevokeRequested },
      'Admin session-revoke requested',
    )
    const sessionsRevoked = revokeSessionsForUser(this.db, userId)
    this.accessCache.invalidateSessionsForUser(userId)
    this.logger.warn(
      { userId, sessionsRevoked, event: LOG_EVENTS.sessionRevokeCompleted },
      'Admin session-revoke completed',
    )
    return sessionsRevoked
  }

  // S6: same NotFoundException-on-zero-rows guard as blockUser() above —
  // see that method's own comment.
  unblockUser(userId: string): void {
    const changed = this.db.transaction(tx => setBlockedAt(tx, userId, null), {
      behavior: 'immediate',
    })
    if (changed === 0) {
      throw new NotFoundException(`user ${userId} not found`)
    }
    this.accessCache.unblockUser(userId)
    this.notifyBus.publishAdminChange()
  }

  // ── Discord link management ────────────────────────────────────────────
  //
  // Neither method below touches AccessCacheService. That is deliberate,
  // not an omission: a Discord link decides ATTRIBUTION (which lilnas
  // person a /download job belongs to), never ACCESS — nothing in
  // VerifyService's decision path reads discord_link, so there is no
  // in-memory access state that could go stale. The only cache downstream
  // of these writes lives in a different app (apps/download's Discord-link
  // TTL cache), reached over HTTP and self-healing by construction; this
  // service has no handle on it and deliberately does not grow one. Same
  // shape of reasoning as revokeSessions()'s own "deliberately does NOT
  // publish" comment above, applied to the other collaborator.

  /**
   * Links a lilnas user to a Discord account, both halves chosen from a
   * list the admin was shown (GET /admin/discord/unlinked) — never typed.
   *
   * discord-link.repo.ts's insertLink() is deliberately NOT
   * onConflictDoNothing(), and its two foreign keys are real, so every one
   * of the four ways this can legitimately fail would otherwise surface as
   * a raw SQLITE_CONSTRAINT error with no useful message. All four are
   * pre-checked here and converted into an exception that tells the admin
   * what to do next. Every one of those reads happens INSIDE the same
   * BEGIN IMMEDIATE transaction as the insert (per
   * docs/archive/solutions/conventions/begin-immediate-for-read-then-write-mutations-2026-05-27.md):
   * checking outside it would leave a window where a concurrent link — the
   * second tab of an admin who double-clicked, or the same admin on two
   * devices — lands between the check and the insert, and the pre-check
   * would have bought nothing over just catching the constraint error.
   *
   * The identical-pair case is a NO-OP SUCCESS rather than an error: a
   * double-submit of the same link is not a mistake worth an error page,
   * and the end state the admin asked for already holds. It notifies
   * nothing (see the `linked` gate below) — same "only publish on a genuine
   * change" rule as removeUser()/setUserServices() above.
   *
   * The two genuine conflicts are BadRequestException rather than a silent
   * replace, which is the one design decision here worth stating outright:
   * both sides of this form came from a picker, so a conflict means the
   * admin's list was stale — someone else linked that account, or this
   * person, since the page loaded. Silently re-pointing a link in that
   * situation would re-attribute every FUTURE Discord job for one of the
   * two accounts to a different human, with nothing in the UI having said
   * so. Making the admin unlink first turns that into an explicit,
   * two-step act.
   */
  linkDiscord(userId: string, discordUserId: string): void {
    const linked = this.db.transaction(
      tx => {
        // Both existence checks first, so a typo'd id reports "no such
        // user"/"never seen" rather than the foreign-key violation it
        // would otherwise become. The identity check is the one that
        // enforces the schema's central rule at the API boundary: a
        // snowflake with no discord_identity row was never OBSERVED, which
        // in practice means it was typed or pasted from somewhere, and
        // that is precisely what this system refuses to record.
        if (!findUserById(tx, userId)) {
          throw new NotFoundException(`user ${userId} not found`)
        }
        if (!findIdentity(tx, discordUserId)) {
          throw new NotFoundException(
            `Discord account ${discordUserId} has never been seen by this system — it can only be linked after it has actually used a Discord command`,
          )
        }

        const existingForUser = findLinkByUserId(tx, userId)
        if (existingForUser?.discordUserId === discordUserId) {
          // Already exactly this pair. Nothing to write, nothing to
          // announce.
          return false
        }

        // Checked BEFORE the same-user conflict below so that when both
        // are true, the admin hears about the other PERSON (naming them,
        // which is the actionable half) rather than about their own
        // subject's existing link. Either message would be true; this one
        // is more useful.
        const existingForAccount = findLinkByDiscordUserId(tx, discordUserId)
        if (existingForAccount) {
          throw new BadRequestException(
            `Discord account already linked to ${existingForAccount.email}`,
          )
        }

        if (existingForUser) {
          throw new BadRequestException(
            `That person is already linked to a different Discord account — unlink them first, then link the new one`,
          )
        }

        insertLink(tx, { userId, discordUserId }, new Date())
        return true
      },
      { behavior: 'immediate' },
    )

    if (linked) {
      this.notifyBus.publishAdminChange()
    }
  }

  /**
   * Unlinks whatever Discord account this user is linked to. Keyed by the
   * person alone because the link is one-to-one both ways — see
   * UnlinkDiscordBodySchema's own comment.
   *
   * A zero-row delete throws NotFoundException rather than reporting an
   * idempotent success. Two reasons, and this is the deliberate call
   * discord-link.repo.ts's deleteLinkForUser() comment asks the caller to
   * make:
   *
   * - It matches this file's established rule for exactly this shape —
   *   blockUser()/unblockUser() both turn setBlockedAt()'s zero-row return
   *   into a NotFoundException (S6) rather than pretending to have done
   *   something.
   * - Unlike a double-clicked "Remove," there is no benign path to this
   *   branch: the Unlink button only renders on a row of the LINKED list,
   *   so reaching it with nothing to delete means the admin's view no
   *   longer matches the database. A silent success would leave them
   *   believing they'd undone a link that someone else had already changed.
   *
   * Note what survives: the discord_identity row. The roster is an
   * observation log, so unlinking asserts "this account is not that
   * person," never "this account was never seen" — the account reappears in
   * the unlinked-accounts column, available to be linked to whoever it
   * actually belongs to.
   */
  unlinkDiscord(userId: string): void {
    const changed = this.db.transaction(tx => deleteLinkForUser(tx, userId), {
      behavior: 'immediate',
    })
    if (changed === 0) {
      throw new NotFoundException(`user ${userId} has no Discord link`)
    }
    this.notifyBus.publishAdminChange()
  }
}
