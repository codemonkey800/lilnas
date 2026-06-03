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
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH =
  process.env.DATABASE_PATH ?? path.resolve(__dirname, '..', 'data', 'swole.db')
const MIGRATIONS_FOLDER = path.resolve(__dirname, '..', 'src', 'db', 'migrations')

const db = new BetterSqlite3(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

migrate(drizzle(db), { migrationsFolder: MIGRATIONS_FOLDER })

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
   VALUES (?, ?, ?, ?, ?)`,
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

function addRoutine(name, days, createdDaysAgo = 180, archivedDaysAgo = null) {
  const createdTs = now - createdDaysAgo * dayMs
  const archivedTs = archivedDaysAgo !== null ? now - archivedDaysAgo * dayMs : null
  const { lastInsertRowid } = insertRoutine.run(
    name,
    JSON.stringify(days),
    archivedTs,
    createdTs,
    createdTs,
  )
  return Number(lastInsertRowid)
}

function addWeighted(routineId, name, orderInRoutine, sets, targetReps, startingWeight, increment, createdDaysAgo = 180) {
  const ts = now - createdDaysAgo * dayMs
  const { lastInsertRowid } = insertExercise.run(
    routineId, name, 'weighted', orderInRoutine, sets, targetReps,
    startingWeight, increment, null, ts, ts,
  )
  const id = Number(lastInsertRowid)
  insertProgression.run(id, null, startingWeight, 'initial', ts)
  return id
}

function addBodyweight(routineId, name, orderInRoutine, sets, targetReps, createdDaysAgo = 180) {
  const ts = now - createdDaysAgo * dayMs
  const { lastInsertRowid } = insertExercise.run(
    routineId, name, 'bodyweight', orderInRoutine, sets, targetReps,
    null, null, null, ts, ts,
  )
  return Number(lastInsertRowid)
}

function addTimeBased(routineId, name, orderInRoutine, sets, durationSeconds, createdDaysAgo = 180) {
  const ts = now - createdDaysAgo * dayMs
  const { lastInsertRowid } = insertExercise.run(
    routineId, name, 'time-based', orderInRoutine, sets, null,
    null, null, durationSeconds, ts, ts,
  )
  return Number(lastInsertRowid)
}

function addCardio(routineId, name, orderInRoutine, durationSeconds, createdDaysAgo = 180) {
  const ts = now - createdDaysAgo * dayMs
  const { lastInsertRowid } = insertExercise.run(
    routineId, name, 'cardio', orderInRoutine, 1, null,
    null, null, durationSeconds, ts, ts,
  )
  return Number(lastInsertRowid)
}

function makeSession(routineId, daysAgo, durationMinutes = 50) {
  const startedAt = now - daysAgo * dayMs - 1 * hourMs
  const completedAt = startedAt + durationMinutes * minMs
  const sid = Number(insertSession.run(routineId, startedAt, completedAt).lastInsertRowid)
  return { sid, startedAt, completedAt }
}

function logWeighted(sessionId, exerciseId, sets, reps, weight, action, baseTs) {
  for (let i = 0; i < sets; i++) {
    insertSetLog.run(sessionId, exerciseId, i + 1, weight, reps, reps, null, null, action, baseTs + i * minMs)
  }
}

function logBodyweight(sessionId, exerciseId, sets, reps, action, baseTs) {
  for (let i = 0; i < sets; i++) {
    insertSetLog.run(sessionId, exerciseId, i + 1, null, reps, reps, null, null, action, baseTs + i * minMs)
  }
}

function logTimeBased(sessionId, exerciseId, sets, durationSeconds, action, baseTs) {
  for (let i = 0; i < sets; i++) {
    insertSetLog.run(sessionId, exerciseId, i + 1, null, null, null, durationSeconds, durationSeconds, action, baseTs + i * minMs)
  }
}

function bump(exerciseId, sessionId, newWeight, completedAt) {
  insertProgression.run(exerciseId, sessionId, newWeight, 'session_progression', completedAt)
}

// Run a series of weighted sessions for an exercise.
// sessions: array of { daysAgo, weight, action } — if action is 'Increment',
// auto-bumps by increment after the session.
function runWeightedHistory(routineId, exerciseId, sets, reps, increment, sessions) {
  for (const s of sessions) {
    const { sid, startedAt, completedAt } = makeSession(routineId, s.daysAgo)
    logWeighted(sid, exerciseId, sets, reps, s.weight, s.action, startedAt)
    if (s.action === 'Increment') {
      bump(exerciseId, sid, s.weight + increment, completedAt)
    }
  }
}

const seed = db.transaction(() => {

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTIVE ROUTINES  (5 routines, long histories, lots of progression)
  // ═══════════════════════════════════════════════════════════════════════════

  const pushDay  = addRoutine('Push Day',       ['mon', 'wed', 'fri'], 180)
  const pullDay  = addRoutine('Pull Day',        ['tue', 'thu'],       175)
  const legDay   = addRoutine('Leg Day',         ['sat'],              170)
  const upperDay = addRoutine('Upper Body',      ['mon', 'thu'],       120)
  const coreDay  = addRoutine('Core & Mobility', ['wed', 'sat'],       100)

  // ── Push Day exercises ─────────────────────────────────────────────────────
  const bench  = addWeighted(pushDay, 'Bench Press',     0, 4, 8,  100, 5, 180)
  const ohp    = addWeighted(pushDay, 'Overhead Press',  1, 3, 8,   55, 5, 180)
  const incline= addWeighted(pushDay, 'Incline DB Press',2, 3, 10,  45, 5, 180)
  const dips   = addBodyweight(pushDay, 'Tricep Dips',   3, 3, 12,    180)
  const pushups= addBodyweight(pushDay, 'Diamond Pushups',4, 3, 15,   180)

  // Push Day — 18 sessions over ~120 days
  // Bench:   100 → 105 → 110 → 115 → 120 → 125 → 130 → 135 → 140 → 145 → 150
  // OHP:      55 →  60 →  65 →  70 →  75 →  80
  // Incline:  45 →  50 →  55 →  60 →  65 →  70
  const pushSessions = [
    { daysAgo: 119, bench: [100,'Increment'], ohp: [55,'Increment'],  incline: [45,'Increment'] },
    { daysAgo: 112, bench: [105,'Increment'], ohp: [60,'Stay'],       incline: [50,'Increment'] },
    { daysAgo: 105, bench: [110,'Stay'],      ohp: [60,'Increment'],  incline: [55,'Stay']      },
    { daysAgo:  98, bench: [110,'Increment'], ohp: [65,'Increment'],  incline: [55,'Increment'] },
    { daysAgo:  91, bench: [115,'Stay'],      ohp: [70,'Stay'],       incline: [60,'Stay']      },
    { daysAgo:  84, bench: [115,'Increment'], ohp: [70,'Increment'],  incline: [60,'Increment'] },
    { daysAgo:  77, bench: [120,'Increment'], ohp: [75,'Stay'],       incline: [65,'Increment'] },
    { daysAgo:  70, bench: [125,'Stay'],      ohp: [75,'Stay'],       incline: [70,'Stay']      },
    { daysAgo:  63, bench: [125,'Increment'], ohp: [75,'Increment'],  incline: [70,'Increment'] },
    { daysAgo:  56, bench: [130,'Increment'], ohp: [80,'Stay'],       incline: [75,'Stay']      },
    { daysAgo:  49, bench: [135,'Stay'],      ohp: [80,'Increment'],  incline: [75,'Increment'] },
    { daysAgo:  42, bench: [135,'Increment'], ohp: [85,'Stay'],       incline: [80,'Stay']      },
    { daysAgo:  35, bench: [140,'Stay'],      ohp: [85,'Stay'],       incline: [80,'Stay']      },
    { daysAgo:  28, bench: [140,'Increment'], ohp: [85,'Increment'],  incline: [80,'Increment'] },
    { daysAgo:  21, bench: [145,'Increment'], ohp: [90,'Stay'],       incline: [85,'Stay']      },
    { daysAgo:  14, bench: [150,'Stay'],      ohp: [90,'Increment'],  incline: [85,'Increment'] },
    { daysAgo:   7, bench: [150,'Stay'],      ohp: [95,'Stay'],       incline: [90,'Stay']      },
    { daysAgo:   2, bench: [150,'Increment'], ohp: [95,'Increment'],  incline: [90,'Increment'] },
  ]

  for (const s of pushSessions) {
    const { sid, startedAt, completedAt } = makeSession(pushDay, s.daysAgo, 60)
    const [bw, ba] = s.bench;  logWeighted(sid, bench,   4, 8,  bw, ba, startedAt);  if (ba === 'Increment') bump(bench,   sid, bw + 5,  completedAt)
    const [ow, oa] = s.ohp;    logWeighted(sid, ohp,     3, 8,  ow, oa, startedAt + 20*minMs); if (oa === 'Increment') bump(ohp,    sid, ow + 5,  completedAt)
    const [iw, ia] = s.incline;logWeighted(sid, incline, 3, 10, iw, ia, startedAt + 38*minMs); if (ia === 'Increment') bump(incline,sid, iw + 5,  completedAt)
    logBodyweight(sid, dips,    3, 12, 'Complete', startedAt + 50*minMs)
    logBodyweight(sid, pushups, 3, 15, 'Complete', startedAt + 55*minMs)
  }

  // Active Push Day session started today
  {
    const activeStarted = now - 20 * minMs
    const activeSid = Number(insertSession.run(pushDay, activeStarted, null).lastInsertRowid)
    insertSetLog.run(activeSid, bench, 1, 155, 8, 8, null, null, 'Stay', activeStarted)
  }

  // ── Pull Day exercises ─────────────────────────────────────────────────────
  const deadlift  = addWeighted(pullDay, 'Deadlift',          0, 3, 5, 135, 10, 175)
  const row       = addWeighted(pullDay, 'Barbell Row',        1, 4, 8,  75,  5, 175)
  const pullups   = addBodyweight(pullDay, 'Pull-ups',          2, 3, 8,      175)
  const facePull  = addWeighted(pullDay, 'Face Pull',          3, 3, 15, 30,  5, 175)
  const curl      = addWeighted(pullDay, 'EZ Bar Curl',        4, 3, 10, 40,  5, 175)
  const hammerCurl= addWeighted(pullDay, 'Hammer Curl',        5, 3, 10, 20,  5, 175)

  // Pull Day — 16 sessions over ~110 days
  const pullSessions = [
    { daysAgo: 109, dl: [135,'Increment'], row: [75,'Increment'],  curl: [40,'Increment'], hcurl: [20,'Increment'], fp: [30,'Stay'] },
    { daysAgo: 102, dl: [145,'Increment'], row: [80,'Stay'],       curl: [45,'Stay'],      hcurl: [25,'Stay'],      fp: [30,'Increment'] },
    { daysAgo:  95, dl: [155,'Stay'],      row: [80,'Increment'],  curl: [45,'Increment'], hcurl: [25,'Increment'], fp: [35,'Stay'] },
    { daysAgo:  88, dl: [155,'Increment'], row: [85,'Stay'],       curl: [50,'Stay'],      hcurl: [30,'Stay'],      fp: [35,'Stay'] },
    { daysAgo:  81, dl: [165,'Increment'], row: [85,'Increment'],  curl: [50,'Increment'], hcurl: [30,'Increment'], fp: [35,'Increment'] },
    { daysAgo:  74, dl: [175,'Stay'],      row: [90,'Stay'],       curl: [55,'Stay'],      hcurl: [35,'Stay'],      fp: [40,'Stay'] },
    { daysAgo:  67, dl: [175,'Increment'], row: [90,'Increment'],  curl: [55,'Stay'],      hcurl: [35,'Stay'],      fp: [40,'Stay'] },
    { daysAgo:  60, dl: [185,'Stay'],      row: [95,'Stay'],       curl: [55,'Increment'], hcurl: [35,'Increment'], fp: [40,'Increment'] },
    { daysAgo:  53, dl: [185,'Increment'], row: [95,'Increment'],  curl: [60,'Stay'],      hcurl: [40,'Stay'],      fp: [45,'Stay'] },
    { daysAgo:  46, dl: [195,'Increment'], row: [100,'Stay'],      curl: [60,'Increment'], hcurl: [40,'Increment'], fp: [45,'Stay'] },
    { daysAgo:  39, dl: [205,'Stay'],      row: [100,'Increment'], curl: [65,'Stay'],      hcurl: [45,'Stay'],      fp: [45,'Increment'] },
    { daysAgo:  32, dl: [205,'Increment'], row: [105,'Stay'],      curl: [65,'Stay'],      hcurl: [45,'Stay'],      fp: [50,'Stay'] },
    { daysAgo:  25, dl: [215,'Stay'],      row: [105,'Increment'], curl: [65,'Increment'], hcurl: [45,'Increment'], fp: [50,'Stay'] },
    { daysAgo:  18, dl: [215,'Increment'], row: [110,'Stay'],      curl: [70,'Stay'],      hcurl: [50,'Stay'],      fp: [50,'Increment'] },
    { daysAgo:  11, dl: [225,'Stay'],      row: [110,'Stay'],      curl: [70,'Stay'],      hcurl: [50,'Stay'],      fp: [55,'Stay'] },
    { daysAgo:   4, dl: [225,'Increment'], row: [110,'Increment'], curl: [70,'Increment'], hcurl: [50,'Increment'], fp: [55,'Increment'] },
  ]

  for (const s of pullSessions) {
    const { sid, startedAt, completedAt } = makeSession(pullDay, s.daysAgo, 65)
    const [dw, da] = s.dl;    logWeighted(sid, deadlift,   3, 5,  dw, da, startedAt);              if (da === 'Increment') bump(deadlift,  sid, dw + 10, completedAt)
    const [rw, ra] = s.row;   logWeighted(sid, row,        4, 8,  rw, ra, startedAt + 18*minMs);   if (ra === 'Increment') bump(row,       sid, rw + 5,  completedAt)
    logBodyweight(sid, pullups, 3, 8, 'Complete', startedAt + 34*minMs)
    const [cw, ca] = s.curl;  logWeighted(sid, curl,       3, 10, cw, ca, startedAt + 44*minMs);   if (ca === 'Increment') bump(curl,      sid, cw + 5,  completedAt)
    const [hw, ha] = s.hcurl; logWeighted(sid, hammerCurl, 3, 10, hw, ha, startedAt + 52*minMs);   if (ha === 'Increment') bump(hammerCurl,sid, hw + 5,  completedAt)
    const [fw, fa] = s.fp;    logWeighted(sid, facePull,   3, 15, fw, fa, startedAt + 60*minMs);   if (fa === 'Increment') bump(facePull,  sid, fw + 5,  completedAt)
  }

  // ── Leg Day exercises ──────────────────────────────────────────────────────
  const squat      = addWeighted(legDay, 'Back Squat',      0, 4, 8,  115, 10, 170)
  const rdl        = addWeighted(legDay, 'Romanian DL',     1, 3, 10, 95,   5, 170)
  const legPress   = addWeighted(legDay, 'Leg Press',       2, 4, 12, 180, 10, 170)
  const calfRaise  = addWeighted(legDay, 'Calf Raises',     3, 4, 15,  80,  5, 170)
  const lunges     = addBodyweight(legDay, 'Walking Lunges',4, 3, 16,      170)
  const plank      = addTimeBased(legDay, 'Plank',          5, 3, 45,      170)

  // Leg Day — 17 sessions
  const legSessions = [
    { daysAgo: 116, sq: [115,'Increment'], rdl: [95,'Increment'],  lp: [180,'Increment'], cr: [80,'Stay']       },
    { daysAgo: 109, sq: [125,'Increment'], rdl: [100,'Stay'],      lp: [190,'Increment'], cr: [80,'Increment']  },
    { daysAgo: 102, sq: [135,'Stay'],      rdl: [100,'Increment'], lp: [200,'Stay'],      cr: [85,'Stay']       },
    { daysAgo:  95, sq: [135,'Increment'], rdl: [105,'Increment'], lp: [200,'Increment'], cr: [85,'Increment']  },
    { daysAgo:  88, sq: [145,'Increment'], rdl: [110,'Stay'],      lp: [210,'Stay'],      cr: [90,'Stay']       },
    { daysAgo:  81, sq: [155,'Stay'],      rdl: [110,'Increment'], lp: [210,'Increment'], cr: [90,'Stay']       },
    { daysAgo:  74, sq: [155,'Increment'], rdl: [115,'Stay'],      lp: [220,'Increment'], cr: [90,'Increment']  },
    { daysAgo:  67, sq: [165,'Stay'],      rdl: [115,'Stay'],      lp: [230,'Stay'],      cr: [95,'Stay']       },
    { daysAgo:  60, sq: [165,'Increment'], rdl: [115,'Increment'], lp: [230,'Increment'], cr: [95,'Increment']  },
    { daysAgo:  53, sq: [175,'Increment'], rdl: [120,'Stay'],      lp: [240,'Stay'],      cr: [100,'Stay']      },
    { daysAgo:  46, sq: [185,'Stay'],      rdl: [120,'Increment'], lp: [240,'Increment'], cr: [100,'Increment'] },
    { daysAgo:  39, sq: [185,'Increment'], rdl: [125,'Stay'],      lp: [250,'Stay'],      cr: [105,'Stay']      },
    { daysAgo:  32, sq: [195,'Stay'],      rdl: [125,'Increment'], lp: [250,'Increment'], cr: [105,'Stay']      },
    { daysAgo:  25, sq: [195,'Increment'], rdl: [130,'Stay'],      lp: [260,'Increment'], cr: [105,'Increment'] },
    { daysAgo:  18, sq: [205,'Stay'],      rdl: [130,'Stay'],      lp: [270,'Stay'],      cr: [110,'Stay']      },
    { daysAgo:  11, sq: [205,'Increment'], rdl: [130,'Increment'], lp: [270,'Increment'], cr: [110,'Increment'] },
    { daysAgo:   5, sq: [215,'Stay'],      rdl: [135,'Stay'],      lp: [280,'Stay'],      cr: [115,'Stay']      },
  ]

  for (const s of legSessions) {
    const { sid, startedAt, completedAt } = makeSession(legDay, s.daysAgo, 70)
    const [sw, sa] = s.sq;  logWeighted(sid, squat,    4, 8,  sw, sa, startedAt);              if (sa === 'Increment') bump(squat,    sid, sw + 10, completedAt)
    const [rw, ra] = s.rdl; logWeighted(sid, rdl,      3, 10, rw, ra, startedAt + 22*minMs);   if (ra === 'Increment') bump(rdl,      sid, rw + 5,  completedAt)
    const [lw, la] = s.lp;  logWeighted(sid, legPress, 4, 12, lw, la, startedAt + 36*minMs);   if (la === 'Increment') bump(legPress, sid, lw + 10, completedAt)
    const [cw, ca] = s.cr;  logWeighted(sid, calfRaise,4, 15, cw, ca, startedAt + 55*minMs);   if (ca === 'Increment') bump(calfRaise,sid, cw + 5,  completedAt)
    logBodyweight(sid, lunges, 3, 16, 'Complete', startedAt + 62*minMs)
    // Occasional plank failure
    if (s.daysAgo % 20 === 4) {
      insertSetLog.run(sid, plank, 1, null, null, null, 45, 45, 'Hold',   startedAt + 66*minMs)
      insertSetLog.run(sid, plank, 2, null, null, null, 45, 45, 'Hold',   startedAt + 67*minMs)
      insertSetLog.run(sid, plank, 3, null, null, null, 45, 28, 'Failed', startedAt + 68*minMs)
    } else {
      logTimeBased(sid, plank, 3, 45, 'Hold', startedAt + 66*minMs)
    }
  }

  // ── Upper Body exercises ───────────────────────────────────────────────────
  const dbBench   = addWeighted(upperDay, 'DB Bench Press',   0, 4, 10, 35, 5, 120)
  const latPull   = addWeighted(upperDay, 'Lat Pulldown',     1, 4, 10, 80, 5, 120)
  const shoulderP = addWeighted(upperDay, 'Shoulder Press',   2, 3, 10, 30, 5, 120)
  const cableRow  = addWeighted(upperDay, 'Cable Row',        3, 3, 12, 60, 5, 120)
  const lateralR  = addWeighted(upperDay, 'Lateral Raises',  4, 3, 15, 10, 5, 120)
  const tricepPD  = addWeighted(upperDay, 'Tricep Pushdown', 5, 3, 12, 40, 5, 120)

  const upperSessions = [
    { daysAgo: 118, db: [35,'Increment'], lp: [80,'Increment'], sp: [30,'Stay'],       cr: [60,'Increment'], lr: [10,'Increment'], tp: [40,'Increment'] },
    { daysAgo: 111, db: [40,'Stay'],      lp: [85,'Stay'],      sp: [30,'Increment'],  cr: [65,'Stay'],      lr: [15,'Stay'],      tp: [45,'Stay'] },
    { daysAgo: 104, db: [40,'Increment'], lp: [85,'Increment'], sp: [35,'Stay'],       cr: [65,'Increment'], lr: [15,'Stay'],      tp: [45,'Increment'] },
    { daysAgo:  97, db: [45,'Stay'],      lp: [90,'Stay'],      sp: [35,'Increment'],  cr: [70,'Stay'],      lr: [15,'Increment'], tp: [50,'Stay'] },
    { daysAgo:  90, db: [45,'Increment'], lp: [90,'Increment'], sp: [40,'Stay'],       cr: [70,'Increment'], lr: [20,'Stay'],      tp: [50,'Increment'] },
    { daysAgo:  83, db: [50,'Stay'],      lp: [95,'Stay'],      sp: [40,'Increment'],  cr: [75,'Stay'],      lr: [20,'Stay'],      tp: [55,'Stay'] },
    { daysAgo:  76, db: [50,'Increment'], lp: [95,'Increment'], sp: [45,'Stay'],       cr: [75,'Increment'], lr: [20,'Increment'], tp: [55,'Stay'] },
    { daysAgo:  69, db: [55,'Increment'], lp: [100,'Stay'],     sp: [45,'Increment'],  cr: [80,'Stay'],      lr: [25,'Stay'],      tp: [55,'Increment'] },
    { daysAgo:  62, db: [60,'Stay'],      lp: [100,'Increment'],sp: [50,'Stay'],       cr: [80,'Increment'], lr: [25,'Stay'],      tp: [60,'Stay'] },
    { daysAgo:  55, db: [60,'Increment'], lp: [105,'Stay'],     sp: [50,'Increment'],  cr: [85,'Stay'],      lr: [25,'Increment'], tp: [60,'Increment'] },
    { daysAgo:  48, db: [65,'Stay'],      lp: [105,'Increment'],sp: [55,'Stay'],       cr: [85,'Increment'], lr: [30,'Stay'],      tp: [65,'Stay'] },
    { daysAgo:  41, db: [65,'Increment'], lp: [110,'Stay'],     sp: [55,'Increment'],  cr: [90,'Stay'],      lr: [30,'Stay'],      tp: [65,'Increment'] },
    { daysAgo:  34, db: [70,'Stay'],      lp: [110,'Increment'],sp: [60,'Stay'],       cr: [90,'Increment'], lr: [30,'Stay'],      tp: [70,'Stay'] },
    { daysAgo:  27, db: [70,'Increment'], lp: [115,'Stay'],     sp: [60,'Increment'],  cr: [95,'Stay'],      lr: [30,'Increment'], tp: [70,'Increment'] },
    { daysAgo:  20, db: [75,'Stay'],      lp: [115,'Increment'],sp: [65,'Stay'],       cr: [95,'Increment'], lr: [35,'Stay'],      tp: [75,'Stay'] },
    { daysAgo:  13, db: [75,'Increment'], lp: [120,'Stay'],     sp: [65,'Stay'],       cr: [100,'Stay'],     lr: [35,'Stay'],      tp: [75,'Stay'] },
    { daysAgo:   6, db: [80,'Stay'],      lp: [120,'Stay'],     sp: [65,'Increment'],  cr: [100,'Increment'],lr: [35,'Increment'], tp: [75,'Increment'] },
  ]

  for (const s of upperSessions) {
    const { sid, startedAt, completedAt } = makeSession(upperDay, s.daysAgo, 65)
    const [dw, da] = s.db; logWeighted(sid, dbBench,  4, 10, dw, da, startedAt);              if (da === 'Increment') bump(dbBench,  sid, dw + 5, completedAt)
    const [lw, la] = s.lp; logWeighted(sid, latPull,  4, 10, lw, la, startedAt + 18*minMs);   if (la === 'Increment') bump(latPull,  sid, lw + 5, completedAt)
    const [sw, sa] = s.sp; logWeighted(sid, shoulderP,3, 10, sw, sa, startedAt + 33*minMs);   if (sa === 'Increment') bump(shoulderP,sid, sw + 5, completedAt)
    const [cw, ca] = s.cr; logWeighted(sid, cableRow, 3, 12, cw, ca, startedAt + 45*minMs);   if (ca === 'Increment') bump(cableRow, sid, cw + 5, completedAt)
    const [lrw, lra] = s.lr; logWeighted(sid, lateralR, 3, 15, lrw, lra, startedAt + 53*minMs); if (lra === 'Increment') bump(lateralR, sid, lrw + 5, completedAt)
    const [tw, ta] = s.tp; logWeighted(sid, tricepPD, 3, 12, tw, ta, startedAt + 60*minMs);   if (ta === 'Increment') bump(tricepPD, sid, tw + 5, completedAt)
  }

  // ── Core & Mobility exercises ──────────────────────────────────────────────
  const plank2     = addTimeBased(coreDay, 'Plank',            0, 4, 60,  100)
  const sidePlank  = addTimeBased(coreDay, 'Side Plank',       1, 2, 30,  100)
  const hollow     = addTimeBased(coreDay, 'Hollow Hold',      2, 3, 20,  100)
  const legRaise   = addBodyweight(coreDay, 'Leg Raises',      3, 3, 15,  100)
  const russianTwist=addBodyweight(coreDay, 'Russian Twists',  4, 3, 20,  100)
  const absRollout = addWeighted(coreDay, 'Ab Wheel Rollout',  5, 3, 10, 10, 0, 100)

  for (let i = 0; i < 14; i++) {
    const daysAgo = 95 - i * 7
    const { sid, startedAt } = makeSession(coreDay, daysAgo, 35)
    logTimeBased(sid, plank2,      4, 60, 'Hold',     startedAt)
    logTimeBased(sid, sidePlank,   2, 30, 'Hold',     startedAt + 8*minMs)
    logTimeBased(sid, hollow,      3, 20, 'Hold',     startedAt + 14*minMs)
    logBodyweight(sid, legRaise,   3, 15, 'Complete', startedAt + 20*minMs)
    logBodyweight(sid, russianTwist,3,20, 'Complete', startedAt + 26*minMs)
    insertSetLog.run(sid, absRollout, 1, 10, 10, 10, null, null, 'Complete', startedAt + 30*minMs)
    insertSetLog.run(sid, absRollout, 2, 10, 10, 10, null, null, 'Complete', startedAt + 31*minMs)
    insertSetLog.run(sid, absRollout, 3, 10, 10, 10, null, null, 'Complete', startedAt + 32*minMs)
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // ARCHIVED ROUTINES  (20 routines with history, newest-first for the picker)
  // ═══════════════════════════════════════════════════════════════════════════
  // Each gets 3–8 sessions and at least one weighted exercise with progressions.
  // archivedDaysAgo controls recency sort in the picker; sessions go back
  // further to simulate earlier eras.

  // Helper: create an archived routine with a set of weighted sessions
  function archivedWeightRoutine(name, days, createdDaysAgo, archivedDaysAgo, exercises, sessionSpecs) {
    const rId = addRoutine(name, days, createdDaysAgo, archivedDaysAgo)
    const exIds = exercises.map(([exName, order, sets, reps, startW, inc]) =>
      addWeighted(rId, exName, order, sets, reps, startW, inc, createdDaysAgo)
    )
    for (const spec of sessionSpecs) {
      const { sid, startedAt, completedAt } = makeSession(rId, spec.daysAgo, spec.duration ?? 50)
      spec.logs.forEach(([exIdx, weight, action], i) => {
        const ex = exercises[exIdx]
        logWeighted(sid, exIds[exIdx], ex[3], ex[4], weight, action, startedAt + i * 15 * minMs)
        if (action === 'Increment') bump(exIds[exIdx], sid, weight + ex[5], completedAt)
      })
    }
    return rId
  }

  // 1. Functional Fitness — most recently archived (5 days ago)
  archivedWeightRoutine(
    'Functional Fitness', ['mon', 'wed', 'fri'], 90, 5,
    [['KB Swing', 0, 3, 15, 35, 5], ['Box Jump', 1, 3, 10, 0, 0], ['Goblet Squat', 2, 3, 12, 35, 5]],
    [
      { daysAgo: 84, logs: [[0, 35,'Increment'], [2, 35,'Increment']] },
      { daysAgo: 77, logs: [[0, 40,'Stay'],      [2, 40,'Stay']] },
      { daysAgo: 70, logs: [[0, 40,'Increment'], [2, 40,'Increment']] },
      { daysAgo: 63, logs: [[0, 45,'Stay'],      [2, 45,'Stay']] },
      { daysAgo: 56, logs: [[0, 45,'Increment'], [2, 45,'Increment']] },
      { daysAgo: 14, logs: [[0, 50,'Stay'],      [2, 50,'Stay']] },
    ],
  )

  // 2. HIIT Circuit — 10 days ago
  archivedWeightRoutine(
    'HIIT Circuit', ['tue', 'thu', 'sat'], 75, 10,
    [['Thruster', 0, 4, 10, 45, 5], ['Power Clean', 1, 3, 5, 65, 5]],
    [
      { daysAgo: 70, logs: [[0, 45,'Increment'], [1, 65,'Stay']] },
      { daysAgo: 63, logs: [[0, 50,'Stay'],      [1, 65,'Increment']] },
      { daysAgo: 56, logs: [[0, 50,'Increment'], [1, 70,'Stay']] },
      { daysAgo: 49, logs: [[0, 55,'Stay'],      [1, 70,'Increment']] },
      { daysAgo: 28, logs: [[0, 55,'Stay'],      [1, 75,'Stay']] },
      { daysAgo: 21, logs: [[0, 55,'Increment'], [1, 75,'Stay']] },
    ],
  )

  // 3. Morning Mobility — 15 days ago
  {
    const rId = addRoutine('Morning Mobility', ['mon', 'tue', 'wed', 'thu', 'fri'], 80, 15)
    const e1 = addTimeBased(rId, 'Yoga Flow',     0, 1, 15*60, 80)
    const e2 = addTimeBased(rId, 'Foam Roll',     1, 1, 10*60, 80)
    const e3 = addBodyweight(rId,'Hip Circles',   2, 2, 10,    80)
    for (let i = 0; i < 8; i++) {
      const { sid, startedAt } = makeSession(rId, 70 - i * 5, 28)
      logTimeBased(sid, e1, 1, 15*60, 'Hold',     startedAt)
      logTimeBased(sid, e2, 1, 10*60, 'Hold',     startedAt + 16*minMs)
      logBodyweight(sid, e3, 2, 10, 'Complete', startedAt + 27*minMs)
    }
  }

  // 4. Barbell Club — 20 days ago
  archivedWeightRoutine(
    'Barbell Club', ['mon', 'wed', 'fri'], 100, 20,
    [['Competition Squat', 0, 5, 5, 185, 5], ['Paused Bench', 1, 5, 5, 135, 5], ['Sumo Deadlift', 2, 4, 5, 175, 10]],
    [
      { daysAgo: 95, logs: [[0, 185,'Increment'], [1, 135,'Stay'],      [2, 175,'Increment']] },
      { daysAgo: 88, logs: [[0, 190,'Stay'],      [1, 135,'Increment'], [2, 185,'Stay']] },
      { daysAgo: 81, logs: [[0, 190,'Increment'], [1, 140,'Stay'],      [2, 185,'Increment']] },
      { daysAgo: 74, logs: [[0, 195,'Increment'], [1, 140,'Increment'], [2, 195,'Stay']] },
      { daysAgo: 67, logs: [[0, 200,'Stay'],      [1, 145,'Stay'],      [2, 195,'Increment']] },
      { daysAgo: 45, logs: [[0, 200,'Increment'], [1, 145,'Increment'], [2, 205,'Stay']] },
      { daysAgo: 30, logs: [[0, 205,'Stay'],      [1, 150,'Stay'],      [2, 205,'Stay']] },
    ],
  )

  // 5. Powerlifting Comp Prep — 25 days ago
  archivedWeightRoutine(
    'Powerlifting Comp Prep', ['mon', 'tue', 'thu', 'fri'], 130, 25,
    [['Squat 1RM Attempt', 0, 1, 1, 225, 5], ['Bench 1RM Attempt', 1, 1, 1, 165, 5], ['Deadlift 1RM Attempt', 2, 1, 1, 275, 10]],
    [
      { daysAgo: 125, logs: [[0, 225,'Stay'],      [1, 165,'Stay'],      [2, 275,'Increment']] },
      { daysAgo: 118, logs: [[0, 225,'Increment'], [1, 165,'Increment'], [2, 285,'Stay']] },
      { daysAgo: 111, logs: [[0, 230,'Stay'],      [1, 170,'Stay'],      [2, 285,'Increment']] },
      { daysAgo: 104, logs: [[0, 230,'Increment'], [1, 170,'Increment'], [2, 295,'Stay']] },
      { daysAgo:  97, logs: [[0, 235,'Stay'],      [1, 175,'Stay'],      [2, 295,'Stay']] },
      { daysAgo:  60, logs: [[0, 235,'Stay'],      [1, 175,'Stay'],      [2, 295,'Increment']] },
      { daysAgo:  40, logs: [[0, 235,'Increment'], [1, 175,'Increment'], [2, 305,'Stay']] },
      { daysAgo:  33, logs: [[0, 240,'Stay'],      [1, 180,'Stay'],      [2, 305,'Stay']] },
    ],
  )

  // 6. Recovery Week — 30 days ago
  {
    const rId = addRoutine('Recovery Week', ['mon', 'wed', 'fri'], 140, 30)
    const e1 = addWeighted(rId, 'Light Squat',  0, 2, 10, 95, 0, 140)
    const e2 = addWeighted(rId, 'Light Bench',  1, 2, 10, 75, 0, 140)
    const e3 = addWeighted(rId, 'Light Row',    2, 2, 10, 55, 0, 140)
    for (let i = 0; i < 4; i++) {
      const { sid, startedAt } = makeSession(rId, 130 - i * 3, 35)
      logWeighted(sid, e1, 2, 10, 95, 'Stay', startedAt)
      logWeighted(sid, e2, 2, 10, 75, 'Stay', startedAt + 12*minMs)
      logWeighted(sid, e3, 2, 10, 55, 'Stay', startedAt + 24*minMs)
    }
  }

  // 7. Bodyweight Only — 35 days ago
  {
    const rId = addRoutine('Bodyweight Only', ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], 150, 35)
    const e1 = addBodyweight(rId, 'Push-up Variations',   0, 5, 20, 150)
    const e2 = addBodyweight(rId, 'Ring Rows',             1, 4, 12, 150)
    const e3 = addBodyweight(rId, 'Pistol Squat Negatives',2, 3, 8,  150)
    const e4 = addBodyweight(rId, 'Muscle-up Negatives',   3, 3, 5,  150)
    for (let i = 0; i < 10; i++) {
      const { sid, startedAt } = makeSession(rId, 140 - i * 7, 40)
      logBodyweight(sid, e1, 5, 20, 'Complete', startedAt)
      logBodyweight(sid, e2, 4, 12, 'Complete', startedAt + 12*minMs)
      logBodyweight(sid, e3, 3, 8,  i % 3 === 0 ? 'Failed' : 'Complete', startedAt + 23*minMs)
      logBodyweight(sid, e4, 3, 5,  'Complete', startedAt + 31*minMs)
    }
  }

  // 8. Crossfit WOD — 40 days ago
  archivedWeightRoutine(
    'Crossfit WOD', ['mon', 'tue', 'wed', 'thu', 'fri'], 120, 40,
    [['Wall Ball', 0, 3, 20, 20, 0], ['Clean & Jerk', 1, 3, 5, 75, 5], ['Kettlebell Snatch', 2, 3, 10, 35, 5]],
    [
      { daysAgo: 115, logs: [[0, 20,'Stay'],  [1, 75,'Increment'],  [2, 35,'Increment']] },
      { daysAgo: 108, logs: [[0, 20,'Stay'],  [1, 80,'Stay'],       [2, 40,'Stay']] },
      { daysAgo: 101, logs: [[0, 20,'Stay'],  [1, 80,'Increment'],  [2, 40,'Increment']] },
      { daysAgo:  94, logs: [[0, 20,'Stay'],  [1, 85,'Stay'],       [2, 45,'Stay']] },
      { daysAgo:  80, logs: [[0, 20,'Stay'],  [1, 85,'Increment'],  [2, 45,'Stay']] },
      { daysAgo:  60, logs: [[0, 20,'Stay'],  [1, 90,'Stay'],       [2, 45,'Stay']] },
    ],
  )

  // 9. Olympic Lifting — 45 days ago
  archivedWeightRoutine(
    'Olympic Lifting', ['tue', 'thu', 'sat'], 160, 45,
    [['Snatch', 0, 5, 3, 65, 5], ['Clean & Jerk', 1, 5, 3, 85, 5], ['Power Clean', 2, 4, 4, 75, 5]],
    [
      { daysAgo: 155, logs: [[0, 65,'Increment'],  [1, 85,'Increment'],  [2, 75,'Increment']] },
      { daysAgo: 148, logs: [[0, 70,'Stay'],       [1, 90,'Stay'],       [2, 80,'Stay']] },
      { daysAgo: 141, logs: [[0, 70,'Increment'],  [1, 90,'Increment'],  [2, 80,'Increment']] },
      { daysAgo: 120, logs: [[0, 75,'Stay'],       [1, 95,'Stay'],       [2, 85,'Stay']] },
      { daysAgo:  90, logs: [[0, 75,'Increment'],  [1, 95,'Increment'],  [2, 85,'Stay']] },
    ],
  )

  // 10. 5/3/1 Deadlift — 50 days ago
  archivedWeightRoutine(
    '5/3/1 Deadlift', ['mon', 'thu'], 170, 50,
    [['Deadlift Main Work', 0, 3, 5, 185, 10], ['SLDL Accessory', 1, 4, 10, 95, 5], ['Good Morning', 2, 3, 10, 55, 5]],
    [
      { daysAgo: 165, logs: [[0, 185,'Increment'], [1, 95,'Increment'],  [2, 55,'Increment']] },
      { daysAgo: 158, logs: [[0, 195,'Increment'], [1, 100,'Stay'],      [2, 60,'Stay']] },
      { daysAgo: 151, logs: [[0, 205,'Stay'],      [1, 100,'Increment'], [2, 60,'Increment']] },
      { daysAgo: 144, logs: [[0, 205,'Increment'], [1, 105,'Stay'],      [2, 65,'Stay']] },
      { daysAgo: 137, logs: [[0, 215,'Stay'],      [1, 105,'Increment'], [2, 65,'Increment']] },
      { daysAgo: 115, logs: [[0, 215,'Increment'], [1, 110,'Stay'],      [2, 70,'Stay']] },
      { daysAgo:  80, logs: [[0, 225,'Stay'],      [1, 110,'Stay'],      [2, 70,'Stay']] },
    ],
  )

  // 11. 5/3/1 Squat — 55 days ago
  archivedWeightRoutine(
    '5/3/1 Squat', ['tue', 'fri'], 180, 55,
    [['Squat Main Work', 0, 3, 5, 155, 10], ['Front Squat Accessory', 1, 4, 8, 75, 5], ['Pause Squat', 2, 3, 5, 95, 5]],
    [
      { daysAgo: 175, logs: [[0, 155,'Increment'], [1, 75,'Stay'],       [2, 95,'Increment']] },
      { daysAgo: 168, logs: [[0, 165,'Stay'],      [1, 75,'Increment'],  [2, 100,'Stay']] },
      { daysAgo: 161, logs: [[0, 165,'Increment'], [1, 80,'Stay'],       [2, 100,'Increment']] },
      { daysAgo: 154, logs: [[0, 175,'Increment'], [1, 80,'Increment'],  [2, 105,'Stay']] },
      { daysAgo: 147, logs: [[0, 185,'Stay'],      [1, 85,'Stay'],       [2, 105,'Increment']] },
      { daysAgo: 120, logs: [[0, 185,'Increment'], [1, 85,'Increment'],  [2, 110,'Stay']] },
      { daysAgo:  90, logs: [[0, 195,'Stay'],      [1, 90,'Stay'],       [2, 110,'Stay']] },
    ],
  )

  // 12. Deload Week — 60 days ago
  {
    const rId = addRoutine('Deload Week', ['mon', 'wed', 'fri'], 190, 60)
    const e1 = addWeighted(rId, 'Squat (60%)',  0, 2, 8, 115, 0, 190)
    const e2 = addWeighted(rId, 'Bench (60%)',  1, 2, 8,  90, 0, 190)
    const e3 = addWeighted(rId, 'Deadlift (60%)',2,2, 5, 135, 0, 190)
    for (let i = 0; i < 3; i++) {
      const { sid, startedAt } = makeSession(rId, 185 - i * 3, 30)
      logWeighted(sid, e1, 2, 8, 115, 'Stay', startedAt)
      logWeighted(sid, e2, 2, 8,  90, 'Stay', startedAt + 10*minMs)
      logWeighted(sid, e3, 2, 5, 135, 'Stay', startedAt + 20*minMs)
    }
  }

  // 13. Hypertrophy Block — 70 days ago
  archivedWeightRoutine(
    'Hypertrophy Block', ['mon', 'tue', 'thu', 'fri'], 200, 70,
    [['DB Flye', 0, 4, 15, 20, 5], ['Cable Crossover', 1, 4, 15, 25, 5], ['Pec Deck', 2, 3, 15, 40, 5]],
    [
      { daysAgo: 196, logs: [[0, 20,'Increment'], [1, 25,'Stay'],      [2, 40,'Increment']] },
      { daysAgo: 192, logs: [[0, 25,'Stay'],      [1, 25,'Increment'], [2, 45,'Stay']] },
      { daysAgo: 188, logs: [[0, 25,'Increment'], [1, 30,'Stay'],      [2, 45,'Increment']] },
      { daysAgo: 184, logs: [[0, 30,'Stay'],      [1, 30,'Increment'], [2, 50,'Stay']] },
      { daysAgo: 160, logs: [[0, 30,'Increment'], [1, 35,'Stay'],      [2, 50,'Stay']] },
      { daysAgo: 140, logs: [[0, 35,'Stay'],      [1, 35,'Stay'],      [2, 50,'Stay']] },
    ],
  )

  // 14. Strength Block — 75 days ago
  archivedWeightRoutine(
    'Strength Block', ['mon', 'wed', 'fri'], 210, 75,
    [['Heavy Squat', 0, 5, 5, 195, 10], ['Heavy Press', 1, 5, 5, 145, 5], ['Heavy Pull', 2, 5, 5, 215, 10]],
    [
      { daysAgo: 205, logs: [[0, 195,'Increment'], [1, 145,'Increment'], [2, 215,'Increment']] },
      { daysAgo: 200, logs: [[0, 205,'Stay'],      [1, 150,'Stay'],      [2, 225,'Stay']] },
      { daysAgo: 195, logs: [[0, 205,'Increment'], [1, 150,'Increment'], [2, 225,'Increment']] },
      { daysAgo: 190, logs: [[0, 215,'Increment'], [1, 155,'Stay'],      [2, 235,'Stay']] },
      { daysAgo: 160, logs: [[0, 225,'Stay'],      [1, 155,'Increment'], [2, 235,'Increment']] },
      { daysAgo: 130, logs: [[0, 225,'Stay'],      [1, 160,'Stay'],      [2, 245,'Stay']] },
      { daysAgo: 100, logs: [[0, 225,'Increment'], [1, 160,'Stay'],      [2, 245,'Stay']] },
      { daysAgo:  90, logs: [[0, 230,'Stay'],      [1, 160,'Stay'],      [2, 245,'Stay']] },
    ],
  )

  // 15. Beginner B — 80 days ago
  archivedWeightRoutine(
    'Beginner B', ['tue', 'thu', 'sat'], 240, 80,
    [['Squat', 0, 3, 5, 45, 5], ['Overhead Press', 1, 3, 5, 45, 5], ['Deadlift', 2, 1, 5, 65, 5]],
    [
      { daysAgo: 235, logs: [[0, 45,'Increment'],  [1, 45,'Increment'],  [2, 65,'Increment']] },
      { daysAgo: 228, logs: [[0, 50,'Increment'],  [1, 50,'Increment'],  [2, 70,'Increment']] },
      { daysAgo: 221, logs: [[0, 55,'Increment'],  [1, 55,'Increment'],  [2, 75,'Increment']] },
      { daysAgo: 214, logs: [[0, 60,'Increment'],  [1, 60,'Stay'],       [2, 80,'Increment']] },
      { daysAgo: 207, logs: [[0, 65,'Increment'],  [1, 60,'Increment'],  [2, 85,'Increment']] },
    ],
  )

  // 16. Beginner A — 85 days ago
  archivedWeightRoutine(
    'Beginner A', ['mon', 'wed', 'fri'], 250, 85,
    [['Squat', 0, 3, 5, 45, 5], ['Bench Press', 1, 3, 5, 45, 5], ['Barbell Row', 2, 3, 5, 45, 5]],
    [
      { daysAgo: 245, logs: [[0, 45,'Increment'],  [1, 45,'Increment'],  [2, 45,'Increment']] },
      { daysAgo: 238, logs: [[0, 50,'Increment'],  [1, 50,'Increment'],  [2, 50,'Increment']] },
      { daysAgo: 231, logs: [[0, 55,'Increment'],  [1, 55,'Increment'],  [2, 55,'Increment']] },
      { daysAgo: 224, logs: [[0, 60,'Increment'],  [1, 55,'Stay'],       [2, 60,'Increment']] },
      { daysAgo: 217, logs: [[0, 65,'Stay'],       [1, 55,'Increment'],  [2, 65,'Stay']] },
    ],
  )

  // 17. Starting Strength — 90 days ago
  archivedWeightRoutine(
    'Starting Strength', ['mon', 'wed', 'fri'], 270, 90,
    [['Squat', 0, 3, 5, 95, 5], ['Bench Press', 1, 3, 5, 75, 5], ['Deadlift', 2, 1, 5, 115, 10], ['Power Clean', 3, 5, 3, 65, 5]],
    [
      { daysAgo: 265, logs: [[0, 95,'Increment'],  [1, 75,'Stay'],      [2, 115,'Increment'], [3, 65,'Increment']] },
      { daysAgo: 258, logs: [[0, 100,'Increment'], [1, 75,'Increment'], [2, 125,'Increment'], [3, 70,'Stay']] },
      { daysAgo: 251, logs: [[0, 105,'Increment'], [1, 80,'Stay'],      [2, 135,'Increment'], [3, 70,'Increment']] },
      { daysAgo: 244, logs: [[0, 110,'Increment'], [1, 80,'Increment'], [2, 145,'Stay'],      [3, 75,'Stay']] },
      { daysAgo: 237, logs: [[0, 115,'Stay'],      [1, 85,'Stay'],      [2, 145,'Increment'], [3, 75,'Increment']] },
      { daysAgo: 230, logs: [[0, 115,'Increment'], [1, 85,'Increment'], [2, 155,'Increment'], [3, 80,'Stay']] },
      { daysAgo: 220, logs: [[0, 120,'Stay'],      [1, 90,'Stay'],      [2, 165,'Stay'],      [3, 80,'Stay']] },
      { daysAgo: 210, logs: [[0, 120,'Increment'], [1, 90,'Stay'],      [2, 165,'Increment'], [3, 80,'Increment']] },
      { daysAgo: 200, logs: [[0, 125,'Stay'],      [1, 90,'Increment'], [2, 175,'Stay'],      [3, 85,'Stay']] },
      { daysAgo: 195, logs: [[0, 125,'Stay'],      [1, 95,'Stay'],      [2, 175,'Stay'],      [3, 85,'Stay']] },
    ],
  )

  // 18. PPL Full Body — 100 days ago
  archivedWeightRoutine(
    'PPL Full Body', ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], 310, 100,
    [['Squat', 0, 3, 8, 115, 5], ['Bench Press', 1, 3, 8, 95, 5], ['Deadlift', 2, 3, 5, 155, 5]],
    [
      { daysAgo: 305, logs: [[0, 115,'Increment'], [1, 95,'Increment'],  [2, 155,'Increment']] },
      { daysAgo: 298, logs: [[0, 120,'Stay'],      [1, 100,'Stay'],      [2, 160,'Stay']] },
      { daysAgo: 291, logs: [[0, 120,'Increment'], [1, 100,'Increment'], [2, 160,'Increment']] },
      { daysAgo: 284, logs: [[0, 125,'Increment'], [1, 105,'Stay'],      [2, 165,'Increment']] },
      { daysAgo: 277, logs: [[0, 130,'Stay'],      [1, 105,'Increment'], [2, 170,'Stay']] },
      { daysAgo: 270, logs: [[0, 130,'Increment'], [1, 110,'Stay'],      [2, 170,'Increment']] },
      { daysAgo: 263, logs: [[0, 135,'Stay'],      [1, 110,'Stay'],      [2, 175,'Stay']] },
      { daysAgo: 256, logs: [[0, 135,'Stay'],      [1, 110,'Stay'],      [2, 175,'Stay']] },
    ],
  )

  // 19. Pull v1 — 115 days ago
  archivedWeightRoutine(
    'Pull v1', ['tue', 'thu'], 330, 115,
    [['Deadlift', 0, 3, 5, 95, 10], ['Bent Over Row', 1, 3, 8, 65, 5], ['Chin-ups', 2, 3, 8, 0, 0]],
    [
      { daysAgo: 325, logs: [[0, 95,'Increment'],  [1, 65,'Increment']] },
      { daysAgo: 318, logs: [[0, 105,'Increment'], [1, 70,'Stay']] },
      { daysAgo: 311, logs: [[0, 115,'Stay'],      [1, 70,'Increment']] },
      { daysAgo: 304, logs: [[0, 115,'Increment'], [1, 75,'Stay']] },
      { daysAgo: 297, logs: [[0, 125,'Stay'],      [1, 75,'Increment']] },
    ],
  )

  // 20. Push v1 — 120 days ago
  archivedWeightRoutine(
    'Push v1', ['mon', 'wed', 'fri'], 340, 120,
    [['Bench Press', 0, 3, 8, 75, 5], ['Overhead Press', 1, 3, 8, 45, 5], ['Tricep Pushdown', 2, 3, 12, 30, 5]],
    [
      { daysAgo: 335, logs: [[0, 75,'Increment'],  [1, 45,'Increment'],  [2, 30,'Stay']] },
      { daysAgo: 328, logs: [[0, 80,'Stay'],       [1, 50,'Stay'],       [2, 30,'Increment']] },
      { daysAgo: 321, logs: [[0, 80,'Increment'],  [1, 50,'Increment'],  [2, 35,'Stay']] },
      { daysAgo: 314, logs: [[0, 85,'Increment'],  [1, 55,'Stay'],       [2, 35,'Increment']] },
      { daysAgo: 307, logs: [[0, 90,'Stay'],       [1, 55,'Increment'],  [2, 40,'Stay']] },
      { daysAgo: 300, logs: [[0, 90,'Increment'],  [1, 60,'Stay'],       [2, 40,'Stay']] },
    ],
  )


  // ═══════════════════════════════════════════════════════════════════════════
  // Reconcile exercises.starting_weight to each exercise's latest progression.
  // ═══════════════════════════════════════════════════════════════════════════
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
       (SELECT COUNT(*) FROM routines)                                    AS routines,
       (SELECT COUNT(*) FROM routines WHERE archived_at IS NULL)          AS active_routines,
       (SELECT COUNT(*) FROM routines WHERE archived_at IS NOT NULL)      AS archived_routines,
       (SELECT COUNT(*) FROM exercises)                                   AS exercises,
       (SELECT COUNT(*) FROM sessions)                                    AS sessions,
       (SELECT COUNT(*) FROM sessions WHERE completed_at IS NOT NULL)     AS completed_sessions,
       (SELECT COUNT(*) FROM sessions WHERE completed_at IS NULL)         AS active_sessions,
       (SELECT COUNT(*) FROM set_logs)                                    AS set_logs,
       (SELECT COUNT(*) FROM progressions)                                AS progressions`,
  )
  .get()

console.log('swole: seeded home page data')
console.table(counts)

db.close()
