#!/usr/bin/env node
// One-shot seed for the home page. Idempotent-ish: deletes existing rows in
// reverse-FK order before inserting, so re-running gives a clean dataset.
// Usage: node apps/swole/scripts/seed-home.mjs
//
// Writes directly via better-sqlite3 to match Drizzle's storage format:
//   - timestamp_ms columns are stored as Date.getTime() (integer ms).
//   - days is text(mode: 'json'), stored as JSON.stringify(array).
//
// Schema constraints we have to honor:
//   - exercises CHECK constraint pins type to its field set.
//   - sessions partial UNIQUE index allows only one active per routine.
//   - set_logs UNIQUE (session_id, exercise_id, set_number).

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import BetterSqlite3 from 'better-sqlite3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.resolve(__dirname, '..', 'data', 'swole.db')

const db = new BetterSqlite3(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

const now = Date.now()
const dayMs = 24 * 60 * 60 * 1000
const hourMs = 60 * 60 * 1000

// Clear in reverse-FK order so ON DELETE RESTRICT doesn't fire.
const wipe = db.transaction(() => {
  db.prepare('DELETE FROM progressions').run()
  db.prepare('DELETE FROM set_logs').run()
  db.prepare('DELETE FROM sessions').run()
  db.prepare('DELETE FROM exercises').run()
  db.prepare('DELETE FROM routines').run()
  // Reset autoincrement counters so seeded ids start at 1 each run.
  db.prepare(
    "DELETE FROM sqlite_sequence WHERE name IN ('routines','exercises','sessions','set_logs','progressions')",
  ).run()
})
wipe()

const insertRoutine = db.prepare(
  `INSERT INTO routines (name, days, archived_at, created_at, updated_at)
   VALUES (?, ?, NULL, ?, ?)`,
)

const insertExercise = db.prepare(
  `INSERT INTO exercises
     (routine_id, name, type, order_in_routine, sets,
      target_reps, starting_weight, increment, duration_seconds,
      archived_at, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
)

const insertProgression = db.prepare(
  `INSERT INTO progressions
     (exercise_id, session_id, starting_weight, reason, effective_from)
   VALUES (?, ?, ?, ?, ?)`,
)

const insertSession = db.prepare(
  `INSERT INTO sessions (routine_id, started_at, completed_at)
   VALUES (?, ?, ?)`,
)

const insertSetLog = db.prepare(
  `INSERT INTO set_logs
     (session_id, exercise_id, set_number, weight, target_reps, actual_reps,
      duration_seconds, actual_duration_seconds, action, logged_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)

function addRoutine(name, days, createdDaysAgo = 30) {
  const ts = now - createdDaysAgo * dayMs
  const { lastInsertRowid } = insertRoutine.run(
    name,
    JSON.stringify(days),
    ts,
    ts,
  )
  return Number(lastInsertRowid)
}

function addWeighted(
  routineId,
  name,
  orderInRoutine,
  sets,
  targetReps,
  startingWeight,
  increment,
) {
  const ts = now - 30 * dayMs
  const { lastInsertRowid } = insertExercise.run(
    routineId,
    name,
    'weighted',
    orderInRoutine,
    sets,
    targetReps,
    startingWeight,
    increment,
    null,
    ts,
    ts,
  )
  const id = Number(lastInsertRowid)
  // Initial progression row mirrors what db/exercises.ts createExercise does.
  insertProgression.run(id, null, startingWeight, 'initial', ts)
  return id
}

function addBodyweight(routineId, name, orderInRoutine, sets, targetReps) {
  const ts = now - 30 * dayMs
  const { lastInsertRowid } = insertExercise.run(
    routineId,
    name,
    'bodyweight',
    orderInRoutine,
    sets,
    targetReps,
    null,
    null,
    null,
    ts,
    ts,
  )
  return Number(lastInsertRowid)
}

function addTimeBased(routineId, name, orderInRoutine, sets, durationSeconds) {
  const ts = now - 30 * dayMs
  const { lastInsertRowid } = insertExercise.run(
    routineId,
    name,
    'time-based',
    orderInRoutine,
    sets,
    null,
    null,
    null,
    durationSeconds,
    ts,
    ts,
  )
  return Number(lastInsertRowid)
}

function addCardio(routineId, name, orderInRoutine, durationSeconds) {
  const ts = now - 30 * dayMs
  const { lastInsertRowid } = insertExercise.run(
    routineId,
    name,
    'cardio',
    orderInRoutine,
    1,
    null,
    null,
    null,
    durationSeconds,
    ts,
    ts,
  )
  return Number(lastInsertRowid)
}

const seed = db.transaction(() => {
  // ── Routines ──────────────────────────────────────────────────────────
  const pushDay = addRoutine('Push Day', ['mon', 'wed', 'fri'], 30)
  const pullDay = addRoutine('Pull Day', ['tue', 'thu'], 28)
  const legDay = addRoutine('Leg Day', ['sat'], 25)
  const cardioDay = addRoutine('Cardio', ['sun'], 20)

  // ── Push Day exercises ────────────────────────────────────────────────
  const benchPress = addWeighted(pushDay, 'Bench Press', 0, 3, 8, 135, 5)
  const ohp = addWeighted(pushDay, 'Overhead Press', 1, 3, 8, 75, 5)
  const tricepDips = addBodyweight(pushDay, 'Tricep Dips', 2, 3, 10)
  const pushups = addBodyweight(pushDay, 'Pushups', 3, 3, 15)

  // ── Pull Day exercises ────────────────────────────────────────────────
  const deadlift = addWeighted(pullDay, 'Deadlift', 0, 3, 5, 185, 10)
  const bentOverRow = addWeighted(pullDay, 'Bent Over Row', 1, 3, 8, 95, 5)
  const pullups = addBodyweight(pullDay, 'Pull-ups', 2, 3, 8)
  const dumbbellCurl = addWeighted(pullDay, 'Dumbbell Curl', 3, 3, 10, 25, 5)

  // ── Leg Day exercises ─────────────────────────────────────────────────
  const squat = addWeighted(legDay, 'Back Squat', 0, 3, 8, 155, 10)
  const lunges = addBodyweight(legDay, 'Walking Lunges', 1, 3, 12)
  const calfRaises = addWeighted(legDay, 'Calf Raises', 2, 3, 15, 90, 5)
  const plank = addTimeBased(legDay, 'Plank', 3, 3, 45)

  // ── Cardio routine ────────────────────────────────────────────────────
  addCardio(cardioDay, 'Treadmill Run', 0, 30 * 60)

  // ── Completed sessions for the Recent Sessions strip ──────────────────
  // 5 completed sessions across various routines, most recent first.
  // Each session has a few set_logs so it isn't a phantom row.

  // Session 1 — yesterday, Pull Day, fully completed (3 exercises × 3 sets).
  {
    const startedAt = now - 1 * dayMs - 2 * hourMs
    const completedAt = startedAt + 50 * 60 * 1000
    const sid = Number(
      insertSession.run(pullDay, startedAt, completedAt).lastInsertRowid,
    )
    logWeightedSession(sid, deadlift, 3, 5, 185, 'Stay', startedAt)
    logWeightedSession(
      sid,
      bentOverRow,
      3,
      8,
      95,
      'Stay',
      startedAt + 10 * 60_000,
    )
    logBodyweightSession(
      sid,
      pullups,
      3,
      8,
      'Complete',
      startedAt + 20 * 60_000,
    )
    logWeightedSession(
      sid,
      dumbbellCurl,
      3,
      10,
      25,
      'Increment',
      startedAt + 30 * 60_000,
    )
    // Curl bumped: session_progression row.
    insertProgression.run(
      dumbbellCurl,
      sid,
      30,
      'session_progression',
      completedAt,
    )
  }

  // Session 2 — 2 days ago, Push Day.
  {
    const startedAt = now - 2 * dayMs - 3 * hourMs
    const completedAt = startedAt + 45 * 60_000
    const sid = Number(
      insertSession.run(pushDay, startedAt, completedAt).lastInsertRowid,
    )
    logWeightedSession(sid, benchPress, 3, 8, 135, 'Increment', startedAt)
    insertProgression.run(
      benchPress,
      sid,
      140,
      'session_progression',
      completedAt,
    )
    logWeightedSession(sid, ohp, 3, 8, 75, 'Stay', startedAt + 12 * 60_000)
    logBodyweightSession(
      sid,
      tricepDips,
      3,
      10,
      'Complete',
      startedAt + 25 * 60_000,
    )
    logBodyweightSession(
      sid,
      pushups,
      3,
      15,
      'Complete',
      startedAt + 35 * 60_000,
    )
  }

  // Session 3 — 4 days ago, Leg Day.
  {
    const startedAt = now - 4 * dayMs - 4 * hourMs
    const completedAt = startedAt + 60 * 60_000
    const sid = Number(
      insertSession.run(legDay, startedAt, completedAt).lastInsertRowid,
    )
    logWeightedSession(sid, squat, 3, 8, 155, 'Stay', startedAt)
    logBodyweightSession(
      sid,
      lunges,
      3,
      12,
      'Complete',
      startedAt + 15 * 60_000,
    )
    logWeightedSession(
      sid,
      calfRaises,
      3,
      15,
      90,
      'Increment',
      startedAt + 30 * 60_000,
    )
    insertProgression.run(
      calfRaises,
      sid,
      95,
      'session_progression',
      completedAt,
    )
    // Time-based: plank.
    logTimeBasedSession(sid, plank, 3, 45, 'Hold', startedAt + 45 * 60_000)
  }

  // Session 4 — 6 days ago, Push Day.
  {
    const startedAt = now - 6 * dayMs - 3 * hourMs
    const completedAt = startedAt + 50 * 60_000
    const sid = Number(
      insertSession.run(pushDay, startedAt, completedAt).lastInsertRowid,
    )
    logWeightedSession(sid, benchPress, 3, 8, 130, 'Increment', startedAt)
    insertProgression.run(
      benchPress,
      sid,
      135,
      'session_progression',
      completedAt,
    )
    logWeightedSession(sid, ohp, 3, 8, 75, 'Stay', startedAt + 15 * 60_000)
    logBodyweightSession(
      sid,
      tricepDips,
      3,
      10,
      'Complete',
      startedAt + 30 * 60_000,
    )
  }

  // Session 5 — 8 days ago, Pull Day.
  {
    const startedAt = now - 8 * dayMs - 4 * hourMs
    const completedAt = startedAt + 55 * 60_000
    const sid = Number(
      insertSession.run(pullDay, startedAt, completedAt).lastInsertRowid,
    )
    logWeightedSession(sid, deadlift, 3, 5, 175, 'Increment', startedAt)
    insertProgression.run(
      deadlift,
      sid,
      185,
      'session_progression',
      completedAt,
    )
    logWeightedSession(
      sid,
      bentOverRow,
      3,
      8,
      90,
      'Increment',
      startedAt + 15 * 60_000,
    )
    insertProgression.run(
      bentOverRow,
      sid,
      95,
      'session_progression',
      completedAt,
    )
    logBodyweightSession(
      sid,
      pullups,
      3,
      8,
      'Complete',
      startedAt + 30 * 60_000,
    )
  }

  // ── Active session for the Resume banner ──────────────────────────────
  // Push Day, started today, partial logs so nextTarget points mid-workout.
  // Bench Press: set 1 done (Increment). Set 2 still to go.
  const activeStarted = now - 25 * 60_000
  const activeSid = Number(
    insertSession.run(pushDay, activeStarted, null).lastInsertRowid,
  )
  logWeightedSession(activeSid, benchPress, 1, 8, 140, 'Stay', activeStarted)
})

function logWeightedSession(
  sessionId,
  exerciseId,
  sets,
  reps,
  weight,
  action,
  baseTs,
) {
  for (let i = 0; i < sets; i++) {
    insertSetLog.run(
      sessionId,
      exerciseId,
      i + 1,
      weight,
      reps,
      reps,
      null,
      null,
      action,
      baseTs + i * 60_000,
    )
  }
}

function logBodyweightSession(
  sessionId,
  exerciseId,
  sets,
  reps,
  action,
  baseTs,
) {
  for (let i = 0; i < sets; i++) {
    insertSetLog.run(
      sessionId,
      exerciseId,
      i + 1,
      null,
      reps,
      reps,
      null,
      null,
      action,
      baseTs + i * 60_000,
    )
  }
}

function logTimeBasedSession(
  sessionId,
  exerciseId,
  sets,
  durationSeconds,
  action,
  baseTs,
) {
  for (let i = 0; i < sets; i++) {
    insertSetLog.run(
      sessionId,
      exerciseId,
      i + 1,
      null,
      null,
      null,
      durationSeconds,
      durationSeconds,
      action,
      baseTs + i * 60_000,
    )
  }
}

seed()

const counts = db
  .prepare(
    `SELECT
       (SELECT COUNT(*) FROM routines) AS routines,
       (SELECT COUNT(*) FROM exercises) AS exercises,
       (SELECT COUNT(*) FROM sessions) AS sessions,
       (SELECT COUNT(*) FROM set_logs) AS set_logs,
       (SELECT COUNT(*) FROM progressions) AS progressions,
       (SELECT COUNT(*) FROM sessions WHERE completed_at IS NULL) AS active_sessions`,
  )
  .get()

console.log('swole: seeded home page data')
console.table(counts)

db.close()
