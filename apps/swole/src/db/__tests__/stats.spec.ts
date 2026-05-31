let currentDb: import('drizzle-orm/better-sqlite3').BetterSQLite3Database<
  typeof import('src/db/schema')
>

jest.mock('src/db/client', () => ({
  get db() {
    return currentDb
  },
}))

import {
  exercises,
  progressions,
  routines,
  sessions,
  setLogs,
} from 'src/db/schema'
import { getStatsIndexData } from 'src/db/stats'
import { createTestDb, type TestDb } from 'src/db/test-db'

let testDb: TestDb

beforeEach(() => {
  testDb = createTestDb()
  currentDb = testDb.db
})

afterEach(() => {
  testDb.close()
})

// ─── Seed helpers ─────────────────────────────────────────────────────────────

const seedRoutine = (overrides: Partial<typeof routines.$inferInsert> = {}) =>
  testDb.db
    .insert(routines)
    .values({
      name: 'Push Day',
      days: ['mon', 'wed', 'fri'],
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
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

const seedSession = (routineId: number, completedAt?: Date | null) =>
  testDb.db
    .insert(sessions)
    .values({
      routineId,
      startedAt: completedAt ?? new Date('2026-05-01T10:00:00Z'),
      completedAt: completedAt ?? new Date('2026-05-01T11:00:00Z'),
    })
    .returning()
    .get()

const seedSetLog = (
  sessionId: number,
  exerciseId: number,
  overrides: Partial<typeof setLogs.$inferInsert> = {},
) =>
  testDb.db
    .insert(setLogs)
    .values({
      sessionId,
      exerciseId,
      setNumber: 1,
      weight: 135,
      targetReps: 10,
      actualReps: 10,
      action: 'Complete',
      loggedAt: new Date('2026-05-01T10:30:00Z'),
      ...overrides,
    })
    .returning()
    .get()

const seedProgression = (
  exerciseId: number,
  startingWeight: number,
  effectiveFrom: Date,
) =>
  testDb.db
    .insert(progressions)
    .values({
      exerciseId,
      startingWeight,
      reason: 'initial',
      effectiveFrom,
    })
    .returning()
    .get()

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('getStatsIndexData', () => {
  describe('empty-guard', () => {
    it('clean DB → returns all-empty shape without throwing', async () => {
      const data = await getStatsIndexData()
      expect(data.scope).toEqual({ kind: 'all' })
      expect(data.routines).toEqual([])
      expect(data.exercises).toEqual([])
      expect(data.sessions).toEqual([])
      expect(data.lastPerformedByExercise.size).toBe(0)
      expect(data.weightedSetLogs).toEqual([])
      expect(data.archivedWithHistory).toEqual([])
    })

    it('routines exist but have no exercises → exercises empty, no throw', async () => {
      seedRoutine()
      const data = await getStatsIndexData()
      expect(data.exercises).toEqual([])
      expect(data.sessions).toEqual([])
    })

    it('scope = active routine with no exercises → exercises empty', async () => {
      const r = seedRoutine()
      const data = await getStatsIndexData(String(r.id))
      expect(data.scope).toEqual({ kind: 'active', id: r.id })
      expect(data.exercises).toEqual([])
    })

    it('only-archived scope with no in-scope routines → empty', async () => {
      // Archived routine without history → scope falls back to all (which is empty)
      seedRoutine({ archivedAt: new Date() })
      const data = await getStatsIndexData()
      expect(data.scope).toEqual({ kind: 'all' })
      expect(data.routines).toEqual([])
    })
  })

  describe('scope = all (default)', () => {
    it('returns active routines and their exercises', async () => {
      const r1 = seedRoutine({ name: 'A Push' })
      const r2 = seedRoutine({ name: 'B Pull' })
      const e1 = seedExercise(r1.id)
      seedExercise(r2.id)

      const data = await getStatsIndexData()
      expect(data.scope).toEqual({ kind: 'all' })
      expect(data.routines.map(r => r.id)).toContain(r1.id)
      expect(data.exercises.length).toBe(2)
      expect(data.exercises[0]!.id).toBe(e1.id) // ordered by routineId, orderInRoutine
    })

    it('excludes archived exercises from All scope', async () => {
      const r = seedRoutine()
      seedExercise(r.id, { name: 'Active' })
      seedExercise(r.id, {
        name: 'Archived',
        orderInRoutine: 1,
        archivedAt: new Date(),
      })

      const data = await getStatsIndexData()
      expect(data.exercises.map(e => e.name)).toEqual(['Active'])
    })

    it('excludes archived routines from All scope (model C)', async () => {
      const active = seedRoutine({ name: 'Active' })
      const archived = seedRoutine({ name: 'Archived', archivedAt: new Date() })
      seedExercise(active.id)
      seedExercise(archived.id)

      const data = await getStatsIndexData()
      expect(data.routines.map(r => r.id)).toContain(active.id)
      expect(data.routines.map(r => r.id)).not.toContain(archived.id)
      expect(data.exercises.every(e => e.routineId === active.id)).toBe(true)
    })
  })

  describe('scope = active routine', () => {
    it('filters exercises to only that routine', async () => {
      const r1 = seedRoutine({ name: 'Push' })
      const r2 = seedRoutine({ name: 'Pull' })
      const e1 = seedExercise(r1.id)
      seedExercise(r2.id)

      const data = await getStatsIndexData(String(r1.id))
      expect(data.scope).toEqual({ kind: 'active', id: r1.id })
      expect(data.exercises.map(e => e.id)).toEqual([e1.id])
    })

    it('includes only sessions for that routine', async () => {
      const r1 = seedRoutine({ name: 'Push' })
      const r2 = seedRoutine({ name: 'Pull' })
      seedExercise(r1.id)
      seedExercise(r2.id)
      const s1 = seedSession(r1.id)
      seedSession(r2.id)

      const data = await getStatsIndexData(String(r1.id))
      expect(data.sessions.map(s => s.id)).toEqual([s1.id])
    })
  })

  describe('scope = archived-with-history', () => {
    it('reads archived exercises for that routine', async () => {
      const r = seedRoutine({ archivedAt: new Date() })
      const e = seedExercise(r.id, { archivedAt: new Date() })
      seedSession(r.id)

      const data = await getStatsIndexData(String(r.id))
      expect(data.scope).toEqual({ kind: 'archived', id: r.id })
      expect(data.exercises.map(ex => ex.id)).toContain(e.id)
    })

    it('includes completed sessions for the archived routine', async () => {
      const r = seedRoutine({ archivedAt: new Date() })
      seedExercise(r.id)
      const s = seedSession(r.id)

      const data = await getStatsIndexData(String(r.id))
      expect(data.sessions.map(s => s.id)).toContain(s.id)
    })

    it('unresolvable archived-without-history → falls back to All', async () => {
      const archived = seedRoutine({ archivedAt: new Date() })
      // No session → not in archivedWithHistory → resolves to 'all'
      const data = await getStatsIndexData(String(archived.id))
      expect(data.scope).toEqual({ kind: 'all' })
    })
  })

  describe('archived-with-history detection', () => {
    it('flags archived routines with ≥1 completed session', async () => {
      const archived = seedRoutine({ archivedAt: new Date() })
      seedExercise(archived.id)
      seedSession(archived.id)

      const data = await getStatsIndexData()
      expect(data.archivedWithHistory.map(r => r.id)).toContain(archived.id)
    })

    it('does not flag archived routine with no sessions', async () => {
      const archived = seedRoutine({ archivedAt: new Date() })
      seedExercise(archived.id)
      // No session

      const data = await getStatsIndexData()
      expect(data.archivedWithHistory).toHaveLength(0)
    })
  })

  describe('last-performed aggregate', () => {
    it('records the most recent completedAt per exercise', async () => {
      const r = seedRoutine()
      const e = seedExercise(r.id)
      const earlier = new Date('2026-04-01T10:00:00Z')
      const later = new Date('2026-05-01T10:00:00Z')
      const s1 = seedSession(r.id, earlier)
      const s2 = seedSession(r.id, later)
      seedSetLog(s1.id, e.id, { setNumber: 1 })
      seedSetLog(s2.id, e.id, { setNumber: 1 })

      const data = await getStatsIndexData()
      const lastDone = data.lastPerformedByExercise.get(e.id)
      expect(lastDone).toBeDefined()
      expect(lastDone!.getTime()).toBe(later.getTime())
    })

    it('exercise with no set logs → not in lastPerformedByExercise', async () => {
      const r = seedRoutine()
      const e = seedExercise(r.id)

      const data = await getStatsIndexData()
      expect(data.lastPerformedByExercise.has(e.id)).toBe(false)
    })

    it('incomplete session set log does not advance last-performed date', async () => {
      const r = seedRoutine()
      const e = seedExercise(r.id)
      const completedAt = new Date('2026-04-01T10:00:00Z')
      const completed = seedSession(r.id, completedAt)
      // Incomplete session has a later set log — must be excluded.
      const incomplete = seedSession(r.id, null)
      seedSetLog(completed.id, e.id, { setNumber: 1 })
      seedSetLog(incomplete.id, e.id, {
        setNumber: 1,
        loggedAt: new Date('2026-05-01T10:30:00Z'),
      })

      const data = await getStatsIndexData()
      const lastDone = data.lastPerformedByExercise.get(e.id)
      expect(lastDone).toBeDefined()
      expect(lastDone!.getTime()).toBe(completedAt.getTime())
    })
  })

  describe('weighted split', () => {
    it('fetches set logs only for weighted exercises', async () => {
      const r = seedRoutine()
      const w = seedExercise(r.id, { name: 'Bench', type: 'weighted' })
      const bw = seedExercise(r.id, {
        name: 'Pushups',
        type: 'bodyweight',
        orderInRoutine: 1,
        startingWeight: null,
        increment: null,
      })
      const s = seedSession(r.id)
      seedSetLog(s.id, w.id, { setNumber: 1 })
      seedSetLog(s.id, bw.id, {
        setNumber: 1,
        weight: null,
        action: 'Complete',
      })

      const data = await getStatsIndexData()
      const loggedExerciseIds = data.weightedSetLogs.map(
        l => l.setLog.exerciseId,
      )
      expect(loggedExerciseIds).toContain(w.id)
      expect(loggedExerciseIds).not.toContain(bw.id)
    })

    it('non-weighted exercises still appear in lastPerformedByExercise', async () => {
      const r = seedRoutine()
      const bw = seedExercise(r.id, {
        name: 'Pushups',
        type: 'bodyweight',
        startingWeight: null,
        increment: null,
      })
      const s = seedSession(r.id)
      seedSetLog(s.id, bw.id, {
        setNumber: 1,
        weight: null,
        action: 'Complete',
      })

      const data = await getStatsIndexData()
      expect(data.lastPerformedByExercise.has(bw.id)).toBe(true)
      expect(data.progressionsByExercise.has(bw.id)).toBe(false)
    })
  })

  describe('progressions', () => {
    it('groups progressions by exercise, oldest-first', async () => {
      const r = seedRoutine()
      const e = seedExercise(r.id)
      seedProgression(e.id, 100, new Date('2026-01-01T00:00:00Z'))
      seedProgression(e.id, 105, new Date('2026-02-01T00:00:00Z'))

      const data = await getStatsIndexData()
      const progs = data.progressionsByExercise.get(e.id)
      expect(progs).toHaveLength(2)
      expect(progs![0]!.startingWeight).toBe(100)
      expect(progs![1]!.startingWeight).toBe(105)
    })
  })

  describe('sessions', () => {
    it('only includes completed sessions (completedAt IS NOT NULL)', async () => {
      const r = seedRoutine()
      seedExercise(r.id)
      const completed = seedSession(r.id, new Date('2026-05-01T11:00:00Z'))
      // Active (incomplete) session
      testDb.db
        .insert(sessions)
        .values({ routineId: r.id, startedAt: new Date(), completedAt: null })
        .run()

      const data = await getStatsIndexData()
      expect(data.sessions.map(s => s.id)).toEqual([completed.id])
    })
  })

  describe('activeRoutines field (for selector)', () => {
    it('always returns all active routines regardless of scope', async () => {
      const r1 = seedRoutine({ name: 'Active 1' })
      const r2 = seedRoutine({ name: 'Active 2' })
      const archived = seedRoutine({ name: 'Archived', archivedAt: new Date() })
      seedExercise(r1.id)
      seedExercise(r2.id)
      seedExercise(archived.id)
      seedSession(archived.id)

      // When scoped to r1, activeRoutines should still include r1 and r2
      const data = await getStatsIndexData(String(r1.id))
      expect(data.activeRoutines.map(r => r.id)).toContain(r1.id)
      expect(data.activeRoutines.map(r => r.id)).toContain(r2.id)
      expect(data.activeRoutines.map(r => r.id)).not.toContain(archived.id)
    })
  })

  describe('archived last-trained aggregate', () => {
    it('happy path: archived routine with two sessions → map holds the later one', async () => {
      const r = seedRoutine({ archivedAt: new Date() })
      const earlier = new Date('2026-03-01T10:00:00Z')
      const later = new Date('2026-05-01T10:00:00Z')
      seedSession(r.id, earlier)
      seedSession(r.id, later)

      const data = await getStatsIndexData()
      const lastTrained = data.archivedLastTrained.get(r.id)
      expect(lastTrained).toBeDefined()
      expect(lastTrained!.getTime()).toBe(later.getTime())
    })

    it('edge: one completed + one incomplete session → map holds the completed one', async () => {
      const r = seedRoutine({ archivedAt: new Date() })
      const completedAt = new Date('2026-04-01T10:00:00Z')
      seedSession(r.id, completedAt)
      seedSession(r.id, null)

      const data = await getStatsIndexData()
      const lastTrained = data.archivedLastTrained.get(r.id)
      expect(lastTrained).toBeDefined()
      expect(lastTrained!.getTime()).toBe(completedAt.getTime())
    })

    it('edge: active (non-archived) routine → not present in archivedLastTrained', async () => {
      const active = seedRoutine({ name: 'Active' })
      seedExercise(active.id)
      seedSession(active.id)

      const data = await getStatsIndexData()
      expect(data.archivedLastTrained.has(active.id)).toBe(false)
    })

    it('invariant: archivedLastTrained key set equals archivedWithHistory id set', async () => {
      const a1 = seedRoutine({ name: 'A', archivedAt: new Date() })
      const a2 = seedRoutine({ name: 'B', archivedAt: new Date() })
      const noHistory = seedRoutine({ name: 'C', archivedAt: new Date() })
      seedSession(a1.id)
      seedSession(a2.id)
      // noHistory has no session

      const data = await getStatsIndexData()
      const historyIds = new Set(data.archivedWithHistory.map(r => r.id))
      const mapIds = new Set(data.archivedLastTrained.keys())
      expect(mapIds).toEqual(historyIds)
      expect(data.archivedLastTrained.has(noHistory.id)).toBe(false)
    })

    it('edge: clean DB → archivedLastTrained.size === 0', async () => {
      const data = await getStatsIndexData()
      expect(data.archivedLastTrained.size).toBe(0)
    })

    it('early-return path: archived-with-history exists but scope has no exercises → archivedLastTrained still populated', async () => {
      const archived = seedRoutine({ name: 'Archived', archivedAt: new Date() })
      const active = seedRoutine({ name: 'Active' })
      // archived routine has a session but NO exercises → exerciseList.length === 0 early return
      seedSession(archived.id)
      // active routine has an exercise but scope goes to that routine
      seedExercise(active.id)

      // Get data scoped to active (which has exercises) but check archivedLastTrained
      const data = await getStatsIndexData(String(active.id))
      expect(data.archivedLastTrained.has(archived.id)).toBe(true)
    })
  })
})
