import fs from 'node:fs'
import path from 'node:path'

import { eq, isNull } from 'drizzle-orm'

import {
  exercises,
  progressions,
  routines,
  sessions,
  setLogs,
} from 'src/db/schema'
import { createTestDb, type TestDb } from 'src/db/test-db'

let testDb: TestDb

beforeEach(() => {
  testDb = createTestDb()
})

afterEach(() => {
  testDb.close()
})

const insertRoutine = (overrides: Partial<typeof routines.$inferInsert> = {}) =>
  testDb.db
    .insert(routines)
    .values({
      name: 'Push Day',
      days: ['mon', 'wed', 'fri'],
      ...overrides,
    })
    .returning()
    .get()

const insertWeighted = (
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

describe('schema module', () => {
  describe('routines', () => {
    it('rejects deleting a routine that has child sessions (RESTRICT)', () => {
      const routine = insertRoutine()
      testDb.db
        .insert(sessions)
        .values({ routineId: routine.id })
        .returning()
        .get()
      expect(() =>
        testDb.db.delete(routines).where(eq(routines.id, routine.id)).run(),
      ).toThrow(/FOREIGN KEY/)
    })

    it('archived rows can be filtered out with isNull(archivedAt)', () => {
      const a = insertRoutine({ name: 'Active' })
      insertRoutine({ name: 'Archived', archivedAt: new Date() })
      const active = testDb.db
        .select()
        .from(routines)
        .where(isNull(routines.archivedAt))
        .all()
      expect(active).toHaveLength(1)
      expect(active[0]?.id).toBe(a.id)
    })
  })

  describe('exercises', () => {
    let routineId: number

    beforeEach(() => {
      routineId = insertRoutine().id
    })

    it('rejects weighted insert without starting_weight (CHECK)', () => {
      expect(() =>
        testDb.db
          .insert(exercises)
          .values({
            routineId,
            name: 'Bench',
            type: 'weighted',
            orderInRoutine: 0,
            sets: 3,
            targetReps: 10,
            startingWeight: null,
            increment: 5,
          })
          .run(),
      ).toThrow(/CHECK/)
    })

    it('rejects bodyweight insert with starting_weight (CHECK)', () => {
      expect(() =>
        testDb.db
          .insert(exercises)
          .values({
            routineId,
            name: 'Pushups',
            type: 'bodyweight',
            orderInRoutine: 0,
            sets: 3,
            targetReps: 10,
            startingWeight: 50,
          })
          .run(),
      ).toThrow(/CHECK/)
    })

    it('rejects time-based insert with target_reps (CHECK)', () => {
      expect(() =>
        testDb.db
          .insert(exercises)
          .values({
            routineId,
            name: 'Plank',
            type: 'time-based',
            orderInRoutine: 0,
            sets: 3,
            targetReps: 5,
            durationSeconds: 30,
          })
          .run(),
      ).toThrow(/CHECK/)
    })

    it('rejects cardio insert with sets != 1 (CHECK)', () => {
      expect(() =>
        testDb.db
          .insert(exercises)
          .values({
            routineId,
            name: 'Treadmill',
            type: 'cardio',
            orderInRoutine: 0,
            sets: 3,
            durationSeconds: 600,
          })
          .run(),
      ).toThrow(/CHECK/)
    })

    it('rejects sets = 0 (CHECK exercise_sets_positive)', () => {
      expect(() =>
        testDb.db
          .insert(exercises)
          .values({
            routineId,
            name: 'Bench',
            type: 'weighted',
            orderInRoutine: 0,
            sets: 0,
            targetReps: 10,
            startingWeight: 100,
            increment: 5,
          })
          .run(),
      ).toThrow(/CHECK/)
    })

    it('accepts valid weighted, bodyweight, time-based, and cardio inserts', () => {
      const w = insertWeighted(routineId)
      expect(w.type).toBe('weighted')
      const b = testDb.db
        .insert(exercises)
        .values({
          routineId,
          name: 'Pushups',
          type: 'bodyweight',
          orderInRoutine: 1,
          sets: 3,
          targetReps: 15,
        })
        .returning()
        .get()
      expect(b.type).toBe('bodyweight')
      const t = testDb.db
        .insert(exercises)
        .values({
          routineId,
          name: 'Plank',
          type: 'time-based',
          orderInRoutine: 2,
          sets: 3,
          durationSeconds: 30,
        })
        .returning()
        .get()
      expect(t.type).toBe('time-based')
      const c = testDb.db
        .insert(exercises)
        .values({
          routineId,
          name: 'Treadmill',
          type: 'cardio',
          orderInRoutine: 3,
          sets: 1,
          durationSeconds: 600,
        })
        .returning()
        .get()
      expect(c.type).toBe('cardio')
    })
  })

  describe('sessions', () => {
    it('partial unique index rejects a second active session on the same routine', () => {
      const r = insertRoutine()
      testDb.db.insert(sessions).values({ routineId: r.id }).run()
      expect(() =>
        testDb.db.insert(sessions).values({ routineId: r.id }).run(),
      ).toThrow(/UNIQUE/)
    })

    it('partial unique index allows a new session after the prior is completed', () => {
      const r = insertRoutine()
      const first = testDb.db
        .insert(sessions)
        .values({ routineId: r.id })
        .returning()
        .get()
      testDb.db
        .update(sessions)
        .set({ completedAt: new Date() })
        .where(eq(sessions.id, first.id))
        .run()
      const second = testDb.db
        .insert(sessions)
        .values({ routineId: r.id })
        .returning()
        .get()
      expect(second.id).not.toBe(first.id)
    })

    it('allows two completed sessions on the same routine', () => {
      const r = insertRoutine()
      const a = testDb.db
        .insert(sessions)
        .values({ routineId: r.id, completedAt: new Date() })
        .returning()
        .get()
      const b = testDb.db
        .insert(sessions)
        .values({ routineId: r.id, completedAt: new Date() })
        .returning()
        .get()
      expect(a.id).not.toBe(b.id)
    })
  })

  describe('set_logs', () => {
    let sessionId: number
    let exerciseId: number

    beforeEach(() => {
      const r = insertRoutine()
      sessionId = testDb.db
        .insert(sessions)
        .values({ routineId: r.id })
        .returning()
        .get().id
      exerciseId = insertWeighted(r.id).id
    })

    it('UNIQUE (session_id, exercise_id, set_number) rejects duplicate inserts', () => {
      testDb.db
        .insert(setLogs)
        .values({
          sessionId,
          exerciseId,
          setNumber: 1,
          weight: 100,
          targetReps: 10,
          actualReps: 10,
          action: 'Stay',
        })
        .run()
      expect(() =>
        testDb.db
          .insert(setLogs)
          .values({
            sessionId,
            exerciseId,
            setNumber: 1,
            weight: 105,
            targetReps: 10,
            actualReps: 10,
            action: 'Increment',
          })
          .run(),
      ).toThrow(/UNIQUE/)
    })

    it('rejects set_number = 0 (CHECK set_number_one_indexed)', () => {
      expect(() =>
        testDb.db
          .insert(setLogs)
          .values({
            sessionId,
            exerciseId,
            setNumber: 0,
            weight: 100,
            targetReps: 10,
            actualReps: 10,
            action: 'Stay',
          })
          .run(),
      ).toThrow(/CHECK/)
    })

    it('rejects insert with nonexistent session_id (FK)', () => {
      expect(() =>
        testDb.db
          .insert(setLogs)
          .values({
            sessionId: 99999,
            exerciseId,
            setNumber: 1,
            weight: 100,
            targetReps: 10,
            actualReps: 10,
            action: 'Stay',
          })
          .run(),
      ).toThrow(/FOREIGN KEY/)
    })

    it('rejects insert with nonexistent exercise_id (FK)', () => {
      expect(() =>
        testDb.db
          .insert(setLogs)
          .values({
            sessionId,
            exerciseId: 99999,
            setNumber: 1,
            weight: 100,
            targetReps: 10,
            actualReps: 10,
            action: 'Stay',
          })
          .run(),
      ).toThrow(/FOREIGN KEY/)
    })
  })

  describe('progressions', () => {
    it('rejects deleting an exercise that has progression rows (RESTRICT)', () => {
      const r = insertRoutine()
      const ex = insertWeighted(r.id)
      testDb.db
        .insert(progressions)
        .values({
          exerciseId: ex.id,
          startingWeight: 100,
          reason: 'initial',
        })
        .run()
      expect(() =>
        testDb.db.delete(exercises).where(eq(exercises.id, ex.id)).run(),
      ).toThrow(/FOREIGN KEY/)
    })

    it('allows null session_id (initial / manual_edit) and non-null (session_progression)', () => {
      const r = insertRoutine()
      const ex = insertWeighted(r.id)
      const s = testDb.db
        .insert(sessions)
        .values({ routineId: r.id })
        .returning()
        .get()
      const initial = testDb.db
        .insert(progressions)
        .values({
          exerciseId: ex.id,
          startingWeight: 100,
          reason: 'initial',
        })
        .returning()
        .get()
      expect(initial.sessionId).toBeNull()
      const sp = testDb.db
        .insert(progressions)
        .values({
          exerciseId: ex.id,
          sessionId: s.id,
          startingWeight: 105,
          reason: 'session_progression',
        })
        .returning()
        .get()
      expect(sp.sessionId).toBe(s.id)
    })
  })

  describe('migration SQL regression', () => {
    // Concatenates every committed migration so the assertions don't bind to
    // a specific filename. Future migrations that introduce new tables or
    // indexes don't break this test, and a regression that drops one of the
    // pinned CHECK clauses from the schema would still surface here.
    it('committed migrations include all four exercise type-branch CHECK clauses and set_number CHECK', () => {
      // Test file lives in db/__tests__/, migrations live in db/migrations/.
      const migrationsDir = path.join(__dirname, '..', 'migrations')
      const files = fs
        .readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort()
      expect(files.length).toBeGreaterThan(0)
      const sql = files
        .map(f => fs.readFileSync(path.join(migrationsDir, f), 'utf-8'))
        .join('\n')
      expect(sql).toMatch(/type"\s*=\s*'weighted'/)
      expect(sql).toMatch(/type"\s*=\s*'bodyweight'/)
      expect(sql).toMatch(/type"\s*=\s*'time-based'/)
      expect(sql).toMatch(/type"\s*=\s*'cardio'/)
      expect(sql).toMatch(/set_number"\s*>=\s*1/)
      expect(sql).toMatch(/sets"\s*>=\s*1/)
      expect(sql).toMatch(/one_active_session_per_routine/)
      // The set_logs (session_id, logged_at DESC, id DESC) index is
      // load-bearing for `undoLastSetLog`'s ORDER BY at scale (#8).
      expect(sql).toMatch(/set_logs_session_logged_idx/)
    })
  })
})
