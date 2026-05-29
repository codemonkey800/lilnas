let currentDb: import('drizzle-orm/better-sqlite3').BetterSQLite3Database<
  typeof import('src/db/schema')
>

jest.mock('src/db/client', () => ({
  get db() {
    return currentDb
  },
}))

import { eq } from 'drizzle-orm'

import {
  archiveExercise,
  createExercise,
  insertExerciseWithInitialProgression,
  listExercisesForRoutine,
  reorderExercises,
  updateExercise,
} from 'src/db/exercises'
import { getProgressionsForExercise } from 'src/db/progressions'
import {
  exercises as exercisesTable,
  progressions,
  routines,
  sessions,
} from 'src/db/schema'
import { createTestDb, type TestDb } from 'src/db/test-db'

let testDb: TestDb
let routineId: number

beforeEach(() => {
  testDb = createTestDb()
  currentDb = testDb.db
  routineId = testDb.db
    .insert(routines)
    .values({ name: 'Push', days: ['mon'] })
    .returning()
    .get().id
})

afterEach(() => {
  testDb.close()
})

const seedExercise = (
  overrides: Partial<typeof exercisesTable.$inferInsert> = {},
) =>
  testDb.db
    .insert(exercisesTable)
    .values({
      routineId,
      name: 'Bench',
      type: 'weighted',
      orderInRoutine: 0,
      sets: 3,
      targetReps: 10,
      startingWeight: 100,
      increment: 5,
      ...overrides,
    })
    .returning()
    .get()

// ─── Reads ──────────────────────────────────────────────────────────────────

describe('listExercisesForRoutine', () => {
  it('returns non-archived exercises ordered by order_in_routine', async () => {
    seedExercise({ name: 'Bench', orderInRoutine: 0 })
    seedExercise({
      name: 'Pushups',
      type: 'bodyweight',
      startingWeight: null,
      increment: null,
      orderInRoutine: 1,
    })
    seedExercise({ name: 'Curls', orderInRoutine: 2, archivedAt: new Date() })
    const result = await listExercisesForRoutine({ routineId })
    expect(result.map(e => e.name)).toEqual(['Bench', 'Pushups'])
  })

  it('includes archived exercises when includeArchived: true', async () => {
    seedExercise({ name: 'Bench', orderInRoutine: 0 })
    seedExercise({ name: 'Curls', orderInRoutine: 1, archivedAt: new Date() })
    const result = await listExercisesForRoutine({
      routineId,
      includeArchived: true,
    })
    expect(result).toHaveLength(2)
  })

  it('returns empty array when no exercises for the routine', async () => {
    const result = await listExercisesForRoutine({ routineId: 99999 })
    expect(result).toEqual([])
  })
})

// ─── Writes ─────────────────────────────────────────────────────────────────

describe('createExercise', () => {
  it('weighted: inserts exercise and an `initial` progression row in the same tx', async () => {
    const ex = await createExercise({
      routineId,
      type: 'weighted',
      name: 'Bench',
      orderInRoutine: 0,
      sets: 3,
      targetReps: 10,
      startingWeight: 100,
      increment: 5,
    })
    expect(ex.type).toBe('weighted')
    const progRows = await getProgressionsForExercise({ exerciseId: ex.id })
    expect(progRows).toHaveLength(1)
    expect(progRows[0]?.reason).toBe('initial')
    expect(progRows[0]?.startingWeight).toBe(100)
    expect(progRows[0]?.sessionId).toBeNull()
  })

  it('bodyweight: inserts exercise but no progression row', async () => {
    const ex = await createExercise({
      routineId,
      type: 'bodyweight',
      name: 'Pushups',
      orderInRoutine: 0,
      sets: 3,
      targetReps: 15,
    })
    const progRows = await getProgressionsForExercise({ exerciseId: ex.id })
    expect(progRows).toEqual([])
  })

  it('time-based: no progression row', async () => {
    const ex = await createExercise({
      routineId,
      type: 'time-based',
      name: 'Plank',
      orderInRoutine: 0,
      sets: 3,
      durationSeconds: 30,
    })
    const progRows = await getProgressionsForExercise({ exerciseId: ex.id })
    expect(progRows).toEqual([])
  })

  it('cardio: no progression row, sets must be 1', async () => {
    const ex = await createExercise({
      routineId,
      type: 'cardio',
      name: 'Treadmill',
      orderInRoutine: 0,
      sets: 1,
      durationSeconds: 600,
    })
    expect(ex.sets).toBe(1)
    expect(await getProgressionsForExercise({ exerciseId: ex.id })).toEqual([])
  })

  it('rejects empty name with ValidationError', async () => {
    await expect(
      createExercise({
        routineId,
        type: 'weighted',
        name: '',
        orderInRoutine: 0,
        sets: 3,
        targetReps: 10,
        startingWeight: 100,
        increment: 5,
      }),
    ).rejects.toThrow(/name must be non-empty/)
  })
})

describe('updateExercise', () => {
  let exerciseId: number

  beforeEach(async () => {
    const ex = await createExercise({
      routineId,
      type: 'weighted',
      name: 'Bench',
      orderInRoutine: 0,
      sets: 3,
      targetReps: 10,
      startingWeight: 100,
      increment: 5,
    })
    exerciseId = ex.id
  })

  it('patch with no starting_weight change: no new progression row', async () => {
    const before = await getProgressionsForExercise({ exerciseId })
    await updateExercise({ id: exerciseId, name: 'Bench Press' })
    const after = await getProgressionsForExercise({ exerciseId })
    expect(after).toHaveLength(before.length)
  })

  it('weighted patch with changed startingWeight: inserts manual_edit row atomically', async () => {
    await updateExercise({ id: exerciseId, startingWeight: 110 })
    const progRows = await getProgressionsForExercise({ exerciseId })
    expect(progRows).toHaveLength(2)
    expect(progRows[1]?.reason).toBe('manual_edit')
    expect(progRows[1]?.startingWeight).toBe(110)
    const exRow = testDb.db
      .select()
      .from(exercisesTable)
      .where(eq(exercisesTable.id, exerciseId))
      .get()
    expect(exRow?.startingWeight).toBe(110)
  })

  it('weighted patch with same startingWeight: no new progression row', async () => {
    await updateExercise({ id: exerciseId, startingWeight: 100 })
    const progRows = await getProgressionsForExercise({ exerciseId })
    expect(progRows).toHaveLength(1)
  })

  it('throws NotFoundError for nonexistent id', async () => {
    await expect(updateExercise({ id: 99999, name: 'X' })).rejects.toThrow(
      /Exercise not found/,
    )
  })

  it('rejects startingWeight on a bodyweight row — CHECK constraint fires (#31)', async () => {
    const bw = await createExercise({
      routineId,
      type: 'bodyweight',
      name: 'Pushups',
      orderInRoutine: 1,
      sets: 3,
      targetReps: 15,
    })
    await expect(
      updateExercise({ id: bw.id, startingWeight: 50 } as never),
    ).rejects.toThrow(/CHECK/)
    const progs = await getProgressionsForExercise({ exerciseId: bw.id })
    expect(progs).toEqual([])
  })
})

describe('archiveExercise', () => {
  let exerciseId: number

  beforeEach(async () => {
    const ex = await createExercise({
      routineId,
      type: 'weighted',
      name: 'Bench',
      orderInRoutine: 0,
      sets: 3,
      targetReps: 10,
      startingWeight: 100,
      increment: 5,
    })
    exerciseId = ex.id
  })

  it('archives when no active session exists', async () => {
    const row = await archiveExercise({ id: exerciseId })
    expect(row.archivedAt).toBeInstanceOf(Date)
  })

  it('archives when only completed sessions exist', async () => {
    testDb.db
      .insert(sessions)
      .values({ routineId, completedAt: new Date() })
      .run()
    const row = await archiveExercise({ id: exerciseId })
    expect(row.archivedAt).toBeInstanceOf(Date)
  })

  it('throws ArchiveBlockedByActiveSession when an active session exists', async () => {
    testDb.db.insert(sessions).values({ routineId }).run()
    await expect(archiveExercise({ id: exerciseId })).rejects.toThrow(
      /Cannot archive Exercise/,
    )
    const exRow = testDb.db
      .select()
      .from(exercisesTable)
      .where(eq(exercisesTable.id, exerciseId))
      .get()
    expect(exRow?.archivedAt).toBeNull()
  })

  it('throws NotFoundError for nonexistent id', async () => {
    await expect(archiveExercise({ id: 99999 })).rejects.toThrow(
      /Exercise not found/,
    )
  })
})

describe('reorderExercises', () => {
  let aId: number
  let bId: number
  let cId: number

  beforeEach(async () => {
    aId = (
      await createExercise({
        routineId,
        type: 'bodyweight',
        name: 'A',
        orderInRoutine: 0,
        sets: 3,
        targetReps: 10,
      })
    ).id
    bId = (
      await createExercise({
        routineId,
        type: 'bodyweight',
        name: 'B',
        orderInRoutine: 1,
        sets: 3,
        targetReps: 10,
      })
    ).id
    cId = (
      await createExercise({
        routineId,
        type: 'bodyweight',
        name: 'C',
        orderInRoutine: 2,
        sets: 3,
        targetReps: 10,
      })
    ).id
  })

  it('reorders when no active session exists', async () => {
    await reorderExercises({ routineId, orderedIds: [cId, aId, bId] })
    const list = await listExercisesForRoutine({ routineId })
    expect(list.map(e => e.name)).toEqual(['C', 'A', 'B'])
  })

  it('reorders when only completed sessions exist', async () => {
    testDb.db
      .insert(sessions)
      .values({ routineId, completedAt: new Date() })
      .run()
    await reorderExercises({ routineId, orderedIds: [bId, cId, aId] })
    const list = await listExercisesForRoutine({ routineId })
    expect(list.map(e => e.name)).toEqual(['B', 'C', 'A'])
  })

  it('throws ReorderBlockedByActiveSession when an active session exists', async () => {
    testDb.db.insert(sessions).values({ routineId }).run()
    await expect(
      reorderExercises({ routineId, orderedIds: [cId, bId, aId] }),
    ).rejects.toThrow(/Cannot reorder exercises/)
    const list = await listExercisesForRoutine({ routineId })
    expect(list.map(e => e.name)).toEqual(['A', 'B', 'C'])
  })

  it('rejects an incomplete reorder (missing exercise) with ValidationError (#32)', async () => {
    await expect(
      reorderExercises({ routineId, orderedIds: [cId, aId] }),
    ).rejects.toThrow(/reorderExercises: expected 3 ids, got 2/)
    const list = await listExercisesForRoutine({ routineId })
    expect(list.map(e => e.name)).toEqual(['A', 'B', 'C'])
  })

  it('rejects duplicate exerciseIds with ValidationError (#32)', async () => {
    await expect(
      reorderExercises({ routineId, orderedIds: [aId, aId, bId] }),
    ).rejects.toThrow(/contains duplicates/)
    const list = await listExercisesForRoutine({ routineId })
    expect(list.map(e => e.name)).toEqual(['A', 'B', 'C'])
  })

  it('rejects foreign exerciseIds from another routine with ValidationError (#32)', async () => {
    const otherRoutineId = testDb.db
      .insert(routines)
      .values({ name: 'Pull', days: ['tue'] })
      .returning()
      .get().id
    const foreign = await createExercise({
      routineId: otherRoutineId,
      type: 'bodyweight',
      name: 'Row',
      orderInRoutine: 0,
      sets: 3,
      targetReps: 10,
    })
    await expect(
      reorderExercises({ routineId, orderedIds: [aId, bId, foreign.id] }),
    ).rejects.toThrow(/is not in routine/)
    const a = await listExercisesForRoutine({ routineId })
    expect(a.map(e => e.name)).toEqual(['A', 'B', 'C'])
    const b = await listExercisesForRoutine({ routineId: otherRoutineId })
    expect(b.map(e => e.orderInRoutine)).toEqual([0])
  })

  it('rejects an empty orderedIds array', async () => {
    await expect(
      reorderExercises({ routineId, orderedIds: [] }),
    ).rejects.toThrow(/must be non-empty/)
  })
})

describe('atomicity', () => {
  it('createExercise rolls back the exercise insert when the routine FK fails', async () => {
    await expect(
      createExercise({
        routineId: 99999,
        type: 'weighted',
        name: 'Bench',
        orderInRoutine: 0,
        sets: 3,
        targetReps: 10,
        startingWeight: 100,
        increment: 5,
      }),
    ).rejects.toThrow(/FOREIGN KEY/)
    const list = await listExercisesForRoutine({
      routineId: 99999,
      includeArchived: true,
    })
    expect(list).toEqual([])
    const allProgressions = testDb.db.select().from(progressions).all()
    expect(allProgressions).toEqual([])
  })
})

describe('insertExerciseWithInitialProgression', () => {
  it('inserts a weighted exercise and exactly one initial progression with matching startingWeight', () => {
    testDb.db.transaction(
      tx => {
        const ex = insertExerciseWithInitialProgression(tx, {
          routineId,
          type: 'weighted',
          name: 'Squat',
          orderInRoutine: 0,
          sets: 4,
          targetReps: 5,
          startingWeight: 135,
          increment: 10,
        })
        const progs = tx
          .select()
          .from(progressions)
          .where(eq(progressions.exerciseId, ex.id))
          .all()
        expect(progs).toHaveLength(1)
        expect(progs[0]?.reason).toBe('initial')
        expect(progs[0]?.startingWeight).toBe(135)
        expect(progs[0]?.sessionId).toBeNull()
      },
      { behavior: 'immediate' },
    )
  })

  it('inserts a non-weighted exercise and no progression rows', () => {
    testDb.db.transaction(
      tx => {
        const ex = insertExerciseWithInitialProgression(tx, {
          routineId,
          type: 'bodyweight',
          name: 'Pushups',
          orderInRoutine: 0,
          sets: 3,
          targetReps: 15,
        })
        const progs = tx
          .select()
          .from(progressions)
          .where(eq(progressions.exerciseId, ex.id))
          .all()
        expect(progs).toEqual([])
      },
      { behavior: 'immediate' },
    )
  })

  it('rolls back exercise and progressions when the CHECK constraint fires (AE6 seam)', () => {
    // Drive a real CHECK violation inside the helper by forcing a
    // weighted row missing startingWeight — verifies the constraint fires
    // and rolls back both inserts. Uses `as never` per the existing
    // exercises.spec.ts CHECK-violation precedent.
    expect(() =>
      testDb.db.transaction(
        tx => {
          insertExerciseWithInitialProgression(tx, {
            routineId,
            type: 'weighted',
            name: 'Bad',
            orderInRoutine: 0,
            sets: 3,
            targetReps: 10,
            startingWeight: null as never,
            increment: 5,
          })
        },
        { behavior: 'immediate' },
      ),
    ).toThrow(/CHECK/)

    const allExercises = testDb.db
      .select()
      .from(exercisesTable)
      .where(eq(exercisesTable.routineId, routineId))
      .all()
    expect(allExercises).toEqual([])
    expect(testDb.db.select().from(progressions).all()).toEqual([])
  })
})
