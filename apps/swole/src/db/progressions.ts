import 'server-only'

import { asc, eq } from 'drizzle-orm'

import { db } from 'src/db/client'
import {
  NotFoundError,
  SessionAlreadyCompleted,
  ValidationError,
} from 'src/db/errors'
import { exercises, progressions, sessions } from 'src/db/schema'
import type { ProgressionRow } from 'src/db/types'
import { logger } from 'src/lib/logger'

// ─── Reads ──────────────────────────────────────────────────────────────────

export type GetProgressionsForExerciseArgs = { exerciseId: number }

export async function getProgressionsForExercise(
  args: GetProgressionsForExerciseArgs,
): Promise<ProgressionRow[]> {
  return db
    .select()
    .from(progressions)
    .where(eq(progressions.exerciseId, args.exerciseId))
    .orderBy(asc(progressions.effectiveFrom), asc(progressions.id))
    .all()
}

export type GetProgressionsForSessionArgs = { sessionId: number }

export async function getProgressionsForSession(
  args: GetProgressionsForSessionArgs,
): Promise<ProgressionRow[]> {
  return db
    .select()
    .from(progressions)
    .where(eq(progressions.sessionId, args.sessionId))
    .orderBy(asc(progressions.effectiveFrom), asc(progressions.id))
    .all()
}

// ─── Writes ─────────────────────────────────────────────────────────────────

export type CommitProgressionDecisionArgs = {
  sessionId: number
  exerciseId: number
  chosenStartingWeight: number
}

// Writes a session_progression row AND updates exercises.starting_weight in
// the same transaction. Together these enforce R19's canonical-write
// invariant: the latest progressions row's starting_weight always equals
// exercises.starting_weight. Tested explicitly at the integration boundary
// in the PRD walkthrough.
//
// Validates inside the transaction that the session exists, references the
// exercise's routine, and has not been completed. SQLite's schema-level FK
// only checks `sessions.id` resolves, not these cross-row invariants (#3).
export async function commitProgressionDecision(
  args: CommitProgressionDecisionArgs,
): Promise<ProgressionRow> {
  try {
    return db.transaction(
      tx => {
        const existing = tx
          .select()
          .from(exercises)
          .where(eq(exercises.id, args.exerciseId))
          .get()
        if (!existing) throw new NotFoundError('Exercise', args.exerciseId)

        const session = tx
          .select({
            routineId: sessions.routineId,
            completedAt: sessions.completedAt,
          })
          .from(sessions)
          .where(eq(sessions.id, args.sessionId))
          .get()
        if (!session) throw new NotFoundError('Session', args.sessionId)
        if (session.completedAt) {
          throw new SessionAlreadyCompleted(args.sessionId)
        }
        if (session.routineId !== existing.routineId) {
          throw new ValidationError(
            `Session ${args.sessionId} belongs to routine ${session.routineId}, ` +
              `not exercise ${args.exerciseId}'s routine ${existing.routineId}`,
          )
        }

        const inserted = tx
          .insert(progressions)
          .values({
            exerciseId: args.exerciseId,
            sessionId: args.sessionId,
            startingWeight: args.chosenStartingWeight,
            reason: 'session_progression',
          })
          .returning()
          .get()

        tx.update(exercises)
          .set({
            startingWeight: args.chosenStartingWeight,
            updatedAt: new Date(),
          })
          .where(eq(exercises.id, args.exerciseId))
          .run()

        return inserted
      },
      { behavior: 'immediate' },
    )
  } catch (err) {
    if (err instanceof Error) {
      const code = (err as Error & { code?: string }).code
      logger.error({
        msg: 'swole mutation failed',
        op: 'commitProgressionDecision',
        args,
        err,
        code,
      })
    } else {
      logger.error({
        msg: 'swole mutation failed',
        op: 'commitProgressionDecision',
        args,
        err,
      })
    }
    throw err
  }
}
