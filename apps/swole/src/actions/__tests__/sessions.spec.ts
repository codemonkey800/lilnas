let currentDb: import('drizzle-orm/better-sqlite3').BetterSQLite3Database<
  typeof import('src/db/schema')
>

jest.mock('src/db/client', () => ({
  get db() {
    return currentDb
  },
}))

const mockRevalidatePath = jest.fn()
jest.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
  revalidateTag: jest.fn(),
}))

import { deleteSession } from 'src/actions/sessions'
import { exercises, routines, sessions } from 'src/db/schema'
import { createTestDb, type TestDb } from 'src/db/test-db'

let testDb: TestDb
let routineId: number
let exerciseId: number

beforeEach(() => {
  testDb = createTestDb()
  currentDb = testDb.db
  mockRevalidatePath.mockClear()
  routineId = testDb.db
    .insert(routines)
    .values({ name: 'Push', days: ['mon'] })
    .returning()
    .get().id
  exerciseId = testDb.db
    .insert(exercises)
    .values({
      routineId,
      name: 'Bench',
      type: 'weighted',
      orderInRoutine: 0,
      sets: 3,
      targetReps: 10,
      startingWeight: 100,
      increment: 5,
    })
    .returning()
    .get().id
})

afterEach(() => {
  testDb.close()
})

function seedCompletedSession(): number {
  return testDb.db
    .insert(sessions)
    .values({ routineId, completedAt: new Date() })
    .returning()
    .get().id
}

describe('deleteSession action', () => {
  it('returns { ok: true } and revalidates / for a deletable session', async () => {
    const sessionId = seedCompletedSession()
    const result = await deleteSession({ sessionId })
    expect(result).toEqual({ ok: true, row: undefined })
    expect(mockRevalidatePath).toHaveBeenCalledWith('/')
  })

  it('returns { ok: false, code: SessionHasProgression } when a progression exists', async () => {
    const sessionId = seedCompletedSession()
    testDb.db
      .insert((await import('src/db/schema')).progressions)
      .values({
        exerciseId,
        sessionId,
        startingWeight: 105,
        reason: 'session_progression',
      })
      .run()
    const result = await deleteSession({ sessionId })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.kind).toBe('forbidden_transition')
      expect(result.code).toBe('SessionHasProgression')
    }
  })

  it('returns { ok: false, code: SessionNotCompleted } for an active session', async () => {
    const sessionId = testDb.db
      .insert(sessions)
      .values({ routineId })
      .returning()
      .get().id
    const result = await deleteSession({ sessionId })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('SessionNotCompleted')
    }
  })

  it('returns { ok: false, code: NotFoundError } for an unknown id', async () => {
    const result = await deleteSession({ sessionId: 99999 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('NotFoundError')
    }
  })

  it('rethrows non-DataLayerError', async () => {
    // Simulate by closing the DB so all queries throw
    testDb.close()
    await expect(deleteSession({ sessionId: 1 })).rejects.toThrow()
  })
})
