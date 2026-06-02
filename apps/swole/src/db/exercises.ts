import 'server-only'

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from 'src/db/client'
import {
  ArchiveBlockedByActiveSession,
  NotFoundError,
  ReorderBlockedByActiveSession,
  ValidationError,
} from 'src/db/errors'
import { exercises, progressions, routines, sessions } from 'src/db/schema'
import type { ExerciseRow, RoutineRow } from 'src/db/types'
import { logger } from 'src/lib/logger'

const positiveInt = z.number().int().min(1)

const createExerciseSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('weighted'),
    sets: positiveInt,
    targetReps: positiveInt,
    startingWeight: positiveInt,
    increment: positiveInt,
  }),
  z.object({
    type: z.literal('bodyweight'),
    sets: positiveInt,
    targetReps: positiveInt,
  }),
  z.object({
    type: z.literal('time-based'),
    sets: positiveInt,
    durationSeconds: positiveInt,
  }),
  z.object({
    type: z.literal('cardio'),
    sets: z.literal(1),
    durationSeconds: positiveInt,
  }),
])

const updateExerciseNumericSchema = z.object({
  sets: positiveInt.optional(),
  targetReps: positiveInt.optional(),
  startingWeight: positiveInt.optional(),
  increment: positiveInt.optional(),
  durationSeconds: positiveInt.optional(),
})

// Internal helper invoked both from the outer `db` and inside a transaction
// callback. Parameterized as `unknown`-typed `executor` so it works with
// either handle — at runtime both expose the same chains. Keeps the duplicated
// count-via-tx pattern in archiveRoutine / archiveExercise / reorderExercises
// in one place (#12).
type Executor = {
  select: typeof db.select
  update: typeof db.update
  insert: typeof db.insert
}

export function activeSessionCountForRoutine(
  executor: Executor,
  routineId: number,
): number {
  const row = executor
    .select({ n: sql<number>`count(*)`.as('n') })
    .from(sessions)
    .where(and(eq(sessions.routineId, routineId), isNull(sessions.completedAt)))
    .get()
  return row?.n ?? 0
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export type ListExercisesArgs = {
  routineId: number
  includeArchived?: boolean
}

export type GetExerciseWithRoutineArgs = {
  exerciseId: number
  includeArchived?: boolean
}

export async function getExerciseWithRoutine(
  args: GetExerciseWithRoutineArgs,
): Promise<{ exercise: ExerciseRow; routine: RoutineRow } | null> {
  const whereClause = args.includeArchived
    ? eq(exercises.id, args.exerciseId)
    : and(eq(exercises.id, args.exerciseId), isNull(exercises.archivedAt))
  const row = db
    .select({ exercise: exercises, routine: routines })
    .from(exercises)
    .innerJoin(routines, eq(exercises.routineId, routines.id))
    .where(whereClause)
    .get()
  return row ?? null
}

export async function listExercisesForRoutine(
  args: ListExercisesArgs,
): Promise<ExerciseRow[]> {
  const whereClause = args.includeArchived
    ? eq(exercises.routineId, args.routineId)
    : and(eq(exercises.routineId, args.routineId), isNull(exercises.archivedAt))
  return db
    .select()
    .from(exercises)
    .where(whereClause)
    .orderBy(asc(exercises.orderInRoutine))
    .all()
}

// ─── Writes ─────────────────────────────────────────────────────────────────

export type CreateExerciseArgs =
  | {
      routineId: number
      type: 'weighted'
      name: string
      orderInRoutine: number
      sets: number
      targetReps: number
      startingWeight: number
      increment: number
    }
  | {
      routineId: number
      type: 'bodyweight'
      name: string
      orderInRoutine: number
      sets: number
      targetReps: number
    }
  | {
      routineId: number
      type: 'time-based'
      name: string
      orderInRoutine: number
      sets: number
      durationSeconds: number
    }
  | {
      routineId: number
      type: 'cardio'
      name: string
      orderInRoutine: number
      sets: 1
      durationSeconds: number
    }

function exerciseValues(args: CreateExerciseArgs) {
  // The DB CHECK constraint requires unused type-specific columns to be NULL.
  // The discriminated union enforces the input shape but Drizzle's insert
  // takes a flat row, so we explicitly null out fields that don't apply.
  const base = {
    routineId: args.routineId,
    name: args.name,
    orderInRoutine: args.orderInRoutine,
    sets: args.sets,
  }
  switch (args.type) {
    case 'weighted':
      return {
        ...base,
        type: 'weighted' as const,
        targetReps: args.targetReps,
        startingWeight: args.startingWeight,
        increment: args.increment,
        durationSeconds: null,
      }
    case 'bodyweight':
      return {
        ...base,
        type: 'bodyweight' as const,
        targetReps: args.targetReps,
        startingWeight: null,
        increment: null,
        durationSeconds: null,
      }
    case 'time-based':
      return {
        ...base,
        type: 'time-based' as const,
        targetReps: null,
        startingWeight: null,
        increment: null,
        durationSeconds: args.durationSeconds,
      }
    case 'cardio':
      return {
        ...base,
        type: 'cardio' as const,
        targetReps: null,
        startingWeight: null,
        increment: null,
        durationSeconds: args.durationSeconds,
      }
  }
}

// Inserts one exercise + its initial progression (for weighted) using the
// provided executor. Callable with both the outer `db` and a tx handle.
// All callers that build a new exercise inside a transaction must use this
// helper so the weighted→initial-progression rule (R16) stays in one place.
export function insertExerciseWithInitialProgression(
  executor: Executor,
  args: CreateExerciseArgs,
): ExerciseRow {
  const inserted = executor
    .insert(exercises)
    .values(exerciseValues(args))
    .returning()
    .get()
  if (args.type === 'weighted') {
    executor
      .insert(progressions)
      .values({
        exerciseId: inserted.id,
        startingWeight: args.startingWeight,
        reason: 'initial',
      })
      .run()
  }
  return inserted
}

export async function createExercise(
  args: CreateExerciseArgs,
): Promise<ExerciseRow> {
  if (args.name.trim() === '') {
    throw new ValidationError('exercise name must be non-empty')
  }
  const parsed = createExerciseSchema.safeParse(args)
  if (!parsed.success) throw new ValidationError('invalid exercise args')
  // All DB calls inside the callback MUST use `tx`, never the outer `db`.
  // A stray `db.*` inside this callback would commit unconditionally even
  // if the tx rolls back — silent footgun.
  try {
    return db.transaction(
      tx => insertExerciseWithInitialProgression(tx, args),
      { behavior: 'immediate' },
    )
  } catch (err) {
    logMutationError('createExercise', args, err)
    throw err
  }
}

export type UpdateExerciseArgs = {
  id: number
  name?: string
  orderInRoutine?: number
  sets?: number
  targetReps?: number
  startingWeight?: number
  increment?: number
  durationSeconds?: number
}

// Core update logic, callable both from the outer db and inside a transaction.
// Does NOT open a transaction — callers are responsible for that.
// Reads existing INSIDE the caller's transaction so the starting_weight
// comparison can't race with a concurrent commitProgressionDecision.
export function applyExerciseUpdate(
  tx: Executor,
  args: UpdateExerciseArgs,
): ExerciseRow {
  const existing = tx
    .select()
    .from(exercises)
    .where(eq(exercises.id, args.id))
    .get()
  if (!existing) throw new NotFoundError('Exercise', args.id)
  const patch: Omit<UpdateExerciseArgs, 'id'> = {}
  if (args.name !== undefined) patch.name = args.name
  if (args.orderInRoutine !== undefined)
    patch.orderInRoutine = args.orderInRoutine
  if (args.sets !== undefined) patch.sets = args.sets
  if (args.targetReps !== undefined) patch.targetReps = args.targetReps
  if (args.startingWeight !== undefined)
    patch.startingWeight = args.startingWeight
  if (args.increment !== undefined) patch.increment = args.increment
  if (args.durationSeconds !== undefined)
    patch.durationSeconds = args.durationSeconds
  const updated = tx
    .update(exercises)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(exercises.id, args.id))
    .returning()
    .get()
  // Record a manual_edit progression row when the canonical
  // starting_weight changes on a weighted exercise (R19).
  if (
    existing.type === 'weighted' &&
    args.startingWeight !== undefined &&
    args.startingWeight !== existing.startingWeight
  ) {
    tx.insert(progressions)
      .values({
        exerciseId: args.id,
        startingWeight: args.startingWeight,
        reason: 'manual_edit',
      })
      .run()
  }
  return updated
}

export async function updateExercise(
  args: UpdateExerciseArgs,
): Promise<ExerciseRow> {
  if (args.name !== undefined && args.name.trim() === '') {
    throw new ValidationError('exercise name must be non-empty')
  }
  const parsed = updateExerciseNumericSchema.safeParse(args)
  if (!parsed.success) throw new ValidationError('invalid exercise update args')
  try {
    return db.transaction(tx => applyExerciseUpdate(tx, args), {
      behavior: 'immediate',
    })
  } catch (err) {
    logMutationError('updateExercise', args, err)
    throw err
  }
}

export type ArchiveExerciseArgs = { id: number }

export async function archiveExercise(
  args: ArchiveExerciseArgs,
): Promise<ExerciseRow> {
  try {
    return db.transaction(
      tx => {
        const existing = tx
          .select()
          .from(exercises)
          .where(eq(exercises.id, args.id))
          .get()
        if (!existing) throw new NotFoundError('Exercise', args.id)

        if (activeSessionCountForRoutine(tx, existing.routineId) > 0) {
          throw new ArchiveBlockedByActiveSession('Exercise', args.id)
        }

        return tx
          .update(exercises)
          .set({ archivedAt: new Date(), updatedAt: new Date() })
          .where(eq(exercises.id, args.id))
          .returning()
          .get()
      },
      { behavior: 'immediate' },
    )
  } catch (err) {
    logMutationError('archiveExercise', args, err)
    throw err
  }
}

export type ReorderExercisesArgs = {
  routineId: number
  orderedIds: number[]
}

// Reorders all non-archived exercises of `routineId` to match `orderedIds`.
// Pre-validates that the array is a complete, duplicate-free permutation of
// the routine's exercise ids — silently skipping ids (the previous behavior)
// could leave two exercises sharing an `order_in_routine` value, breaking
// the UI's deterministic ordering. The actual reorder is a single batched
// UPDATE using SQLite's `CASE WHEN id = ? THEN ?` expression so the
// transaction is one statement instead of N round-trips (#8, #32).
export async function reorderExercises(
  args: ReorderExercisesArgs,
): Promise<void> {
  if (args.orderedIds.length === 0) {
    throw new ValidationError('reorderExercises: orderedIds must be non-empty')
  }
  const dedup = new Set(args.orderedIds)
  if (dedup.size !== args.orderedIds.length) {
    throw new ValidationError(
      'reorderExercises: orderedIds contains duplicates',
    )
  }
  try {
    db.transaction(
      tx => {
        if (activeSessionCountForRoutine(tx, args.routineId) > 0) {
          throw new ReorderBlockedByActiveSession(args.routineId)
        }

        const currentRows = tx
          .select({ id: exercises.id })
          .from(exercises)
          .where(
            and(
              eq(exercises.routineId, args.routineId),
              isNull(exercises.archivedAt),
            ),
          )
          .all()
        const currentIds = new Set(currentRows.map(r => r.id))

        if (currentIds.size !== args.orderedIds.length) {
          throw new ValidationError(
            `reorderExercises: expected ${currentIds.size} ids, got ${args.orderedIds.length}`,
          )
        }
        for (const id of args.orderedIds) {
          if (!currentIds.has(id)) {
            throw new ValidationError(
              `reorderExercises: id ${id} is not in routine ${args.routineId}`,
            )
          }
        }

        const orderCase = sql.join(
          [
            sql`CASE`,
            ...args.orderedIds.map(
              (id, i) => sql`WHEN ${exercises.id} = ${id} THEN ${i}`,
            ),
            sql`END`,
          ],
          sql.raw(' '),
        )
        tx.update(exercises)
          .set({
            orderInRoutine: orderCase,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(exercises.routineId, args.routineId),
              inArray(exercises.id, args.orderedIds),
            ),
          )
          .run()
      },
      { behavior: 'immediate' },
    )
  } catch (err) {
    logMutationError('reorderExercises', args, err)
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
