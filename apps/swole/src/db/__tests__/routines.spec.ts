let currentDb: import('drizzle-orm/better-sqlite3').BetterSQLite3Database<
  typeof import('src/db/schema')
>

jest.mock('src/db/client', () => ({
  get db() {
    return currentDb
  },
}))

import {
  archiveRoutine,
  createRoutine,
  getRoutine,
  getRoutineWithExercises,
  listRoutines,
  listRoutinesForHome,
  updateRoutine,
} from 'src/db/routines'
import { exercises, routines, sessions } from 'src/db/schema'
import { createTestDb, type TestDb } from 'src/db/test-db'

let testDb: TestDb

beforeEach(() => {
  testDb = createTestDb()
  currentDb = testDb.db
})

afterEach(() => {
  testDb.close()
})

const seedRoutine = (overrides: Partial<typeof routines.$inferInsert> = {}) =>
  testDb.db
    .insert(routines)
    .values({
      name: 'Push Day',
      days: ['mon', 'wed', 'fri'],
      ...overrides,
    })
    .returning()
    .get()

const seedExercise = (
  routineId: number,
  overrides: Partial<typeof exercises.$inferInsert> = {},
) =>
  testDb.db
    .insert(exercises)
    .values({
      routineId,
      name: 'Bench Press',
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

describe('listRoutines', () => {
  it('returns non-archived routines ordered by name asc', async () => {
    seedRoutine({ name: 'Push Day' })
    seedRoutine({ name: 'Arms', days: ['tue'] })
    seedRoutine({ name: 'Legs', days: ['thu'], archivedAt: new Date() })
    const result = await listRoutines()
    expect(result.map(r => r.name)).toEqual(['Arms', 'Push Day'])
  })

  it('includes archived routines when includeArchived: true', async () => {
    seedRoutine({ name: 'Active', days: ['mon'] })
    seedRoutine({ name: 'Archived', days: ['tue'], archivedAt: new Date() })
    const result = await listRoutines({ includeArchived: true })
    expect(result.map(r => r.name)).toEqual(['Active', 'Archived'])
  })

  it('returns empty array when no rows', async () => {
    const result = await listRoutines()
    expect(result).toEqual([])
  })
})

describe('getRoutine', () => {
  it('returns the row when it exists', async () => {
    const r = seedRoutine()
    const result = await getRoutine({ id: r.id })
    expect(result?.id).toBe(r.id)
    expect(result?.name).toBe('Push Day')
  })

  it('returns null when the id does not exist', async () => {
    const result = await getRoutine({ id: 99999 })
    expect(result).toBeNull()
  })
})

describe('getRoutineWithExercises', () => {
  it('returns routine + non-archived exercises ordered by order_in_routine', async () => {
    const r = seedRoutine()
    seedExercise(r.id, { name: 'Bench', orderInRoutine: 0 })
    seedExercise(r.id, {
      name: 'Pushups',
      type: 'bodyweight',
      startingWeight: null,
      increment: null,
      orderInRoutine: 1,
    })
    seedExercise(r.id, {
      name: 'Curls',
      orderInRoutine: 2,
      archivedAt: new Date(),
    })
    const result = await getRoutineWithExercises({ id: r.id })
    expect(result?.routine.id).toBe(r.id)
    expect(result?.exercises.map(e => e.name)).toEqual(['Bench', 'Pushups'])
  })

  it('includes archived exercises when includeArchived: true', async () => {
    const r = seedRoutine()
    seedExercise(r.id, { name: 'Bench', orderInRoutine: 0 })
    seedExercise(r.id, {
      name: 'Curls',
      orderInRoutine: 1,
      archivedAt: new Date(),
    })
    const result = await getRoutineWithExercises({
      id: r.id,
      includeArchived: true,
    })
    expect(result?.exercises.map(e => e.name)).toEqual(['Bench', 'Curls'])
  })

  it('returns null when the routine does not exist', async () => {
    const result = await getRoutineWithExercises({ id: 99999 })
    expect(result).toBeNull()
  })
})

// ─── Writes ─────────────────────────────────────────────────────────────────

describe('createRoutine', () => {
  it('inserts a routine and returns the row', async () => {
    const row = await createRoutine({ name: 'Push Day', days: ['mon', 'wed'] })
    expect(row.id).toBeGreaterThan(0)
    expect(row.name).toBe('Push Day')
    expect(row.days).toEqual(['mon', 'wed'])
    expect(row.createdAt).toBeInstanceOf(Date)
    expect(row.updatedAt).toBeInstanceOf(Date)
  })

  it('appears in listRoutines after insert', async () => {
    await createRoutine({ name: 'Push Day', days: ['mon'] })
    const list = await listRoutines()
    expect(list).toHaveLength(1)
  })

  it('rejects empty name with ValidationError', async () => {
    await expect(createRoutine({ name: '', days: ['mon'] })).rejects.toThrow(
      /name must be non-empty/,
    )
    await expect(createRoutine({ name: '   ', days: ['mon'] })).rejects.toThrow(
      /name must be non-empty/,
    )
  })
})

describe('updateRoutine', () => {
  it('updates name and bumps updatedAt', async () => {
    const created = await createRoutine({ name: 'Old', days: ['mon'] })
    await new Promise(r => setTimeout(r, 10))
    const updated = await updateRoutine({ id: created.id, name: 'New' })
    expect(updated.name).toBe('New')
    expect(updated.updatedAt.getTime()).toBeGreaterThan(
      created.updatedAt.getTime(),
    )
  })

  it('bumps updatedAt even for an empty patch — symmetric with updateExercise (#40)', async () => {
    const created = await createRoutine({ name: 'Push', days: ['mon'] })
    await new Promise(r => setTimeout(r, 10))
    const result = await updateRoutine({ id: created.id })
    expect(result.id).toBe(created.id)
    expect(result.name).toBe(created.name)
    expect(result.days).toEqual(created.days)
    expect(result.updatedAt.getTime()).toBeGreaterThan(
      created.updatedAt.getTime(),
    )
  })

  it('throws NotFoundError for a nonexistent id', async () => {
    await expect(updateRoutine({ id: 99999, name: 'X' })).rejects.toThrow(
      /Routine not found/,
    )
  })

  it('rejects empty name with ValidationError', async () => {
    const r = await createRoutine({ name: 'Push', days: ['mon'] })
    await expect(updateRoutine({ id: r.id, name: '' })).rejects.toThrow(
      /name must be non-empty/,
    )
  })
})

describe('archiveRoutine', () => {
  it('archives a routine with no sessions', async () => {
    const r = await createRoutine({ name: 'Push', days: ['mon'] })
    const archived = await archiveRoutine({ id: r.id })
    expect(archived.archivedAt).toBeInstanceOf(Date)
    const list = await listRoutines()
    expect(list).toHaveLength(0)
    const all = await listRoutines({ includeArchived: true })
    expect(all).toHaveLength(1)
  })

  it('archives a routine with only completed sessions', async () => {
    const r = await createRoutine({ name: 'Push', days: ['mon'] })
    testDb.db
      .insert(sessions)
      .values({ routineId: r.id, completedAt: new Date() })
      .run()
    const archived = await archiveRoutine({ id: r.id })
    expect(archived.archivedAt).toBeInstanceOf(Date)
  })

  it('throws ArchiveBlockedByActiveSession when an active session exists', async () => {
    const r = await createRoutine({ name: 'Push', days: ['mon'] })
    testDb.db.insert(sessions).values({ routineId: r.id }).run()
    await expect(archiveRoutine({ id: r.id })).rejects.toThrow(
      /Cannot archive Routine/,
    )
  })

  it('throws NotFoundError for nonexistent id', async () => {
    await expect(archiveRoutine({ id: 99999 })).rejects.toThrow(
      /Routine not found/,
    )
  })
})

describe('listRoutinesForHome', () => {
  it('returns alphabetically-ordered routines each with exerciseCount and firstExercise', async () => {
    const push = seedRoutine({ name: 'Push Day' })
    const body = seedRoutine({ name: 'Body Day' })
    const mobility = seedRoutine({ name: 'Mobility Day' })
    for (const r of [push, body, mobility]) {
      for (let i = 0; i < 4; i++) {
        seedExercise(r.id, { name: `Ex ${r.id}-${i}`, orderInRoutine: i })
      }
    }
    const result = await listRoutinesForHome()
    expect(result.map(r => r.routine.name)).toEqual([
      'Body Day',
      'Mobility Day',
      'Push Day',
    ])
    for (const entry of result) {
      expect(entry.exerciseCount).toBe(4)
      expect(entry.firstExercise?.orderInRoutine).toBe(0)
    }
  })

  it("returns the routine's first weighted exercise with full row fields (AE1)", async () => {
    const r = seedRoutine({ name: 'Push Day' })
    seedExercise(r.id, {
      name: 'Bench Press',
      type: 'weighted',
      orderInRoutine: 0,
      sets: 3,
      targetReps: 10,
      startingWeight: 105,
      increment: 5,
    })
    const [entry] = await listRoutinesForHome()
    expect(entry?.firstExercise?.name).toBe('Bench Press')
    expect(entry?.firstExercise?.targetReps).toBe(10)
    expect(entry?.firstExercise?.startingWeight).toBe(105)
  })

  it('returns [] without throwing when no non-archived routines exist (first-deploy)', async () => {
    expect(await listRoutinesForHome()).toEqual([])
  })

  it('returns exerciseCount=0 and firstExercise=null for a routine with no exercises', async () => {
    seedRoutine({ name: 'Empty Routine' })
    const [entry] = await listRoutinesForHome()
    expect(entry?.exerciseCount).toBe(0)
    expect(entry?.firstExercise).toBeNull()
  })

  it('excludes archived exercises from the count and from firstExercise', async () => {
    const r = seedRoutine({ name: 'Push Day' })
    seedExercise(r.id, {
      name: 'Archived',
      orderInRoutine: 0,
      archivedAt: new Date(),
    })
    seedExercise(r.id, { name: 'Active', orderInRoutine: 1 })
    const [entry] = await listRoutinesForHome()
    expect(entry?.exerciseCount).toBe(1)
    expect(entry?.firstExercise?.name).toBe('Active')
  })

  it('excludes archived routines entirely', async () => {
    seedRoutine({ name: 'Active' })
    const archived = seedRoutine({
      name: 'Archived',
      archivedAt: new Date(),
    })
    seedExercise(archived.id, { name: 'Bench', orderInRoutine: 0 })
    const result = await listRoutinesForHome()
    expect(result.map(r => r.routine.name)).toEqual(['Active'])
  })

  it('picks the lowest orderInRoutine non-archived exercise when earlier orders are archived', async () => {
    const r = seedRoutine({ name: 'Push' })
    for (let i = 0; i < 5; i++) {
      seedExercise(r.id, {
        name: `Old ${i}`,
        orderInRoutine: i,
        archivedAt: new Date(),
      })
    }
    seedExercise(r.id, { name: 'Survivor', orderInRoutine: 5 })
    const [entry] = await listRoutinesForHome()
    expect(entry?.firstExercise?.name).toBe('Survivor')
    expect(entry?.firstExercise?.orderInRoutine).toBe(5)
  })
})
