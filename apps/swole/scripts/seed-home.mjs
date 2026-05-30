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
const DB_PATH =
  process.env.DATABASE_PATH ?? path.resolve(__dirname, '..', 'swole.db')

const db = new BetterSqlite3(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

const now = Date.now()
const dayMs = 24 * 60 * 60 * 1000
const hourMs = 60 * 60 * 1000
const minMs = 60 * 1000

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

function addRoutine(name, days, createdDaysAgo = 50) {
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
  const ts = now - 50 * dayMs
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
  const ts = now - 50 * dayMs
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
  const ts = now - 50 * dayMs
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
  const ts = now - 50 * dayMs
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

// Creates a completed session and returns { sid, startedAt, completedAt }.
function makeSession(routineId, daysAgo, durationMinutes = 50) {
  const startedAt = now - daysAgo * dayMs - 1 * hourMs
  const completedAt = startedAt + durationMinutes * minMs
  const sid = Number(
    insertSession.run(routineId, startedAt, completedAt).lastInsertRowid,
  )
  return { sid, startedAt, completedAt }
}

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
      baseTs + i * minMs,
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
      baseTs + i * minMs,
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
      baseTs + i * minMs,
    )
  }
}

function bump(exerciseId, sessionId, newWeight, completedAt) {
  insertProgression.run(
    exerciseId,
    sessionId,
    newWeight,
    'session_progression',
    completedAt,
  )
}

const seed = db.transaction(() => {
  // ── Routines ──────────────────────────────────────────────────────────
  const pushDay = addRoutine('Push Day', ['mon', 'wed', 'fri'], 50)
  const pullDay = addRoutine('Pull Day', ['tue', 'thu'], 48)
  const legDay = addRoutine('Leg Day', ['sat'], 45)
  const cardioDay = addRoutine('Cardio', ['sun'], 42)

  // ── Push Day exercises ────────────────────────────────────────────────
  // Starting weights are the actual weights used in the first session so
  // progressions reflect real changes (initial → incremented values).
  const benchPress = addWeighted(pushDay, 'Bench Press', 0, 3, 8, 115, 5)
  const ohp = addWeighted(pushDay, 'Overhead Press', 1, 3, 8, 65, 5)
  const tricepDips = addBodyweight(pushDay, 'Tricep Dips', 2, 3, 10)
  const pushups = addBodyweight(pushDay, 'Pushups', 3, 3, 15)

  // ── Pull Day exercises ────────────────────────────────────────────────
  const deadlift = addWeighted(pullDay, 'Deadlift', 0, 3, 5, 155, 10)
  const bentOverRow = addWeighted(pullDay, 'Bent Over Row', 1, 3, 8, 80, 5)
  const pullups = addBodyweight(pullDay, 'Pull-ups', 2, 3, 8)
  const dumbbellCurl = addWeighted(pullDay, 'Dumbbell Curl', 3, 3, 10, 20, 5)

  // ── Leg Day exercises ─────────────────────────────────────────────────
  const squat = addWeighted(legDay, 'Back Squat', 0, 3, 8, 135, 10)
  const lunges = addBodyweight(legDay, 'Walking Lunges', 1, 3, 12)
  const calfRaises = addWeighted(legDay, 'Calf Raises', 2, 3, 15, 80, 5)
  const plank = addTimeBased(legDay, 'Plank', 3, 3, 45)

  // ── Cardio routine ────────────────────────────────────────────────────
  const treadmill = addCardio(cardioDay, 'Treadmill Run', 0, 30 * 60)

  // ── Push Day: 6 completed sessions + 1 active ─────────────────────────
  //
  // Bench progression:  115 → 120 → 125 → 130 → 135 (5 points + initial)
  // OHP progression:     65 →  70 →  75 →  80        (4 points + initial)

  // P1: 40 days ago — both increment
  {
    const { sid, startedAt, completedAt } = makeSession(pushDay, 40, 55)
    logWeightedSession(sid, benchPress, 3, 8, 115, 'Increment', startedAt)
    bump(benchPress, sid, 120, completedAt)
    logWeightedSession(sid, ohp, 3, 8, 65, 'Increment', startedAt + 15 * minMs)
    bump(ohp, sid, 70, completedAt)
    logBodyweightSession(sid, tricepDips, 3, 10, 'Complete', startedAt + 30 * minMs)
    logBodyweightSession(sid, pushups, 3, 15, 'Complete', startedAt + 42 * minMs)
  }

  // P2: 34 days ago — bench increments, OHP stays
  {
    const { sid, startedAt, completedAt } = makeSession(pushDay, 34, 50)
    logWeightedSession(sid, benchPress, 3, 8, 120, 'Increment', startedAt)
    bump(benchPress, sid, 125, completedAt)
    logWeightedSession(sid, ohp, 3, 8, 70, 'Stay', startedAt + 15 * minMs)
    logBodyweightSession(sid, tricepDips, 3, 10, 'Complete', startedAt + 28 * minMs)
    logBodyweightSession(sid, pushups, 3, 15, 'Complete', startedAt + 40 * minMs)
  }

  // P3: 27 days ago — bench stays, OHP increments
  {
    const { sid, startedAt, completedAt } = makeSession(pushDay, 27, 48)
    logWeightedSession(sid, benchPress, 3, 8, 125, 'Stay', startedAt)
    logWeightedSession(sid, ohp, 3, 8, 70, 'Increment', startedAt + 15 * minMs)
    bump(ohp, sid, 75, completedAt)
    logBodyweightSession(sid, tricepDips, 3, 10, 'Complete', startedAt + 28 * minMs)
    logBodyweightSession(sid, pushups, 3, 15, 'Complete', startedAt + 40 * minMs)
  }

  // P4: 20 days ago — bench increments, OHP stays
  {
    const { sid, startedAt, completedAt } = makeSession(pushDay, 20, 52)
    logWeightedSession(sid, benchPress, 3, 8, 125, 'Increment', startedAt)
    bump(benchPress, sid, 130, completedAt)
    logWeightedSession(sid, ohp, 3, 8, 75, 'Stay', startedAt + 15 * minMs)
    logBodyweightSession(sid, tricepDips, 3, 10, 'Complete', startedAt + 28 * minMs)
    logBodyweightSession(sid, pushups, 3, 15, 'Complete', startedAt + 40 * minMs)
  }

  // P5: 13 days ago — both increment
  {
    const { sid, startedAt, completedAt } = makeSession(pushDay, 13, 50)
    logWeightedSession(sid, benchPress, 3, 8, 130, 'Increment', startedAt)
    bump(benchPress, sid, 135, completedAt)
    logWeightedSession(sid, ohp, 3, 8, 75, 'Increment', startedAt + 15 * minMs)
    bump(ohp, sid, 80, completedAt)
    logBodyweightSession(sid, tricepDips, 3, 10, 'Complete', startedAt + 28 * minMs)
    logBodyweightSession(sid, pushups, 3, 15, 'Complete', startedAt + 40 * minMs)
  }

  // P6: 6 days ago — both stay
  {
    const { sid, startedAt } = makeSession(pushDay, 6, 45)
    logWeightedSession(sid, benchPress, 3, 8, 135, 'Stay', startedAt)
    logWeightedSession(sid, ohp, 3, 8, 80, 'Stay', startedAt + 15 * minMs)
    logBodyweightSession(sid, tricepDips, 3, 10, 'Complete', startedAt + 28 * minMs)
    logBodyweightSession(sid, pushups, 3, 15, 'Complete', startedAt + 40 * minMs)
  }

  // Active Push Day session (started today, bench set 1 done — set 2 pending).
  {
    const activeStarted = now - 25 * minMs
    const activeSid = Number(
      insertSession.run(pushDay, activeStarted, null).lastInsertRowid,
    )
    insertSetLog.run(
      activeSid,
      benchPress,
      1,
      135,
      8,
      8,
      null,
      null,
      'Stay',
      activeStarted,
    )
  }

  // ── Pull Day: 6 completed sessions ────────────────────────────────────
  //
  // Deadlift progression:    155 → 165 → 175 → 185 (4 points + initial)
  // Bent Over Row:            80 →  85 →  90 →  95 (4 points + initial)
  // Dumbbell Curl:            20 →  25 →  30 →  35 (4 points + initial)

  // L1: 39 days ago — all three increment
  {
    const { sid, startedAt, completedAt } = makeSession(pullDay, 39, 55)
    logWeightedSession(sid, deadlift, 3, 5, 155, 'Increment', startedAt)
    bump(deadlift, sid, 165, completedAt)
    logWeightedSession(sid, bentOverRow, 3, 8, 80, 'Increment', startedAt + 15 * minMs)
    bump(bentOverRow, sid, 85, completedAt)
    logBodyweightSession(sid, pullups, 3, 8, 'Complete', startedAt + 28 * minMs)
    logWeightedSession(sid, dumbbellCurl, 3, 10, 20, 'Increment', startedAt + 40 * minMs)
    bump(dumbbellCurl, sid, 25, completedAt)
  }

  // L2: 32 days ago — deadlift increments, row stays, curl stays
  {
    const { sid, startedAt, completedAt } = makeSession(pullDay, 32, 50)
    logWeightedSession(sid, deadlift, 3, 5, 165, 'Increment', startedAt)
    bump(deadlift, sid, 175, completedAt)
    logWeightedSession(sid, bentOverRow, 3, 8, 85, 'Stay', startedAt + 15 * minMs)
    logBodyweightSession(sid, pullups, 3, 8, 'Complete', startedAt + 28 * minMs)
    logWeightedSession(sid, dumbbellCurl, 3, 10, 25, 'Stay', startedAt + 40 * minMs)
  }

  // L3: 25 days ago — deadlift stays, row and curl increment
  {
    const { sid, startedAt, completedAt } = makeSession(pullDay, 25, 52)
    logWeightedSession(sid, deadlift, 3, 5, 175, 'Stay', startedAt)
    logWeightedSession(sid, bentOverRow, 3, 8, 85, 'Increment', startedAt + 15 * minMs)
    bump(bentOverRow, sid, 90, completedAt)
    logBodyweightSession(sid, pullups, 3, 8, 'Complete', startedAt + 28 * minMs)
    logWeightedSession(sid, dumbbellCurl, 3, 10, 25, 'Increment', startedAt + 40 * minMs)
    bump(dumbbellCurl, sid, 30, completedAt)
  }

  // L4: 18 days ago — deadlift increments, row stays, curl stays
  {
    const { sid, startedAt, completedAt } = makeSession(pullDay, 18, 50)
    logWeightedSession(sid, deadlift, 3, 5, 175, 'Increment', startedAt)
    bump(deadlift, sid, 185, completedAt)
    logWeightedSession(sid, bentOverRow, 3, 8, 90, 'Stay', startedAt + 15 * minMs)
    logBodyweightSession(sid, pullups, 3, 8, 'Complete', startedAt + 28 * minMs)
    logWeightedSession(sid, dumbbellCurl, 3, 10, 30, 'Stay', startedAt + 40 * minMs)
  }

  // L5: 11 days ago — deadlift stays, row increments, curl stays
  {
    const { sid, startedAt, completedAt } = makeSession(pullDay, 11, 48)
    logWeightedSession(sid, deadlift, 3, 5, 185, 'Stay', startedAt)
    logWeightedSession(sid, bentOverRow, 3, 8, 90, 'Increment', startedAt + 15 * minMs)
    bump(bentOverRow, sid, 95, completedAt)
    logBodyweightSession(sid, pullups, 3, 8, 'Complete', startedAt + 28 * minMs)
    logWeightedSession(sid, dumbbellCurl, 3, 10, 30, 'Stay', startedAt + 40 * minMs)
  }

  // L6: 4 days ago — deadlift and row stay, curl increments
  {
    const { sid, startedAt, completedAt } = makeSession(pullDay, 4, 50)
    logWeightedSession(sid, deadlift, 3, 5, 185, 'Stay', startedAt)
    logWeightedSession(sid, bentOverRow, 3, 8, 95, 'Stay', startedAt + 15 * minMs)
    logBodyweightSession(sid, pullups, 3, 8, 'Complete', startedAt + 28 * minMs)
    logWeightedSession(sid, dumbbellCurl, 3, 10, 30, 'Increment', startedAt + 40 * minMs)
    bump(dumbbellCurl, sid, 35, completedAt)
  }

  // ── Leg Day: 6 completed sessions ────────────────────────────────────
  //
  // Back Squat progression:  135 → 145 → 155 → 165 → 175 (5 points + initial)
  // Calf Raises progression:  80 →  85 →  90 →  95        (4 points + initial)

  // G1: 38 days ago — squat and calf increment
  {
    const { sid, startedAt, completedAt } = makeSession(legDay, 38, 60)
    logWeightedSession(sid, squat, 3, 8, 135, 'Increment', startedAt)
    bump(squat, sid, 145, completedAt)
    logBodyweightSession(sid, lunges, 3, 12, 'Complete', startedAt + 20 * minMs)
    logWeightedSession(sid, calfRaises, 3, 15, 80, 'Increment', startedAt + 35 * minMs)
    bump(calfRaises, sid, 85, completedAt)
    logTimeBasedSession(sid, plank, 3, 45, 'Hold', startedAt + 50 * minMs)
  }

  // G2: 31 days ago — both increment
  {
    const { sid, startedAt, completedAt } = makeSession(legDay, 31, 58)
    logWeightedSession(sid, squat, 3, 8, 145, 'Increment', startedAt)
    bump(squat, sid, 155, completedAt)
    logBodyweightSession(sid, lunges, 3, 12, 'Complete', startedAt + 20 * minMs)
    logWeightedSession(sid, calfRaises, 3, 15, 85, 'Increment', startedAt + 35 * minMs)
    bump(calfRaises, sid, 90, completedAt)
    logTimeBasedSession(sid, plank, 3, 45, 'Hold', startedAt + 50 * minMs)
  }

  // G3: 24 days ago — both stay
  {
    const { sid, startedAt } = makeSession(legDay, 24, 55)
    logWeightedSession(sid, squat, 3, 8, 155, 'Stay', startedAt)
    logBodyweightSession(sid, lunges, 3, 12, 'Complete', startedAt + 20 * minMs)
    logWeightedSession(sid, calfRaises, 3, 15, 90, 'Stay', startedAt + 35 * minMs)
    logTimeBasedSession(sid, plank, 3, 45, 'Hold', startedAt + 50 * minMs)
  }

  // G4: 17 days ago — squat and calf increment
  {
    const { sid, startedAt, completedAt } = makeSession(legDay, 17, 60)
    logWeightedSession(sid, squat, 3, 8, 155, 'Increment', startedAt)
    bump(squat, sid, 165, completedAt)
    logBodyweightSession(sid, lunges, 3, 12, 'Complete', startedAt + 20 * minMs)
    logWeightedSession(sid, calfRaises, 3, 15, 90, 'Increment', startedAt + 35 * minMs)
    bump(calfRaises, sid, 95, completedAt)
    // One failed plank set — shows as a partial in the consistency view.
    insertSetLog.run(sid, plank, 1, null, null, null, 45, 45, 'Hold', startedAt + 50 * minMs)
    insertSetLog.run(sid, plank, 2, null, null, null, 45, 45, 'Hold', startedAt + 51 * minMs)
    insertSetLog.run(sid, plank, 3, null, null, null, 45, 28, 'Failed', startedAt + 52 * minMs)
  }

  // G5: 10 days ago — squat stays, calf stays
  {
    const { sid, startedAt } = makeSession(legDay, 10, 52)
    logWeightedSession(sid, squat, 3, 8, 165, 'Stay', startedAt)
    logBodyweightSession(sid, lunges, 3, 12, 'Complete', startedAt + 20 * minMs)
    logWeightedSession(sid, calfRaises, 3, 15, 95, 'Stay', startedAt + 35 * minMs)
    logTimeBasedSession(sid, plank, 3, 45, 'Hold', startedAt + 50 * minMs)
  }

  // G6: 3 days ago — squat increments, calf stays
  {
    const { sid, startedAt, completedAt } = makeSession(legDay, 3, 58)
    logWeightedSession(sid, squat, 3, 8, 165, 'Increment', startedAt)
    bump(squat, sid, 175, completedAt)
    logBodyweightSession(sid, lunges, 3, 12, 'Complete', startedAt + 20 * minMs)
    logWeightedSession(sid, calfRaises, 3, 15, 95, 'Stay', startedAt + 35 * minMs)
    logTimeBasedSession(sid, plank, 3, 45, 'Hold', startedAt + 50 * minMs)
  }

  // ── Cardio: 4 sessions (3 Done + 1 Skipped) ──────────────────────────
  {
    const { sid, startedAt } = makeSession(cardioDay, 35, 32)
    insertSetLog.run(sid, treadmill, 1, null, null, null, 30 * 60, 30 * 60, 'Done', startedAt)
  }
  {
    const { sid, startedAt } = makeSession(cardioDay, 21, 35)
    insertSetLog.run(sid, treadmill, 1, null, null, null, 30 * 60, 30 * 60, 'Done', startedAt)
  }
  {
    const { sid, startedAt } = makeSession(cardioDay, 14, 5)
    insertSetLog.run(sid, treadmill, 1, null, null, null, 30 * 60, 30 * 60, 'Skipped', startedAt)
  }
  {
    const { sid, startedAt } = makeSession(cardioDay, 7, 31)
    insertSetLog.run(sid, treadmill, 1, null, null, null, 30 * 60, 30 * 60, 'Done', startedAt)
  }

  // Reconcile exercises.starting_weight to each exercise's latest progression.
  // The real write path (commitProgressionDecision) updates the progression row
  // AND exercises.starting_weight in one transaction to hold R19's invariant
  // (current weight == latest progression). The direct inserts above don't, so
  // without this an exercise that progressed would show a stale "Current weight"
  // tile that disagrees with the trend chart's last point.
  db.prepare(
    `UPDATE exercises
       SET starting_weight = (
             SELECT p.starting_weight
             FROM progressions p
             WHERE p.exercise_id = exercises.id
             ORDER BY p.effective_from DESC, p.id DESC
             LIMIT 1
           ),
           updated_at = ?
     WHERE type = 'weighted'
       AND EXISTS (
         SELECT 1 FROM progressions p WHERE p.exercise_id = exercises.id
       )`,
  ).run(now)
})

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
