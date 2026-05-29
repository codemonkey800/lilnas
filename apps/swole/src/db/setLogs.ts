import 'server-only'

import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from 'src/db/client'
import {
  DuplicateSetLog,
  isSqliteError,
  NotFoundError,
  SessionAlreadyCompleted,
  UndoBlockedByCommittedProgression,
  UndoBlockedBySessionCompleted,
  ValidationError,
} from 'src/db/errors'
import {
  progressions,
  sessions,
  setLogActionEnum,
  setLogs,
} from 'src/db/schema'
import type { SetLogRow } from 'src/db/types'
import { logger } from 'src/lib/logger'

const positiveInt = z.number().int().min(1)

const appendSetLogSchema = z.object({
  sessionId: positiveInt,
  exerciseId: positiveInt,
  setNumber: positiveInt,
  weight: positiveInt.optional(),
  targetReps: positiveInt.optional(),
  actualReps: z.number().int().min(0).optional(),
  durationSeconds: positiveInt.optional(),
  actualDurationSeconds: z.number().int().min(0).optional(),
  action: z.enum(setLogActionEnum),
})

// Action labels persistable to the DB. Single source of truth: the schema's
// enum tuple drives both the column constraint and this type. Excludes
// 'JumpTo' (UI-only). The mappers.ts compile-time guard pins the FSM↔schema
// invariance (#11).
export type PersistableAction = (typeof setLogActionEnum)[number]

// ─── Reads ──────────────────────────────────────────────────────────────────

export type GetSetLogsForSessionArgs = { sessionId: number }

export async function getSetLogsForSession(
  args: GetSetLogsForSessionArgs,
): Promise<SetLogRow[]> {
  return db
    .select()
    .from(setLogs)
    .where(eq(setLogs.sessionId, args.sessionId))
    .orderBy(asc(setLogs.loggedAt), asc(setLogs.id))
    .all()
}

// ─── Writes ─────────────────────────────────────────────────────────────────

export type AppendSetLogArgs = {
  sessionId: number
  exerciseId: number
  setNumber: number
  weight?: number
  targetReps?: number
  actualReps?: number
  durationSeconds?: number
  actualDurationSeconds?: number
  action: PersistableAction
}

export async function appendSetLog(args: AppendSetLogArgs): Promise<SetLogRow> {
  const parsed = appendSetLogSchema.safeParse(args)
  if (!parsed.success) throw new ValidationError('invalid set log args')
  try {
    return db.transaction(
      tx => {
        // Sealed sessions reject new writes — closes the cross-tab race
        // where a stale composer in tab A lands a set_log after tab B's
        // completeSession finished. The session row is read inside BEGIN
        // IMMEDIATE so the check + insert are atomic vs other writers (#9).
        const session = tx
          .select({ completedAt: sessions.completedAt })
          .from(sessions)
          .where(eq(sessions.id, args.sessionId))
          .get()
        if (!session) throw new NotFoundError('Session', args.sessionId)
        if (session.completedAt) {
          throw new SessionAlreadyCompleted(args.sessionId)
        }
        return tx.insert(setLogs).values(args).returning().get()
      },
      { behavior: 'immediate' },
    )
  } catch (err) {
    // The UNIQUE (session_id, exercise_id, set_number) constraint protects
    // against duplicate writes on retry. ALWAYS throw — the duplicate row's
    // weight/actualReps/action may diverge from the optimistic FSM's
    // computed log, and silently no-op-ing would hide a real bug at the
    // next hydration. The caller compares the existing row field-by-field
    // and decides whether to force a client re-hydration.
    if (isSqliteError(err, 'SQLITE_CONSTRAINT_UNIQUE')) {
      const existing = db
        .select()
        .from(setLogs)
        .where(
          and(
            eq(setLogs.sessionId, args.sessionId),
            eq(setLogs.exerciseId, args.exerciseId),
            eq(setLogs.setNumber, args.setNumber),
          ),
        )
        .get()
      throw new DuplicateSetLog(existing)
    }
    logMutationError('appendSetLog', args, err)
    throw err
  }
}

export type UndoLastSetLogArgs = { sessionId: number }

// Hard-delete the most recent set_log for the session, tiebreaking by id DESC
// so two logs sharing the same loggedAt ms still produce a deterministic
// "last in" deletion. Refuses once:
//  - any session_progression row exists for the session (R32), OR
//  - the session has been completed (#42).
// Once a progression decision or completion happens, the audit log would no
// longer match a state we can roll back to.
export async function undoLastSetLog(args: UndoLastSetLogArgs): Promise<void> {
  try {
    db.transaction(
      tx => {
        const session = tx
          .select({ completedAt: sessions.completedAt })
          .from(sessions)
          .where(eq(sessions.id, args.sessionId))
          .get()
        if (!session) throw new NotFoundError('Session', args.sessionId)
        if (session.completedAt) {
          throw new UndoBlockedBySessionCompleted(args.sessionId)
        }

        const committed = tx
          .select({ n: sql<number>`count(*)`.as('n') })
          .from(progressions)
          .where(
            and(
              eq(progressions.sessionId, args.sessionId),
              eq(progressions.reason, 'session_progression'),
            ),
          )
          .get()
        if ((committed?.n ?? 0) > 0) {
          throw new UndoBlockedByCommittedProgression(args.sessionId)
        }

        const last = tx
          .select({ id: setLogs.id })
          .from(setLogs)
          .where(eq(setLogs.sessionId, args.sessionId))
          .orderBy(desc(setLogs.loggedAt), desc(setLogs.id))
          .limit(1)
          .get()
        if (!last) return // No-op when no logs exist.

        tx.delete(setLogs).where(eq(setLogs.id, last.id)).run()
      },
      { behavior: 'immediate' },
    )
  } catch (err) {
    logMutationError('undoLastSetLog', args, err)
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
