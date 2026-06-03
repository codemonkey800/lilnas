import 'server-only'

import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm'

import { db } from 'src/db/client'
import {
  isSqliteError,
  NotFoundError,
  RoutineAlreadyHasActiveSession,
  RoutineArchived,
  SessionHasProgression,
  SessionNotCompleted,
} from 'src/db/errors'
import { progressions, routines, sessions } from 'src/db/schema'
import { deleteSessionSetLogs } from 'src/db/setLogs'
import type { RoutineRow, SessionRow } from 'src/db/types'
import { logger } from 'src/lib/logger'

// ─── Reads ──────────────────────────────────────────────────────────────────

export type GetSessionArgs = { id: number }

export async function getSession(
  args: GetSessionArgs,
): Promise<SessionRow | null> {
  const row = db.select().from(sessions).where(eq(sessions.id, args.id)).get()
  return row ?? null
}

export type ListSessionsArgs = {
  routineId: number
  completedOnly?: boolean
}

export async function listSessionsForRoutine(
  args: ListSessionsArgs,
): Promise<SessionRow[]> {
  const whereClause = args.completedOnly
    ? and(
        eq(sessions.routineId, args.routineId),
        isNotNull(sessions.completedAt),
      )
    : eq(sessions.routineId, args.routineId)
  return db.select().from(sessions).where(whereClause).all()
}

export type GetActiveSessionArgs = { id: number }

export async function getActiveSession(
  args: GetActiveSessionArgs,
): Promise<SessionRow | null> {
  const row = db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, args.id), isNull(sessions.completedAt)))
    .get()
  return row ?? null
}

// Returns the active (incomplete) session for a specific routine, or null if none.
// Used by the edit page (R15) — the global getMostRecentActiveSession() is
// argument-less and would falsely block on another routine's active session.
// The partial unique index `one_active_session_per_routine` DB-enforces ≤1 active
// session per routine, so at most one row is returned.
export async function getActiveSessionForRoutine(
  routineId: number,
): Promise<SessionRow | null> {
  const row = db
    .select()
    .from(sessions)
    .where(and(eq(sessions.routineId, routineId), isNull(sessions.completedAt)))
    .get()
  return row ?? null
}

// The single most-recently-started incomplete session across all routines.
// Used by the home page resume banner — R16 explicitly shows one even when
// multiple active sessions exist. Ties on startedAt fall to higher id.
export async function getMostRecentActiveSession(): Promise<SessionRow | null> {
  const row = db
    .select()
    .from(sessions)
    .where(isNull(sessions.completedAt))
    .orderBy(desc(sessions.startedAt), desc(sessions.id))
    .limit(1)
    .get()
  return row ?? null
}

export type ListRecentCompletedSessionsArgs = { limit: number }

// Recent completed sessions joined to their routine. Used by the home page's
// recent-strip — per R21 there are no joins to set_logs, exercises, or
// progressions. Archived routines are NOT filtered out: a completed session
// on a now-archived routine still appears in the user's history.
export async function listRecentCompletedSessions(
  args: ListRecentCompletedSessionsArgs,
): Promise<Array<{ session: SessionRow; routine: RoutineRow }>> {
  return db
    .select({ session: sessions, routine: routines })
    .from(sessions)
    .innerJoin(routines, eq(sessions.routineId, routines.id))
    .where(isNotNull(sessions.completedAt))
    .orderBy(desc(sessions.completedAt), desc(sessions.id))
    .limit(args.limit)
    .all()
}

// ─── Writes ─────────────────────────────────────────────────────────────────

export type StartSessionArgs = { routineId: number }

export async function startSession(
  args: StartSessionArgs,
): Promise<SessionRow> {
  try {
    return db.transaction(
      tx => {
        // Refuse to start a new session on an archived routine. The FK to
        // routines still resolves on archived rows, so without this read the
        // DB happily creates an active session whose routine the UI cannot
        // navigate to — corrupting both the audit trail and `archiveRoutine`'s
        // active-session invariant.
        const routine = tx
          .select({ archivedAt: routines.archivedAt })
          .from(routines)
          .where(eq(routines.id, args.routineId))
          .get()
        if (!routine) throw new NotFoundError('Routine', args.routineId)
        if (routine.archivedAt) throw new RoutineArchived(args.routineId)
        return tx
          .insert(sessions)
          .values({ routineId: args.routineId })
          .returning()
          .get()
      },
      { behavior: 'immediate' },
    )
  } catch (err) {
    if (isSqliteError(err, 'SQLITE_CONSTRAINT_UNIQUE')) {
      throw new RoutineAlreadyHasActiveSession(args.routineId)
    }
    logMutationError('startSession', args, err)
    throw err
  }
}

export type CompleteSessionArgs = { sessionId: number }

// Idempotent: re-calling on a session that's already completed returns the
// existing row without bumping completedAt. Wrapped in BEGIN IMMEDIATE so two
// concurrent calls (UI double-click / retry) can't both pass the existing
// check and both run the UPDATE — the second waits on the write lock and
// then sees `completedAt` non-null.
export async function completeSession(
  args: CompleteSessionArgs,
): Promise<SessionRow> {
  try {
    return db.transaction(
      tx => {
        const existing = tx
          .select()
          .from(sessions)
          .where(eq(sessions.id, args.sessionId))
          .get()
        if (!existing) throw new NotFoundError('Session', args.sessionId)
        if (existing.completedAt) return existing

        return tx
          .update(sessions)
          .set({ completedAt: new Date() })
          .where(eq(sessions.id, args.sessionId))
          .returning()
          .get()
      },
      { behavior: 'immediate' },
    )
  } catch (err) {
    logMutationError('completeSession', args, err)
    throw err
  }
}

export type DeleteSessionArgs = { sessionId: number }

// Deletes a completed session and its set logs under two independent guards:
//
// 1. State guard (SessionNotCompleted): the session must be completed so the
//    live runner's session can never be deleted out from under it.
//
// 2. FK-safety guard (SessionHasProgression): no session_progression row may
//    reference this session. This guard is reason-filtered and co-extensive with
//    the progressions.sessionId FK restrict only because commitProgressionDecision
//    is the sole writer of a non-null sessionId (always reason='session_progression').
//    Non-session_progression rows (initial / manual_edit) always have sessionId=null.
//    If a future writer sets sessionId with another reason, the guard must be widened —
//    otherwise tx.delete(sessions) FK-aborts and the defensive FK-abort mapping in
//    the action layer surfaces it as a typed error instead of a 500.
//
// Delete order: set_logs first, then sessions (leaf-first for restrict FKs).
// All access via tx so a mid-transaction failure rolls back completely.
export async function deleteSession(args: DeleteSessionArgs): Promise<void> {
  try {
    return db.transaction(
      tx => {
        const existing = tx
          .select()
          .from(sessions)
          .where(eq(sessions.id, args.sessionId))
          .get()
        if (!existing) throw new NotFoundError('Session', args.sessionId)
        if (existing.completedAt == null)
          throw new SessionNotCompleted(args.sessionId)

        const progressionCount = tx
          .select({ n: sql<number>`count(*)`.as('n') })
          .from(progressions)
          .where(
            and(
              eq(progressions.sessionId, args.sessionId),
              eq(progressions.reason, 'session_progression'),
            ),
          )
          .get()
        if ((progressionCount?.n ?? 0) > 0) {
          throw new SessionHasProgression(args.sessionId)
        }

        deleteSessionSetLogs(tx, args.sessionId)
        tx.delete(sessions).where(eq(sessions.id, args.sessionId)).run()
      },
      { behavior: 'immediate' },
    )
  } catch (err) {
    logMutationError('deleteSession', args, err)
    throw err
  }
}

function logMutationError(
  op: string,
  args: Record<string, unknown>,
  err: unknown,
): void {
  if (err instanceof Error) {
    const code = (err as Error & { code?: string }).code
    logger.error({ msg: 'swole mutation failed', op, args, err, code })
  } else {
    logger.error({ msg: 'swole mutation failed', op, args, err })
  }
}
