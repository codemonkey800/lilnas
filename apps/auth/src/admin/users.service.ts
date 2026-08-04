import { Inject, Injectable } from '@nestjs/common'

import { DB, type Db } from 'src/db/database.module'
import {
  deleteGrant,
  deletePreAuthorizedGrant,
  findPreAuthorizedGrantsByEmail,
  findUserByEmail,
  grantExists,
  insertGrant,
  insertPreAuthorizedGrant,
  listGrantsForUser,
  setBlockedAt,
} from 'src/grants/grants.repo'
import { NotifyBusService } from 'src/sse/notify-bus.service'
import { AccessCacheService } from 'src/verify/access-cache.service'

import { normalizeEmail } from './normalize-email'

// ──────────────────────────────────────────────────────────────────────────────
// U9 (R14, R15, R16; AE6): the admin user-management write surface. Not in
// the plan's literal file list (which names only "Modify:
// admin.controller.ts, grants.repo.ts, access-cache.service.ts") — added as
// the necessary home for these mutations' own transaction + cache-
// invalidation orchestration, the same "flagged, necessary addition"
// pattern U6's requests.controller.ts and U7's admin.controller.ts already
// established for this app. Mirrors requests.service.ts's own shape: every
// method here wraps its DB write(s) in one BEGIN IMMEDIATE transaction,
// then — outside the transaction, in that order — updates
// AccessCacheService's in-memory maps. AdminController stays the thin
// caller (and owns service-host-against-the-registry validation, mirroring
// requests.controller.ts's own parseServiceHost() precedent of validating
// at the controller layer) — this class assumes its inputs are already
// valid.
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
  ) {}

  /**
   * R15's "add by email." Two branches, both idempotent:
   *
   * - The email already has a `user` row (a real, signed-in identity) —
   *   write a REAL grant immediately, exactly like an admin approving a
   *   request (U7). "Attaches to the existing user rather than creating a
   *   duplicate" (U9's own edge-case wording) is this branch's entire
   *   point: there is no reason to route through the pending-by-email
   *   mechanism for someone who has already signed in. Also consumes any
   *   pre_authorized_grant row already pending for this exact (email,
   *   serviceHost) pair — without this, a later
   *   AccessCacheService.bindPreAuthorizedGrant() call for the same pair
   *   would find a real grant AND a pending row both present and throw on
   *   grant's own unique index (see that method's own comment on the
   *   grantExists guard it needs specifically because of this).
   * - No `user` row yet — insert a pending, email-keyed
   *   pre_authorized_grant row (schema.ts's own table for exactly this
   *   case) and register it with AccessCacheService so R15's "first
   *   sign-in passes straight through" holds from the very next verify —
   *   see AccessCacheService.bindPreAuthorizedGrant()'s own header comment
   *   for the full binding design.
   *
   * The existing-user lookup and the pre-authorized-rows read both happen
   * INSIDE the same `tx` this method writes under (not via the plain live
   * `db`, as this used to) — per
   * docs/solutions/conventions/begin-immediate-for-read-then-write-mutations-2026-05-27.md,
   * every other read-then-write mutation in this app already reads inside
   * its own transaction; this was the one that read outside it.
   *
   * `rawEmail` is normalized (trim + lowercase) before ANY use — the
   * lookup, the DB write, and the cache write all key off the SAME
   * normalized form, matching seed-whitelist.ts's identical normalization
   * and what AccessCacheService.bindPreAuthorizedGrant()'s own lookup now
   * requires to ever match a real sign-in's Google-provided email.
   */
  preAuthorize(rawEmail: string, serviceHost: string): void {
    const email = normalizeEmail(rawEmail)

    const result = this.db.transaction(
      tx => {
        const existingUser = findUserByEmail(tx, email)
        if (existingUser) {
          if (!grantExists(tx, existingUser.id, serviceHost)) {
            insertGrant(tx, existingUser.id, serviceHost, new Date())
          }
          for (const row of findPreAuthorizedGrantsByEmail(tx, email)) {
            if (row.serviceHost === serviceHost) {
              deletePreAuthorizedGrant(tx, row.id)
            }
          }
          return { kind: 'granted' as const, userId: existingUser.id }
        }

        insertPreAuthorizedGrant(tx, email, serviceHost, new Date())
        return { kind: 'pre-authorized' as const }
      },
      { behavior: 'immediate' },
    )

    if (result.kind === 'granted') {
      this.accessCache.addGrant(result.userId, serviceHost)
      this.accessCache.removePreAuthorization(email, serviceHost)
    } else {
      this.accessCache.addPreAuthorization(email, serviceHost)
    }
    this.notifyBus.publishAdminChange()
  }

  /**
   * R15's "edit a user's services" — a SINGLE-HOST mutation (grant or
   * revoke exactly one (userId, serviceHost) pair), not a full-desired-set
   * diff. This replaces the earlier editServices(userId, string[]) design,
   * which took the admin UI's complete checkbox-list state and computed
   * the add/remove diff against current grants itself — a shape that made
   * every checkbox toggle implicitly authoritative over every OTHER
   * service that same user holds. Two ways that went wrong in practice:
   *
   * - A stale client-side `user.services` snapshot (e.g. right after
   *   preAuthorizeUser() granted a service directly, with no revalidation
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
   * A single-host mutation has no wire-level way to express either
   * failure mode: there is no "complete set" a stale snapshot could get
   * wrong, and revoking an off-registry stale grant never re-validates
   * hosts the admin isn't touching (AdminController only validates when
   * `grant: true` — see that file's own comment).
   */
  setUserService(userId: string, serviceHost: string, grant: boolean): void {
    if (grant) {
      const granted = this.db.transaction(
        tx => {
          if (grantExists(tx, userId, serviceHost)) {
            return false
          }
          insertGrant(tx, userId, serviceHost, new Date())
          return true
        },
        { behavior: 'immediate' },
      )
      if (granted) {
        this.accessCache.addGrant(userId, serviceHost)
        this.notifyBus.publishAdminChange()
      }
      return
    }

    this.db.transaction(
      tx => {
        deleteGrant(tx, userId, serviceHost)
      },
      { behavior: 'immediate' },
    )
    this.accessCache.removeGrant(userId, serviceHost)
    this.notifyBus.publishAdminChange()
  }

  /**
   * R15's "remove" — revokes every CURRENT grant, but deliberately leaves
   * the `user` row (and its permanent everGrantedAt marker, schema.ts's
   * own R14 mechanism) untouched. This is "un-authorize," not "ban": a
   * removed user falls back to the normal no-grant flow (pending page,
   * can request again) exactly like someone who was never granted
   * anything — R16's block() below is the separate, stronger action for
   * "must never reach anything again." Confirmed as the right reading by
   * this unit's own edge-case wording ("removing a user with an active
   * session immediately stops that session from passing verify") — that
   * claim is only interesting if the user ROW and SESSION still exist; if
   * "remove" deleted the user row, the session would already be gone via
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
   * R16 (AE6): writes user.blockedAt, then updates
   * AccessCacheService.blockUser()'s in-memory Set — "it must take effect
   * on the very next verify" (this unit's own Verification bullet) is
   * exactly what that in-memory write buys, matching U5's own
   * checked-fresh-every-decision design for isBlocked().
   */
  blockUser(userId: string): void {
    const now = new Date()
    this.db.transaction(
      tx => {
        setBlockedAt(tx, userId, now)
      },
      { behavior: 'immediate' },
    )
    this.accessCache.blockUser(userId)
    this.notifyBus.publishAdminChange()
  }

  unblockUser(userId: string): void {
    this.db.transaction(
      tx => {
        setBlockedAt(tx, userId, null)
      },
      { behavior: 'immediate' },
    )
    this.accessCache.unblockUser(userId)
    this.notifyBus.publishAdminChange()
  }
}
