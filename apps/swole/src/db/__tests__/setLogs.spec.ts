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
  exercises,
  progressions,
  routines,
  sessions,
  setLogs,
} from 'src/db/schema'
import {
  appendSetLog,
  getSetLogsForSession,
  undoLastSetLog,
} from 'src/db/setLogs'
import { createTestDb, type TestDb } from 'src/db/test-db'

let testDb: TestDb
let sessionId: number
let exerciseId: number

beforeEach(() => {
  testDb = createTestDb()
  currentDb = testDb.db
  const r = testDb.db
    .insert(routines)
    .values({ name: 'Push', days: ['mon'] })
    .returning()
    .get()
  sessionId = testDb.db
    .insert(sessions)
    .values({ routineId: r.id })
    .returning()
    .get().id
  exerciseId = testDb.db
    .insert(exercises)
    .values({
      routineId: r.id,
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

const seedSetLog = (
  setNumber: number,
  loggedAt: Date,
  action: 'Stay' | 'Increment' | 'Decrement' = 'Stay',
) =>
  testDb.db
    .insert(setLogs)
    .values({
      sessionId,
      exerciseId,
      setNumber,
      weight: 100,
      targetReps: 10,
      actualReps: 10,
      action,
      loggedAt,
    })
    .run()

// ─── Reads ──────────────────────────────────────────────────────────────────

describe('getSetLogsForSession', () => {
  it('returns set_logs ordered by logged_at asc, id asc as tiebreak', async () => {
    const t0 = new Date('2026-05-27T10:00:00Z')
    const t1 = new Date('2026-05-27T10:01:00Z')
    const t2 = new Date('2026-05-27T10:02:00Z')
    seedSetLog(3, t2, 'Increment')
    seedSetLog(1, t0)
    seedSetLog(2, t1)
    const rows = await getSetLogsForSession({ sessionId })
    expect(rows.map(r => r.setNumber)).toEqual([1, 2, 3])
  })

  it('returns empty array when no logs', async () => {
    expect(await getSetLogsForSession({ sessionId })).toEqual([])
  })

  it('does not return logs from other sessions', async () => {
    const r2 = testDb.db
      .insert(routines)
      .values({ name: 'Pull', days: ['tue'] })
      .returning()
      .get()
    const otherSession = testDb.db
      .insert(sessions)
      .values({ routineId: r2.id })
      .returning()
      .get()
    testDb.db
      .insert(setLogs)
      .values({
        sessionId: otherSession.id,
        exerciseId,
        setNumber: 1,
        weight: 200,
        targetReps: 10,
        actualReps: 10,
        action: 'Stay',
      })
      .run()
    seedSetLog(1, new Date())
    const rows = await getSetLogsForSession({ sessionId })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.weight).toBe(100)
  })
})

// ─── Writes ─────────────────────────────────────────────────────────────────

describe('appendSetLog', () => {
  it('inserts a set_log and returns the row', async () => {
    const before = Date.now()
    const row = await appendSetLog({
      sessionId,
      exerciseId,
      setNumber: 1,
      weight: 100,
      targetReps: 10,
      actualReps: 10,
      action: 'Stay',
    })
    expect(row.id).toBeGreaterThan(0)
    expect(row.weight).toBe(100)
    expect(row.action).toBe('Stay')
    expect(row.loggedAt).toBeInstanceOf(Date)
    expect(row.loggedAt.getTime()).toBeGreaterThanOrEqual(before)
  })

  it('appears in getSetLogsForSession after insert', async () => {
    await appendSetLog({
      sessionId,
      exerciseId,
      setNumber: 1,
      weight: 100,
      targetReps: 10,
      actualReps: 10,
      action: 'Stay',
    })
    const list = await getSetLogsForSession({ sessionId })
    expect(list).toHaveLength(1)
  })

  it('throws DuplicateSetLog on duplicate (sessionId, exerciseId, setNumber) with existing.id matching the first insert (#37)', async () => {
    const first = await appendSetLog({
      sessionId,
      exerciseId,
      setNumber: 1,
      weight: 100,
      targetReps: 10,
      actualReps: 10,
      action: 'Stay',
    })
    const dup = appendSetLog({
      sessionId,
      exerciseId,
      setNumber: 1,
      weight: 110,
      targetReps: 10,
      actualReps: 9,
      action: 'Increment',
    })
    await expect(dup).rejects.toMatchObject({
      name: 'DuplicateSetLog',
      // Pins `existing.id === first.id` so a regression in the catch-branch
      // select predicate that returned a shape-matching but different row
      // (e.g. dropping the setNumber filter) would surface.
      existing: expect.objectContaining({
        id: first.id,
        sessionId,
        exerciseId,
        setNumber: 1,
        weight: 100,
        action: 'Stay',
      }),
    })
  })

  it('throws NotFoundError for nonexistent sessionId (read happens before the FK)', async () => {
    await expect(
      appendSetLog({
        sessionId: 99999,
        exerciseId,
        setNumber: 1,
        weight: 100,
        targetReps: 10,
        actualReps: 10,
        action: 'Stay',
      }),
    ).rejects.toThrow(/Session not found/)
  })

  it('throws SessionAlreadyCompleted when writing to a sealed session', async () => {
    testDb.db
      .update(sessions)
      .set({ completedAt: new Date() })
      .where(eq(sessions.id, sessionId))
      .run()
    await expect(
      appendSetLog({
        sessionId,
        exerciseId,
        setNumber: 1,
        weight: 100,
        targetReps: 10,
        actualReps: 10,
        action: 'Stay',
      }),
    ).rejects.toThrow(/Session \d+ is already completed/)
  })

  it('throws FK error on nonexistent exerciseId', async () => {
    await expect(
      appendSetLog({
        sessionId,
        exerciseId: 99999,
        setNumber: 1,
        weight: 100,
        targetReps: 10,
        actualReps: 10,
        action: 'Stay',
      }),
    ).rejects.toThrow(/FOREIGN KEY/)
  })

  it('throws CHECK error on setNumber = 0', async () => {
    await expect(
      appendSetLog({
        sessionId,
        exerciseId,
        setNumber: 0,
        weight: 100,
        targetReps: 10,
        actualReps: 10,
        action: 'Stay',
      }),
    ).rejects.toThrow(/CHECK/)
  })

  it('persists Failed action with actualReps', async () => {
    const row = await appendSetLog({
      sessionId,
      exerciseId,
      setNumber: 1,
      weight: 100,
      targetReps: 10,
      actualReps: 7, // Failed at rep 7
      action: 'Failed',
    })
    expect(row.action).toBe('Failed')
    expect(row.actualReps).toBe(7)
  })
})

describe('undoLastSetLog', () => {
  const seed = (
    setNumber: number,
    loggedAt: Date,
    action: 'Stay' | 'Increment' | 'Decrement' = 'Stay',
  ) =>
    testDb.db
      .insert(setLogs)
      .values({
        sessionId,
        exerciseId,
        setNumber,
        weight: 100,
        targetReps: 10,
        actualReps: 10,
        action,
        loggedAt,
      })
      .run()

  it('removes the most recent log by logged_at DESC', async () => {
    seed(1, new Date('2026-05-27T10:00:00Z'))
    seed(2, new Date('2026-05-27T10:01:00Z'))
    seed(3, new Date('2026-05-27T10:02:00Z'))
    await undoLastSetLog({ sessionId })
    const rows = await getSetLogsForSession({ sessionId })
    expect(rows.map(r => r.setNumber)).toEqual([1, 2])
  })

  it('tiebreaks ties on logged_at via id DESC', async () => {
    const t = new Date('2026-05-27T10:00:00Z')
    seed(1, t)
    seed(2, t)
    await undoLastSetLog({ sessionId })
    const rows = await getSetLogsForSession({ sessionId })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.setNumber).toBe(1)
  })

  it('no-op when no logs exist', async () => {
    await undoLastSetLog({ sessionId })
    expect(await getSetLogsForSession({ sessionId })).toEqual([])
  })

  it('throws UndoBlockedByCommittedProgression when a session_progression row exists', async () => {
    seed(1, new Date())
    testDb.db
      .insert(progressions)
      .values({
        exerciseId,
        sessionId,
        startingWeight: 105,
        reason: 'session_progression',
      })
      .run()
    await expect(undoLastSetLog({ sessionId })).rejects.toThrow(/Cannot undo/)
    expect(await getSetLogsForSession({ sessionId })).toHaveLength(1)
  })

  it('does NOT throw when only `initial` or `manual_edit` progressions exist', async () => {
    seed(1, new Date())
    testDb.db
      .insert(progressions)
      .values({
        exerciseId,
        startingWeight: 100,
        reason: 'initial',
      })
      .run()
    testDb.db
      .insert(progressions)
      .values({
        exerciseId,
        startingWeight: 110,
        reason: 'manual_edit',
      })
      .run()
    await undoLastSetLog({ sessionId })
    expect(await getSetLogsForSession({ sessionId })).toEqual([])
  })

  it('throws UndoBlockedBySessionCompleted on a sealed session with no progression row (#42)', async () => {
    seed(1, new Date())
    testDb.db
      .update(sessions)
      .set({ completedAt: new Date() })
      .where(eq(sessions.id, sessionId))
      .run()
    await expect(undoLastSetLog({ sessionId })).rejects.toThrow(
      /session is already completed/i,
    )
    expect(await getSetLogsForSession({ sessionId })).toHaveLength(1)
  })

  it('throws NotFoundError for a nonexistent session', async () => {
    await expect(undoLastSetLog({ sessionId: 99999 })).rejects.toThrow(
      /Session not found/,
    )
  })
})
