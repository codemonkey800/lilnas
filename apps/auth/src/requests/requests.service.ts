import { Inject, Injectable, NotFoundException } from '@nestjs/common'

import { DB, type Db } from 'src/db/database.module'
import type { AccessRequestRow } from 'src/db/schema'
import { grantExists, insertGrant } from 'src/grants/grants.repo'
import { NotifyBusService } from 'src/sse/notify-bus.service'
import { AccessCacheService } from 'src/verify/access-cache.service'

import {
  type Executor,
  findById,
  findLatestRequest,
  insertPendingRequest,
  markDecided,
  touchLastSeen,
} from './requests.repo'

// ──────────────────────────────────────────────────────────────────────────────
// U6 (R5, R6, R8, R12): the request lifecycle's write side. VerifyService
// (U5) never writes here directly — it only redirects to the pending page;
// this service's methods are the ones the pending page's own status check
// and re-request action call. See requestAccess()'s own comment for the full
// reasoning on why an "automatic on load" path and an "explicit action" path
// are kept distinct, rather than the single "no-grant branch now creates or
// absorbs" merge the plan's file list describes.
//
// Rejection visibility (post-launch revision): R7's original design made a
// rejection completely invisible (see git history for that version of this
// file/its comments). That call was deliberately reversed after the first
// real cutover — a rejected user is now told inline, on the pending page
// itself, via a live SSE push, and signing in again always starts a fresh
// request with no cooldown. `RequestStatus`'s `'rejected'` outcome and the
// removal of `canReRequest`/the cooldown machinery below are the result.
//
// Blocked-account opacity (second post-launch revision): R16's original
// design kept a BLOCKED account fully indistinguishable from an ordinary
// pending request — see requests.controller.ts's own header comment for
// where that separate mechanism is checked, BEFORE this service is ever
// reached. That opacity was also deliberately reversed: a blocked user is
// now told, on a dedicated /blocked page. This service's own methods are
// unaffected either way (isBlocked is checked in requests.controller.ts,
// never here), but is noted here since a reader of THIS file's history
// would otherwise see only the still-accurate rejection-visibility story
// above and wrongly assume blocked accounts are still opaque too.
//
// Admin dashboard live updates: every method below that actually creates or
// decides a row also calls NotifyBusService.publishAdminChange() — the same
// bus the per-(user,serviceHost) publishStatusChange() calls already use,
// just a second, broadcast-style topic (see notify-bus.service.ts). This is
// deliberately NOT gated behind the same "did anything actually change"
// checks these methods already perform for their OWN correctness (e.g.
// rejectRequest()'s no-op-on-already-decided guard) — reusing those same
// guards is what keeps a no-op call from ever refreshing every open admin
// dashboard for nothing.
//
// Both public methods below run under BEGIN IMMEDIATE, per
// docs/solutions/conventions/begin-immediate-for-read-then-write-mutations-2026-05-27.md:
// this is a textbook read-then-write race (two concurrent status checks or
// tab loads for the same pair must not both pass "no pending row exists" and
// both insert). See requests.service.spec.ts's atomicity test, written per
// docs/solutions/conventions/atomicity-tests-must-reach-the-write-phase-2026-06-03.md
// (seeded so both guards pass and a real write runs before the injected
// fault, not a vacuous guard-refusal test).
// ──────────────────────────────────────────────────────────────────────────────

export type RequestStatus = { outcome: 'pending' } | { outcome: 'rejected' }

@Injectable()
export class RequestsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly accessCache: AccessCacheService,
    private readonly notifyBus: NotifyBusService,
  ) {}

  /**
   * The AUTOMATIC path — called on every pending-page load and every SSE
   * reconnect (never on a bare keepalive). Absorbs a repeat visit into an
   * existing pending row (R6/AE1) and reports a decided rejection as-is, but
   * NEVER itself creates a fresh row once the current row is a decided
   * rejection — creating that fresh row is reRequestAccess()'s job alone,
   * gated on the explicit sign-in-again action on `/login`. If this path
   * minted a fresh row the instant a status check discovered a rejection,
   * the live SSE push would put the request right back in the admin's queue
   * within moments of them rejecting it.
   *
   * Also the FIRST-EVER request's entry point (R5): no prior row at all
   * unconditionally creates one.
   */
  requestAccess(userId: string, serviceHost: string): RequestStatus {
    const { status, isNewRequest } = this.db.transaction(
      tx => this.absorb(tx, userId, serviceHost),
      { behavior: 'immediate' },
    )
    // Only a genuinely NEW row is admin-dashboard news — the touch-lastSeen
    // re-absorb branch and the already-decided-rejection branch both leave
    // the queue's own contents unchanged, so publishing for them would
    // refresh every open admin dashboard for nothing.
    if (isNewRequest) {
      this.notifyBus.publishAdminChange()
    }
    return status
  }

  /**
   * The EXPLICIT path — called only from the `/login` sign-in click when the
   * user is returning after a rejection (see login-form.tsx). No cooldown:
   * a rejected row always starts a fresh pending request immediately, and
   * the prior rejected row is left in place as history (R12). Still guards
   * against duplicating a row that's already pending (a double-click, or a
   * race with the automatic absorb path) — that guard is what keeps removing
   * the cooldown from becoming a self-service spam vector, since minting a
   * SECOND fresh row still requires an admin to reject the first one again.
   */
  reRequestAccess(userId: string, serviceHost: string): void {
    // The transaction reports whether it actually inserted a fresh row —
    // needed so the publish below only fires for that branch, same
    // "genuinely new row" gate as requestAccess()/absorb() above.
    const isNewRequest = this.db.transaction(
      tx => {
        const now = new Date()
        const existing = findLatestRequest(tx, userId, serviceHost)

        if (existing?.status === 'pending') {
          // Lost the race with a concurrent automatic absorb, or a
          // double-click — either way there is already a live pending row;
          // touch it rather than attempt a second INSERT the partial
          // unique index would reject anyway.
          touchLastSeen(tx, existing.id, now)
          return false
        }

        if (!existing || existing.status === 'rejected') {
          insertPendingRequest(tx, userId, serviceHost, now)
          return true
        }

        // Anything else (e.g. a defensive 'approved' row) — nothing to
        // re-request.
        return false
      },
      { behavior: 'immediate' },
    )
    if (isNewRequest) {
      this.notifyBus.publishAdminChange()
    }
  }

  /**
   * U7 (R11): approve a specific queue row. The DB writes (mark decided +
   * insert the grant) happen together under BEGIN IMMEDIATE — a paired
   * write per
   * docs/solutions/conventions/begin-immediate-for-read-then-write-mutations-2026-05-27.md's
   * "createExercise" example, not a read-then-branch race — then, OUTSIDE
   * the transaction and in this exact order, the in-memory cache is
   * invalidated and the SSE bus is published. That ordering (write DB ->
   * invalidate cache -> publish) is the plan's own Key Technical Decision:
   * publishing before invalidating would race the waiting user's redirect
   * against a stale cache and bounce them straight back to pending.
   * Idempotent: approving an already-approved row, or one whose grant
   * already exists (e.g. a concurrent U9 edit), re-publishes but writes
   * nothing new.
   */
  approveRequest(id: number): void {
    const request = this.db.transaction(
      tx => {
        const row = findById(tx, id)
        if (!row) {
          throw new NotFoundException(`access_request ${id} not found`)
        }
        const now = new Date()
        if (row.status !== 'approved') {
          markDecided(tx, id, 'approved', now)
        }
        if (!grantExists(tx, row.userId, row.serviceHost)) {
          insertGrant(tx, row.userId, row.serviceHost, now)
        }
        return row
      },
      { behavior: 'immediate' },
    )

    this.accessCache.addGrant(request.userId, request.serviceHost)
    this.notifyBus.publishStatusChange(request.userId, request.serviceHost)
    this.notifyBus.publishAdminChange()
  }

  /**
   * U7 (R11), revised for rejection visibility: reject a specific queue row.
   * Writes the decision and, on a genuine decision only, publishes a live
   * SSE signal on the same bus approve uses — an already-open `/pending` tab
   * redirects to `/login` immediately rather than waiting for its next poll.
   * No cache-invalidation step here (unlike approve) — the rejected-outcome
   * read path is never cached. Only a currently-PENDING row is actually
   * decided; rejecting an already-decided row (approved or already
   * rejected) is a no-op rather than an error, since the queue UI only
   * ever shows pending rows and a double-click or a second admin racing on
   * the same row should not surface a failure, and must not publish either.
   *
   * The decided row is captured INSIDE the transaction (needed for its
   * userId/serviceHost) but the publish itself happens OUTSIDE it, same
   * ordering rationale as approveRequest(). The externally-visible return
   * value stays a plain `boolean` — whether a decision was ACTUALLY made
   * (`false` for the no-op case) — matching admin.controller.ts's existing
   * `{ ok: true, decided: boolean }` contract and queue-client.tsx's own
   * comment on why that distinction matters (#24 from REVIEW.md).
   */
  rejectRequest(id: number): boolean {
    const decidedRow = this.db.transaction(
      tx => {
        const row = findById(tx, id)
        if (!row) {
          throw new NotFoundException(`access_request ${id} not found`)
        }
        if (row.status !== 'pending') {
          return null
        }
        markDecided(tx, id, 'rejected', new Date())
        return row
      },
      { behavior: 'immediate' },
    )

    if (decidedRow) {
      this.notifyBus.publishStatusChange(
        decidedRow.userId,
        decidedRow.serviceHost,
      )
      this.notifyBus.publishAdminChange()
    }
    return decidedRow !== null
  }

  /**
   * U7 (R10): the queue's bulk-dismiss action. One transaction for the
   * whole batch (all-or-nothing) rather than N independent ones. Silently
   * skips any id that no longer exists or is no longer pending (e.g.
   * another admin already decided it) instead of throwing — a bulk action
   * over a batch the admin selected a moment ago should not fail entirely
   * because one row moved on in the meantime.
   *
   * Same rejection-visibility treatment as rejectRequest() above: the
   * actually-decided ROWS (not just ids) are collected inside the
   * transaction, then published once per row outside it. The external
   * return value stays the ids ACTUALLY decided (a subset of `ids`),
   * matching admin.controller.ts's existing contract.
   */
  bulkReject(ids: number[]): number[] {
    const decidedRows = this.db.transaction(
      tx => {
        const now = new Date()
        const rows: AccessRequestRow[] = []
        for (const id of ids) {
          const row = findById(tx, id)
          if (row?.status === 'pending') {
            markDecided(tx, id, 'rejected', now)
            rows.push(row)
          }
        }
        return rows
      },
      { behavior: 'immediate' },
    )

    for (const row of decidedRows) {
      this.notifyBus.publishStatusChange(row.userId, row.serviceHost)
    }
    // Once per BATCH, not once per row — unlike the per-row
    // publishStatusChange() calls above (each one targets a different
    // subscriber's own topic, so every one is genuinely new information to
    // ITS subscriber), every admin dashboard subscribes to the same flat
    // topic, so N publishes here would just refresh it N times for one
    // logical change.
    if (decidedRows.length > 0) {
      this.notifyBus.publishAdminChange()
    }
    return decidedRows.map(row => row.id)
  }

  private absorb(
    tx: Executor,
    userId: string,
    serviceHost: string,
  ): { status: RequestStatus; isNewRequest: boolean } {
    const now = new Date()
    const existing = findLatestRequest(tx, userId, serviceHost)

    if (!existing) {
      insertPendingRequest(tx, userId, serviceHost, now)
      return { status: { outcome: 'pending' }, isNewRequest: true }
    }

    if (existing.status === 'pending') {
      touchLastSeen(tx, existing.id, now)
      return { status: { outcome: 'pending' }, isNewRequest: false }
    }

    if (existing.status === 'rejected') {
      return { status: { outcome: 'rejected' }, isNewRequest: false }
    }

    // 'approved' should not be reachable here in practice — VerifyService's
    // own grant check (U5) would already have allowed the request before
    // ever redirecting to pending. Handled defensively (report the
    // pending-equivalent "nothing to do" shape) rather than assumed
    // impossible, matching this app's general fail-safe posture.
    return { status: { outcome: 'pending' }, isNewRequest: false }
  }
}
