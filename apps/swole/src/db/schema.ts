import { sql } from 'drizzle-orm'
import {
  check,
  integer,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

// Day codes for routines.days (DB-layer concept; the UI maps these to labels).
export type DayCode = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

const DAY_CODES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

const EXERCISE_TYPES = [
  'weighted',
  'bodyweight',
  'time-based',
  'cardio',
] as const

// Persistable set-log actions. Deliberately excludes 'JumpTo' — the FSM never
// persists a log on JumpTo. The mappers.ts compile-time assertion guards drift.
const SET_LOG_ACTIONS = [
  'Increment',
  'Stay',
  'Decrement',
  'Complete',
  'Hold',
  'Done',
  'Skipped',
  'Failed',
] as const

const PROGRESSION_REASONS = [
  'initial',
  'session_progression',
  'manual_edit',
] as const

export const routines = sqliteTable('routines', {
  id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  days: text({ mode: 'json' }).$type<DayCode[]>().notNull(),
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export const exercises = sqliteTable(
  'exercises',
  {
    id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
    routineId: integer('routine_id')
      .notNull()
      .references(() => routines.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    type: text({ enum: EXERCISE_TYPES }).notNull(),
    orderInRoutine: integer('order_in_routine').notNull(),
    sets: integer().notNull(),
    targetReps: integer('target_reps'),
    startingWeight: integer('starting_weight'),
    increment: integer(),
    durationSeconds: integer('duration_seconds'),
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  t => [
    check(
      'exercise_type_fields_match',
      sql`(
        (${t.type} = 'weighted'    AND ${t.targetReps} IS NOT NULL AND ${t.startingWeight} IS NOT NULL AND ${t.increment} IS NOT NULL AND ${t.durationSeconds} IS NULL) OR
        (${t.type} = 'bodyweight'  AND ${t.targetReps} IS NOT NULL AND ${t.startingWeight} IS NULL     AND ${t.increment} IS NULL     AND ${t.durationSeconds} IS NULL) OR
        (${t.type} = 'time-based'  AND ${t.targetReps} IS NULL     AND ${t.startingWeight} IS NULL     AND ${t.increment} IS NULL     AND ${t.durationSeconds} IS NOT NULL) OR
        (${t.type} = 'cardio'      AND ${t.targetReps} IS NULL     AND ${t.startingWeight} IS NULL     AND ${t.increment} IS NULL     AND ${t.durationSeconds} IS NOT NULL AND ${t.sets} = 1)
      )`,
    ),
    check('exercise_sets_positive', sql`${t.sets} >= 1`),
  ],
)

export const sessions = sqliteTable(
  'sessions',
  {
    id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
    routineId: integer('routine_id')
      .notNull()
      .references(() => routines.id, { onDelete: 'restrict' }),
    startedAt: integer('started_at', { mode: 'timestamp_ms' })
      .$defaultFn(() => new Date())
      .notNull(),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  },
  t => [
    // Partial unique index — at most one active (incomplete) session per routine.
    // DB-enforces the invariant so startSession races between tabs cannot land
    // two active sessions on the same routine.
    uniqueIndex('one_active_session_per_routine')
      .on(t.routineId)
      .where(sql`${t.completedAt} IS NULL`),
  ],
)

export const setLogs = sqliteTable(
  'set_logs',
  {
    id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
    sessionId: integer('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'restrict' }),
    exerciseId: integer('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'restrict' }),
    setNumber: integer('set_number').notNull(),
    weight: integer(),
    targetReps: integer('target_reps'),
    actualReps: integer('actual_reps'),
    durationSeconds: integer('duration_seconds'),
    actualDurationSeconds: integer('actual_duration_seconds'),
    action: text({ enum: SET_LOG_ACTIONS }).notNull(),
    loggedAt: integer('logged_at', { mode: 'timestamp_ms' })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  t => [
    unique('set_logs_session_exercise_set_unique').on(
      t.sessionId,
      t.exerciseId,
      t.setNumber,
    ),
    check('set_number_one_indexed', sql`${t.setNumber} >= 1`),
  ],
)

export const progressions = sqliteTable('progressions', {
  id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
  exerciseId: integer('exercise_id')
    .notNull()
    .references(() => exercises.id, { onDelete: 'restrict' }),
  sessionId: integer('session_id').references(() => sessions.id, {
    onDelete: 'restrict',
  }),
  startingWeight: integer('starting_weight').notNull(),
  reason: text({ enum: PROGRESSION_REASONS }).notNull(),
  effectiveFrom: integer('effective_from', { mode: 'timestamp_ms' })
    .$defaultFn(() => new Date())
    .notNull(),
})

// Export the action-enum tuple so mappers.ts can pin its compile-time
// invariance against the FSM's Action union (catches schema/FSM drift at
// type-check rather than at runtime).
export const setLogActionEnum = SET_LOG_ACTIONS
export const dayCodes = DAY_CODES
