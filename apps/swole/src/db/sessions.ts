import 'server-only'

import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'

import { db } from 'src/db/client'
import {
  isSqliteError,
  NotFoundError,
  RoutineAlreadyHasActiveSession,
  RoutineArchived,
} from 'src/db/errors'
import { routines, sessions } from 'src/db/schema'
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
