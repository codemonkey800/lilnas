import { and, count, desc, eq, isNotNull } from 'drizzle-orm'

import type { Db } from 'src/db/database.module'
import { accessRequest, type AccessRequestRow, user } from 'src/db/schema'

// ──────────────────────────────────────────────────────────────────────────────
// U6 (R5, R6, R8, R12): read/write accessors for the access_request lifecycle.
// Parameterized on `Executor` (mirrors apps/swole/src/db/exercises.ts's
// identical pattern) so the same functions run against the live `db` for a
// plain read and against a transaction's `tx` for the read-then-write path in
// requests.service.ts — see that file for the BEGIN IMMEDIATE wrapping this
// repo's callers require.
// ──────────────────────────────────────────────────────────────────────────────

export type Executor = Pick<Db, 'select' | 'insert' | 'update'>

// The most recent row (any status) for a (userId, serviceHost) pair. The
// partial unique index (schema.ts) guarantees at most one PENDING row ever
// exists for a pair, but any number of terminal (approved/rejected) rows can
// coexist as history (R12) — ordering by id desc and taking one is what
// makes this "the current state," regardless of how much history sits
// beneath it.
export function findLatestRequest(
  executor: Executor,
  userId: string,
  serviceHost: string,
): AccessRequestRow | undefined {
  return executor
    .select()
    .from(accessRequest)
    .where(
      and(
        eq(accessRequest.userId, userId),
        eq(accessRequest.serviceHost, serviceHost),
      ),
    )
    .orderBy(desc(accessRequest.id))
    .limit(1)
    .get()
}

// A fresh PENDING row (R5's first-ever request, or R8's post-cooldown
// re-request). `createdAt` and `lastSeenAt` both start at `now` — R6's
// absorbing UPDATE is what advances `lastSeenAt` alone from here on, never
// this function again for the SAME row.
export function insertPendingRequest(
  executor: Executor,
  userId: string,
  serviceHost: string,
  now: Date,
): void {
  executor
    .insert(accessRequest)
    .values({
      userId,
      serviceHost,
      status: 'pending',
      createdAt: now,
      lastSeenAt: now,
    })
    .run()
}

// R6/AE1: absorbs a re-request into the existing pending row by bumping
// `lastSeenAt` alone — `status`/`decidedAt` are untouched, and no second row
// is ever created (the partial unique index would reject one outright, but
// this function's whole job is to take the UPDATE branch instead of ever
// attempting that INSERT).
export function touchLastSeen(executor: Executor, id: number, now: Date): void {
  executor
    .update(accessRequest)
    .set({ lastSeenAt: now })
    .where(eq(accessRequest.id, id))
    .run()
}

// U7: a specific queue row by id — what the admin's approve/reject actions
// operate on (the queue UI acts on one row at a time, or several via bulk
// dismiss, never on a bare (userId, serviceHost) pair directly).
export function findById(
  executor: Executor,
  id: number,
): AccessRequestRow | undefined {
  return executor
    .select()
    .from(accessRequest)
    .where(eq(accessRequest.id, id))
    .get()
}

// U7 (R11): the terminal write both approve and reject share — only
// `status`/`decidedAt` change; schema.ts's correlation CHECK constraint
// ((status = 'pending') = (decided_at IS NULL)) is what makes passing a
// non-pending status here without decidedAt a schema-level error rather
// than a silently-inconsistent row, so this function's signature (`status`
// always paired with `now`) can't accidentally violate it.
export function markDecided(
  executor: Executor,
  id: number,
  status: 'approved' | 'rejected',
  now: Date,
): void {
  executor
    .update(accessRequest)
    .set({ status, decidedAt: now })
    .where(eq(accessRequest.id, id))
    .run()
}

export type QueueRow = {
  id: number
  userId: string
  email: string
  serviceHost: string
  createdAt: Date
  lastSeenAt: Date
}

// U7 (R10): every currently-pending request, newest-request-context-first
// isn't required by any test scenario, so plain id order is fine. Joined
// with `user` for display (the queue shows the requester's email, not a
// bare id) — homelab scale means this join plus the per-row history count
// below (countPriorDecisions) is cheap enough to not need a single fancier
// aggregate query.
export function listPendingQueue(db: Db): QueueRow[] {
  return db
    .select({
      id: accessRequest.id,
      userId: accessRequest.userId,
      email: user.email,
      serviceHost: accessRequest.serviceHost,
      createdAt: accessRequest.createdAt,
      lastSeenAt: accessRequest.lastSeenAt,
    })
    .from(accessRequest)
    .innerJoin(user, eq(user.id, accessRequest.userId))
    .where(eq(accessRequest.status, 'pending'))
    .orderBy(accessRequest.id)
    .all()
}

// The self-service /me endpoint's own "which of MY requests are still
// pending" read — mirrors listPendingQueue()'s `WHERE status = 'pending'`
// filter, scoped to one user. Served by the existing
// access_request_user_service_idx (userId, serviceHost) index's leading
// column; no new index needed.
export function listPendingRequestsForUser(
  db: Db,
  userId: string,
): AccessRequestRow[] {
  return db
    .select()
    .from(accessRequest)
    .where(
      and(
        eq(accessRequest.userId, userId),
        eq(accessRequest.status, 'pending'),
      ),
    )
    .all()
}

// R12: "4th request, rejected 3x" — the count of DECIDED (non-pending) rows
// for the same pair, the only recovery route for a mis-clicked rejection.
// Excludes the pending row itself (isNotNull(decidedAt) is exactly
// "terminal", per the schema's own pending/decided correlation).
export function countPriorDecisions(
  db: Db,
  userId: string,
  serviceHost: string,
): number {
  return (
    db
      .select({ count: count() })
      .from(accessRequest)
      .where(
        and(
          eq(accessRequest.userId, userId),
          eq(accessRequest.serviceHost, serviceHost),
          isNotNull(accessRequest.decidedAt),
        ),
      )
      .get()?.count ?? 0
  )
}
