let currentDb: import('drizzle-orm/better-sqlite3').BetterSQLite3Database<
  typeof import('src/db/schema')
>

jest.mock('src/db/client', () => ({
  get db() {
    return currentDb
  },
}))

import { eq } from 'drizzle-orm'

import { routines, sessions } from 'src/db/schema'
import {
  completeSession,
  getActiveSession,
  getMostRecentActiveSession,
  getSession,
  listRecentCompletedSessions,
  listSessionsForRoutine,
  startSession,
} from 'src/db/sessions'
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

const seedSession = (overrides: Partial<typeof sessions.$inferInsert> = {}) =>
  testDb.db
    .insert(sessions)
    .values({ routineId, ...overrides })
    .returning()
    .get()

// ─── Reads ──────────────────────────────────────────────────────────────────

describe('getSession', () => {
  it('returns the row when it exists', async () => {
    const s = seedSession()
    const result = await getSession({ id: s.id })
    expect(result?.id).toBe(s.id)
  })

  it('returns null when nonexistent', async () => {
    expect(await getSession({ id: 99999 })).toBeNull()
  })
})

describe('listSessionsForRoutine', () => {
  it('returns all sessions by default', async () => {
    seedSession({ completedAt: new Date() })
    seedSession()
    const result = await listSessionsForRoutine({ routineId })
    expect(result).toHaveLength(2)
  })

  it('filters to completed-only when completedOnly: true', async () => {
    seedSession({ completedAt: new Date() })
    seedSession()
    const result = await listSessionsForRoutine({
      routineId,
      completedOnly: true,
    })
    expect(result).toHaveLength(1)
    expect(result[0]?.completedAt).not.toBeNull()
  })

  it('returns empty array for nonexistent routine', async () => {
    expect(await listSessionsForRoutine({ routineId: 99999 })).toEqual([])
  })
})

describe('getActiveSession', () => {
  it('returns the row when completedAt is null', async () => {
    const s = seedSession()
    const result = await getActiveSession({ id: s.id })
    expect(result?.id).toBe(s.id)
  })

  it('returns null when the session is completed', async () => {
    const s = seedSession({ completedAt: new Date() })
    expect(await getActiveSession({ id: s.id })).toBeNull()
  })

  it('returns null when the session does not exist', async () => {
    expect(await getActiveSession({ id: 99999 })).toBeNull()
  })
})

describe('getMostRecentActiveSession', () => {
  it('returns the more-recently-started of two active sessions on different routines', async () => {
    const otherRoutineId = testDb.db
      .insert(routines)
      .values({ name: 'Pull', days: ['tue'] })
      .returning()
      .get().id
    const earlier = seedSession({
      startedAt: new Date('2026-05-27T08:00:00Z'),
    })
    const later = testDb.db
      .insert(sessions)
      .values({
        routineId: otherRoutineId,
        startedAt: new Date('2026-05-27T08:10:00Z'),
      })
      .returning()
      .get()
    const result = await getMostRecentActiveSession()
    expect(result?.id).toBe(later.id)
    expect(result?.id).not.toBe(earlier.id)
  })

  it('returns the active session when others are completed', async () => {
    seedSession({ completedAt: new Date() })
    seedSession({ completedAt: new Date() })
    const active = await startSession({ routineId })
    const result = await getMostRecentActiveSession()
    expect(result?.id).toBe(active.id)
  })

  it('returns null when all sessions are completed', async () => {
    seedSession({ completedAt: new Date() })
    expect(await getMostRecentActiveSession()).toBeNull()
  })

  it('returns null when no sessions exist', async () => {
    expect(await getMostRecentActiveSession()).toBeNull()
  })

  it('breaks startedAt ties by higher id', async () => {
    const otherRoutineId = testDb.db
      .insert(routines)
      .values({ name: 'Pull', days: ['tue'] })
      .returning()
      .get().id
    const tied = new Date('2026-05-27T08:00:00Z')
    seedSession({ startedAt: tied })
    const second = testDb.db
      .insert(sessions)
      .values({ routineId: otherRoutineId, startedAt: tied })
      .returning()
      .get()
    const result = await getMostRecentActiveSession()
    expect(result?.id).toBe(second.id)
  })

  it('integrates with startSession — returns the new row', async () => {
    const created = await startSession({ routineId })
    const result = await getMostRecentActiveSession()
    expect(result?.id).toBe(created.id)
  })

  it('integrates with completeSession — returns null after the only active session completes', async () => {
    const created = await startSession({ routineId })
    await completeSession({ sessionId: created.id })
    expect(await getMostRecentActiveSession()).toBeNull()
  })
})

describe('listRecentCompletedSessions', () => {
  it('returns 5 most recent completed sessions across routines, ordered completedAt DESC', async () => {
    const pullRoutineId = testDb.db
      .insert(routines)
      .values({ name: 'Pull', days: ['tue'] })
      .returning()
      .get().id

    const base = new Date('2026-05-27T08:00:00Z').getTime()
    // Seed 7 completed sessions; rows are returned in completedAt DESC, so
    // the 5 most recent are the last 5 we insert.
    for (let i = 0; i < 7; i++) {
      const targetRoutineId = i % 2 === 0 ? routineId : pullRoutineId
      testDb.db
        .insert(sessions)
        .values({
          routineId: targetRoutineId,
          startedAt: new Date(base + i * 60_000),
          completedAt: new Date(base + i * 60_000 + 30_000),
        })
        .run()
    }
    const result = await listRecentCompletedSessions({ limit: 5 })
    expect(result).toHaveLength(5)
    for (let i = 0; i < result.length - 1; i++) {
      const a = result[i]!.session.completedAt!.getTime()
      const b = result[i + 1]!.session.completedAt!.getTime()
      expect(a).toBeGreaterThanOrEqual(b)
    }
  })

  it('each row carries the correct routine via the join', async () => {
    seedSession({ completedAt: new Date() })
    const [row] = await listRecentCompletedSessions({ limit: 5 })
    expect(row?.routine.id).toBe(row?.session.routineId)
  })

  it('returns [] when no completed sessions exist (only active ones)', async () => {
    // Only one active session per routine is allowed by the partial unique
    // index, so seed two on different routines.
    const otherRoutineId = testDb.db
      .insert(routines)
      .values({ name: 'Pull', days: ['tue'] })
      .returning()
      .get().id
    seedSession()
    testDb.db.insert(sessions).values({ routineId: otherRoutineId }).run()
    expect(await listRecentCompletedSessions({ limit: 5 })).toEqual([])
  })

  it('returns all five when exactly five completed sessions exist', async () => {
    for (let i = 0; i < 5; i++) {
      testDb.db
        .insert(sessions)
        .values({
          routineId,
          startedAt: new Date(2026, 0, 1, 0, i),
          completedAt: new Date(2026, 0, 1, 1, i),
        })
        .run()
    }
    const result = await listRecentCompletedSessions({ limit: 5 })
    expect(result).toHaveLength(5)
  })

  it('still includes completed sessions on archived routines (history is preserved)', async () => {
    seedSession({ completedAt: new Date() })
    testDb.db
      .update(routines)
      .set({ archivedAt: new Date() })
      .where(eq(routines.id, routineId))
      .run()
    const result = await listRecentCompletedSessions({ limit: 5 })
    expect(result).toHaveLength(1)
    expect(result[0]?.routine.archivedAt).toBeInstanceOf(Date)
  })

  it('breaks completedAt ties by higher id', async () => {
    const tied = new Date('2026-05-27T08:00:00Z')
    const a = testDb.db
      .insert(sessions)
      .values({ routineId, completedAt: tied })
      .returning()
      .get()
    const b = testDb.db
      .insert(sessions)
      .values({ routineId, completedAt: tied })
      .returning()
      .get()
    const result = await listRecentCompletedSessions({ limit: 5 })
    expect(result[0]?.session.id).toBe(b.id)
    expect(result[1]?.session.id).toBe(a.id)
  })
})

// ─── Writes ─────────────────────────────────────────────────────────────────

describe('startSession', () => {
  it('inserts a session row with completedAt = null', async () => {
    const session = await startSession({ routineId })
    expect(session.id).toBeGreaterThan(0)
    expect(session.routineId).toBe(routineId)
    expect(session.completedAt).toBeNull()
    expect(session.startedAt).toBeInstanceOf(Date)
  })

  it('throws NotFoundError for nonexistent routine', async () => {
    // We validate inside BEGIN IMMEDIATE before reaching the FK, so the
    // tagged error wins over the raw FOREIGN KEY message.
    await expect(startSession({ routineId: 99999 })).rejects.toThrow(
      /Routine not found/,
    )
  })

  it('throws RoutineArchived when the routine is archived', async () => {
    testDb.db
      .update(routines)
      .set({ archivedAt: new Date() })
      .where(eq(routines.id, routineId))
      .run()
    await expect(startSession({ routineId })).rejects.toThrow(
      /Routine \d+ is archived/,
    )
  })

  it('throws RoutineAlreadyHasActiveSession on second concurrent start', async () => {
    await startSession({ routineId })
    await expect(startSession({ routineId })).rejects.toThrow(
      /already has an active.*session/i,
    )
  })

  it('allows a new session after the prior completes', async () => {
    const first = await startSession({ routineId })
    await completeSession({ sessionId: first.id })
    const second = await startSession({ routineId })
    expect(second.id).not.toBe(first.id)
  })
})

describe('completeSession', () => {
  it('sets completedAt to ~now', async () => {
    const s = await startSession({ routineId })
    const before = Date.now()
    const completed = await completeSession({ sessionId: s.id })
    expect(completed.completedAt).toBeInstanceOf(Date)
    expect(completed.completedAt!.getTime()).toBeGreaterThanOrEqual(before)
  })

  it('is idempotent — second call returns the same row without re-bumping completedAt', async () => {
    const s = await startSession({ routineId })
    const first = await completeSession({ sessionId: s.id })
    await new Promise(r => setTimeout(r, 10))
    const second = await completeSession({ sessionId: s.id })
    expect(second.completedAt!.getTime()).toBe(first.completedAt!.getTime())
  })

  it('concurrent Promise.all([completeSession, completeSession]) is idempotent (#38)', async () => {
    // Two simultaneous calls (UI double-click / retry). With completeSession
    // wrapped in BEGIN IMMEDIATE, the second blocks on the write lock and
    // then observes completedAt non-null. Both promises resolve with the
    // same completedAt timestamp.
    const s = await startSession({ routineId })
    const [a, b] = await Promise.all([
      completeSession({ sessionId: s.id }),
      completeSession({ sessionId: s.id }),
    ])
    expect(a.completedAt).toBeInstanceOf(Date)
    expect(b.completedAt).toBeInstanceOf(Date)
    expect(a.completedAt!.getTime()).toBe(b.completedAt!.getTime())
    const row = testDb.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, s.id))
      .get()
    expect(row?.completedAt!.getTime()).toBe(a.completedAt!.getTime())
  })

  it('throws NotFoundError for nonexistent id', async () => {
    await expect(completeSession({ sessionId: 99999 })).rejects.toThrow(
      /Session not found/,
    )
  })
})
