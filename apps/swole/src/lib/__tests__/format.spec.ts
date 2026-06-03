import type { Exercise, NextTarget } from 'src/core/session-machine'
import type { ExerciseRow, SetLogRow } from 'src/db/types'
import {
  formatBannerSubtitle,
  formatCardioDuration,
  formatDayCodes,
  formatExerciseConfig,
  formatJournalSessionDate,
  formatNextUpLine,
  formatPreviousSetPeek,
  formatRecentSessionDate,
  formatRelativeDay,
  formatRunnerTarget,
  formatSessionDuration,
  formatSetRow,
  formatTimeBasedDuration,
  formatWeight,
  formatWeightPreview,
  getCurrentDayCode,
  mapArchiveRoutineError,
  mapCreateRoutineError,
  mapDeleteRoutineError,
  mapDeleteSessionError,
  mapSetLogError,
  mapStartSessionError,
  mapUnarchiveRoutineError,
  mapUndoError,
  mapUpdateRoutineError,
} from 'src/lib/format'
import type { PreviousSetPeek } from 'src/lib/runner'

// All test dates are pinned to specific instants so the suite passes
// regardless of the runtime TZ (CI runs UTC; the dev container runs PT).
// Mid-day instants keep the day-of-week stable across PT/UTC.

describe('getCurrentDayCode', () => {
  it('returns the day code for Monday', () => {
    expect(getCurrentDayCode(new Date('2026-05-25T12:00:00-07:00'))).toBe('mon')
  })

  it('returns the day code for Sunday', () => {
    expect(getCurrentDayCode(new Date('2026-05-31T12:00:00-07:00'))).toBe('sun')
  })

  it('covers every day-of-week index', () => {
    expect(getCurrentDayCode(new Date('2026-05-26T12:00:00Z'))).toBe('tue')
    expect(getCurrentDayCode(new Date('2026-05-27T12:00:00Z'))).toBe('wed')
    expect(getCurrentDayCode(new Date('2026-05-28T12:00:00Z'))).toBe('thu')
    expect(getCurrentDayCode(new Date('2026-05-29T12:00:00Z'))).toBe('fri')
    expect(getCurrentDayCode(new Date('2026-05-30T12:00:00Z'))).toBe('sat')
  })
})

describe('formatDayCodes', () => {
  it('marks today and preserves input order', () => {
    expect(formatDayCodes(['mon', 'wed', 'fri'], 'mon')).toEqual([
      { code: 'mon', label: 'Mon', isToday: true },
      { code: 'wed', label: 'Wed', isToday: false },
      { code: 'fri', label: 'Fri', isToday: false },
    ])
  })

  it('returns all isToday: false when today is null', () => {
    const result = formatDayCodes(['mon', 'wed', 'fri'], null)
    expect(result.every(r => r.isToday === false)).toBe(true)
  })

  it('returns all isToday: false when today is not in the days list', () => {
    const result = formatDayCodes(['tue', 'thu'], 'mon')
    expect(result.every(r => r.isToday === false)).toBe(true)
  })
})

describe('formatTimeBasedDuration', () => {
  it('renders zero seconds', () => {
    expect(formatTimeBasedDuration(0)).toBe('0s')
  })

  it('keeps the second-form past a minute', () => {
    expect(formatTimeBasedDuration(60)).toBe('60s')
  })
})

describe('formatCardioDuration', () => {
  it('rounds 60 seconds to 1 minute', () => {
    expect(formatCardioDuration(60)).toBe('1 min')
  })

  it('renders zero seconds as 0 min', () => {
    expect(formatCardioDuration(0)).toBe('0 min')
  })

  it('rounds 90 seconds to 2 min (half rounds up)', () => {
    expect(formatCardioDuration(90)).toBe('2 min')
  })

  it('rounds 1800 seconds to 30 min', () => {
    expect(formatCardioDuration(1800)).toBe('30 min')
  })
})

describe('formatNextUpLine', () => {
  it('formats a weighted exercise (AE1)', () => {
    const ex: Exercise = {
      name: 'Bench Press',
      type: 'weighted',
      sets: 3,
      targetReps: 10,
      startingWeight: 105,
      increment: 5,
    }
    expect(formatNextUpLine(ex)).toBe('Bench Press · 3×10 @ 105 lb')
  })

  it('formats a bodyweight exercise (AE2)', () => {
    const ex: Exercise = {
      name: 'Pushups',
      type: 'bodyweight',
      sets: 3,
      targetReps: 15,
    }
    expect(formatNextUpLine(ex)).toBe('Pushups · 3×15')
  })

  it('formats a time-based exercise (AE3)', () => {
    const ex: Exercise = {
      name: 'Plank',
      type: 'time-based',
      sets: 3,
      durationSeconds: 30,
    }
    expect(formatNextUpLine(ex)).toBe('Plank · 3×30s')
  })

  it('formats a cardio exercise (AE4)', () => {
    const ex: Exercise = {
      name: 'Run',
      type: 'cardio',
      sets: 1,
      durationSeconds: 1800,
    }
    expect(formatNextUpLine(ex)).toBe('Run · 30 min')
  })
})

describe('formatExerciseConfig', () => {
  it('weighted → sets×reps @ weight lb (+increment)', () => {
    const ex: Exercise = {
      name: 'Bench Press',
      type: 'weighted',
      sets: 3,
      targetReps: 5,
      startingWeight: 135,
      increment: 5,
    }
    expect(formatExerciseConfig(ex)).toBe('3×5 @ 135 lb (+5)')
  })

  it('bodyweight → sets×reps (no name prefix)', () => {
    const ex: Exercise = {
      name: 'Pushups',
      type: 'bodyweight',
      sets: 3,
      targetReps: 15,
    }
    expect(formatExerciseConfig(ex)).toBe('3×15')
  })

  it('time-based → sets×Xs', () => {
    const ex: Exercise = {
      name: 'Plank',
      type: 'time-based',
      sets: 3,
      durationSeconds: 60,
    }
    expect(formatExerciseConfig(ex)).toBe('3×60s')
  })

  it('cardio → N min (no sets prefix)', () => {
    const ex: Exercise = {
      name: 'Run',
      type: 'cardio',
      sets: 1,
      durationSeconds: 1800,
    }
    expect(formatExerciseConfig(ex)).toBe('30 min')
  })

  it('no leading name in any case', () => {
    const ex: Exercise = {
      name: 'Bench Press',
      type: 'weighted',
      sets: 3,
      targetReps: 5,
      startingWeight: 135,
      increment: 5,
    }
    expect(formatExerciseConfig(ex)).not.toContain('Bench Press')
  })
})

describe('formatBannerSubtitle', () => {
  it('formats a weighted target (AE6)', () => {
    const ex: Exercise = {
      name: 'Bench Press',
      type: 'weighted',
      sets: 3,
      targetReps: 10,
      startingWeight: 105,
      increment: 5,
    }
    const target: NextTarget = {
      weight: 105,
      reps: 10,
      exerciseIdx: 0,
      setIdx: 1,
    }
    expect(formatBannerSubtitle(ex, target)).toBe(
      'Bench Press, set 2/3 · 105 lb × 10',
    )
  })

  it('formats a bodyweight target', () => {
    const ex: Exercise = {
      name: 'Pushups',
      type: 'bodyweight',
      sets: 3,
      targetReps: 15,
    }
    const target: NextTarget = { reps: 15, exerciseIdx: 1, setIdx: 0 }
    expect(formatBannerSubtitle(ex, target)).toBe('Pushups, set 1/3 · 15 reps')
  })

  it('formats a time-based target', () => {
    const ex: Exercise = {
      name: 'Plank',
      type: 'time-based',
      sets: 3,
      durationSeconds: 30,
    }
    const target: NextTarget = { duration: 30, exerciseIdx: 2, setIdx: 2 }
    expect(formatBannerSubtitle(ex, target)).toBe('Plank, set 3/3 · 30s')
  })

  it('formats a cardio target with hardcoded 1/1 set label', () => {
    const ex: Exercise = {
      name: 'Run',
      type: 'cardio',
      sets: 1,
      durationSeconds: 1800,
    }
    const target: NextTarget = { duration: 1800, exerciseIdx: 3, setIdx: 0 }
    expect(formatBannerSubtitle(ex, target)).toBe('Run, set 1/1 · 30 min')
  })
})

describe('formatRecentSessionDate', () => {
  // Use mid-UTC-day instants so the formatted weekday is the same in CI (UTC)
  // and locally (PT).
  it('returns the short weekday for sessions completed in the past 7 days', () => {
    const at = new Date('2026-05-27T12:00:00Z') // Wed
    const now = new Date('2026-05-30T12:00:00Z') // Sat, 3 days later
    expect(formatRecentSessionDate(at, now)).toBe('Wed')
  })

  it('returns short month + day for sessions older than 7 days', () => {
    const at = new Date('2026-05-19T12:00:00Z')
    const now = new Date('2026-05-27T12:00:00Z') // 8 days later
    expect(formatRecentSessionDate(at, now)).toBe('May 19')
  })

  it('returns the short weekday when just-completed (at === now)', () => {
    const at = new Date('2026-05-27T12:00:00Z') // Wed
    expect(formatRecentSessionDate(at, at)).toBe('Wed')
  })
})

describe('mapStartSessionError', () => {
  it('maps RoutineAlreadyHasActiveSession code to a warning toast', () => {
    const result = mapStartSessionError({
      ok: false,
      kind: 'conflict',
      code: 'RoutineAlreadyHasActiveSession',
    })
    expect(result.severity).toBe('warning')
    expect(result.message).toMatch(/already in progress/)
  })

  it('maps RoutineArchived code to an error toast mentioning archived', () => {
    const result = mapStartSessionError({
      ok: false,
      kind: 'forbidden_transition',
      code: 'RoutineArchived',
    })
    expect(result.severity).toBe('error')
    expect(result.message).toMatch(/archived/)
  })

  it('falls back to the generic message for an unknown code', () => {
    const result = mapStartSessionError({
      ok: false,
      kind: 'conflict',
      code: 'UnknownError',
    })
    expect(result.severity).toBe('error')
    expect(result.message).toMatch(/Could not start session/)
  })
})

describe('mapArchiveRoutineError', () => {
  it('maps ArchiveBlockedByActiveSession code to a warning toast', () => {
    const result = mapArchiveRoutineError({
      ok: false,
      kind: 'forbidden_transition',
      code: 'ArchiveBlockedByActiveSession',
    })
    expect(result.severity).toBe('warning')
    expect(result.message).toMatch(/session is in progress/)
  })

  it('falls back to the generic message for an unknown code', () => {
    const result = mapArchiveRoutineError({
      ok: false,
      kind: 'conflict',
      code: 'UnknownError',
    })
    expect(result.severity).toBe('error')
    expect(result.message).toMatch(/Could not archive routine/)
  })
})

describe('mapCreateRoutineError', () => {
  it('maps ValidationError code to a "check highlighted fields" message', () => {
    const result = mapCreateRoutineError({
      ok: false,
      kind: 'validation',
      code: 'ValidationError',
    })
    expect(result.severity).toBe('error')
    expect(result.message).toMatch(/check the highlighted fields/i)
  })

  it('falls back to the generic message for an unknown code', () => {
    const result = mapCreateRoutineError({
      ok: false,
      kind: 'conflict',
      code: 'UnknownError',
    })
    expect(result.severity).toBe('error')
    expect(result.message).toMatch(/Could not create routine/)
  })
})

// ─── formatRunnerTarget ───────────────────────────────────────────────────────

describe('formatRunnerTarget', () => {
  it('weighted: weight lb × reps', () => {
    const ex: Exercise = {
      name: 'Bench',
      type: 'weighted',
      sets: 3,
      targetReps: 10,
      startingWeight: 100,
      increment: 5,
    }
    const target: NextTarget = {
      weight: 105,
      reps: 10,
      exerciseIdx: 0,
      setIdx: 1,
    }
    expect(formatRunnerTarget(ex, target)).toBe('105 lb × 10')
  })

  it('bodyweight: reps reps', () => {
    const ex: Exercise = {
      name: 'Pushups',
      type: 'bodyweight',
      sets: 3,
      targetReps: 15,
    }
    const target: NextTarget = { reps: 15, exerciseIdx: 0, setIdx: 0 }
    expect(formatRunnerTarget(ex, target)).toBe('15 reps')
  })

  it('time-based: duration in seconds', () => {
    const ex: Exercise = {
      name: 'Plank',
      type: 'time-based',
      sets: 2,
      durationSeconds: 30,
    }
    const target: NextTarget = { duration: 30, exerciseIdx: 0, setIdx: 0 }
    expect(formatRunnerTarget(ex, target)).toBe('30s')
  })

  it('cardio: duration in minutes', () => {
    const ex: Exercise = {
      name: 'Run',
      type: 'cardio',
      sets: 1,
      durationSeconds: 1800,
    }
    const target: NextTarget = { duration: 1800, exerciseIdx: 0, setIdx: 0 }
    expect(formatRunnerTarget(ex, target)).toBe('30 min')
  })
})

// ─── formatWeightPreview ──────────────────────────────────────────────────────

describe('formatWeightPreview', () => {
  it('formats as →N', () => {
    expect(formatWeightPreview(105)).toBe('→105')
    expect(formatWeightPreview(95)).toBe('→95')
    expect(formatWeightPreview(0)).toBe('→0')
  })
})

// ─── formatPreviousSetPeek ────────────────────────────────────────────────────

describe('formatPreviousSetPeek', () => {
  const weightedEx: Exercise = {
    name: 'Bench',
    type: 'weighted',
    sets: 3,
    targetReps: 10,
    startingWeight: 100,
    increment: 5,
  }
  const bwEx: Exercise = {
    name: 'Pushups',
    type: 'bodyweight',
    sets: 3,
    targetReps: 15,
  }
  const tbEx: Exercise = {
    name: 'Plank',
    type: 'time-based',
    sets: 2,
    durationSeconds: 30,
  }
  const cardioEx: Exercise = {
    name: 'Run',
    type: 'cardio',
    sets: 1,
    durationSeconds: 1800,
  }

  it('none → empty string', () => {
    const peek: PreviousSetPeek = { kind: 'none' }
    expect(formatPreviousSetPeek(peek, weightedEx)).toBe('')
    expect(formatPreviousSetPeek(peek, bwEx)).toBe('')
  })

  it('start → starting weight N lb', () => {
    const peek: PreviousSetPeek = { kind: 'start', startingWeight: 100 }
    expect(formatPreviousSetPeek(peek, weightedEx)).toBe(
      'starting weight 100 lb',
    )
  })

  it('log (weighted): weight lb × actualReps · actionType', () => {
    const peek: PreviousSetPeek = {
      kind: 'log',
      weight: 105,
      reps: 10,
      actualReps: 10,
      action: { type: 'Increment' },
    }
    expect(formatPreviousSetPeek(peek, weightedEx)).toBe(
      '105 lb × 10 · Increment',
    )
  })

  it('log (weighted Failed): shows actualReps not target reps', () => {
    const peek: PreviousSetPeek = {
      kind: 'log',
      weight: 100,
      reps: 10,
      actualReps: 7,
      action: { type: 'Failed', actualReps: 7 },
    }
    expect(formatPreviousSetPeek(peek, weightedEx)).toBe('100 lb × 7 · Failed')
  })

  it('log (bodyweight Failed): shows actualReps', () => {
    const peek: PreviousSetPeek = {
      kind: 'log',
      reps: 15,
      actualReps: 12,
      action: { type: 'Failed', actualReps: 12 },
    }
    expect(formatPreviousSetPeek(peek, bwEx)).toBe('12 reps · Failed')
  })

  it('log (time-based Hold): shows target duration', () => {
    const peek: PreviousSetPeek = {
      kind: 'log',
      duration: 30,
      action: { type: 'Hold' },
    }
    expect(formatPreviousSetPeek(peek, tbEx)).toBe('30s · Hold')
  })

  it('log (time-based Failed): shows actualDuration', () => {
    const peek: PreviousSetPeek = {
      kind: 'log',
      duration: 30,
      actualDuration: 15,
      action: { type: 'Failed', actualDuration: 15 },
    }
    expect(formatPreviousSetPeek(peek, tbEx)).toBe('15s · Failed')
  })

  it('log (cardio Done): shows formatted duration', () => {
    const peek: PreviousSetPeek = {
      kind: 'log',
      duration: 1800,
      action: { type: 'Done' },
    }
    expect(formatPreviousSetPeek(peek, cardioEx)).toBe('30 min · Done')
  })
})

// ─── mapSetLogError ───────────────────────────────────────────────────────────

describe('mapSetLogError', () => {
  it('AE7: SessionAlreadyCompleted code → halt + warning', () => {
    const result = mapSetLogError({
      ok: false,
      kind: 'forbidden_transition',
      code: 'SessionAlreadyCompleted',
    })
    expect(result.kind).toBe('halt')
    expect(result.toast.severity).toBe('warning')
  })

  it('DuplicateSetLog code → rehydrate', () => {
    const result = mapSetLogError({
      ok: false,
      kind: 'conflict',
      code: 'DuplicateSetLog',
    })
    expect(result.kind).toBe('rehydrate')
  })

  it('unknown code → rollback + error severity', () => {
    const result = mapSetLogError({
      ok: false,
      kind: 'conflict',
      code: 'UnknownError',
    })
    expect(result.kind).toBe('rollback')
    expect(result.toast.severity).toBe('error')
  })
})

// ─── mapUndoError ─────────────────────────────────────────────────────────────

describe('mapUndoError', () => {
  it('UndoBlockedBySessionCompleted code → halt', () => {
    const result = mapUndoError({
      ok: false,
      kind: 'forbidden_transition',
      code: 'UndoBlockedBySessionCompleted',
    })
    expect(result.kind).toBe('halt')
  })

  it('SessionAlreadyCompleted code → halt', () => {
    const result = mapUndoError({
      ok: false,
      kind: 'forbidden_transition',
      code: 'SessionAlreadyCompleted',
    })
    expect(result.kind).toBe('halt')
  })

  it('UndoBlockedByCommittedProgression code → rollback (defensive)', () => {
    const result = mapUndoError({
      ok: false,
      kind: 'forbidden_transition',
      code: 'UndoBlockedByCommittedProgression',
    })
    expect(result.kind).toBe('rollback')
  })

  it('unknown code → rollback', () => {
    const result = mapUndoError({
      ok: false,
      kind: 'conflict',
      code: 'UnknownError',
    })
    expect(result.kind).toBe('rollback')
  })
})

// ─── mapUpdateRoutineError ────────────────────────────────────────────────────

describe('mapUpdateRoutineError', () => {
  it('ValidationError → error toast about checking fields', () => {
    const result = mapUpdateRoutineError({
      ok: false,
      kind: 'validation',
      code: 'ValidationError',
    })
    expect(result.severity).toBe('error')
    expect(result.message).toMatch(/Check the highlighted/)
  })

  it('EditBlockedByActiveSession → warning toast about active workout', () => {
    const result = mapUpdateRoutineError({
      ok: false,
      kind: 'forbidden_transition',
      code: 'EditBlockedByActiveSession',
    })
    expect(result.severity).toBe('warning')
    expect(result.message).toMatch(/workout in progress/)
  })

  it('NotFoundError → warning toast about routine not existing', () => {
    const result = mapUpdateRoutineError({
      ok: false,
      kind: 'not_found',
      code: 'NotFoundError',
    })
    expect(result.severity).toBe('warning')
    expect(result.message).toMatch(/no longer exists/)
  })

  it('unknown code → generic error fallback', () => {
    const result = mapUpdateRoutineError({
      ok: false,
      kind: 'conflict',
      code: 'SomethingElse',
    })
    expect(result.severity).toBe('error')
    expect(result.message).toMatch(/Could not save changes/)
  })
})

// ---------------------------------------------------------------------------
// Helpers for the new formatter tests
// ---------------------------------------------------------------------------

function makeSetLog(
  overrides: Partial<SetLogRow> & { action: SetLogRow['action'] },
): SetLogRow {
  return {
    id: 1,
    sessionId: 1,
    exerciseId: 1,
    setNumber: 1,
    weight: null,
    targetReps: null,
    actualReps: null,
    durationSeconds: null,
    actualDurationSeconds: null,
    loggedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

function makeExercise(
  type: ExerciseRow['type'],
  overrides: Partial<ExerciseRow> = {},
): ExerciseRow {
  return {
    id: 1,
    routineId: 1,
    name: 'Test Exercise',
    type,
    orderInRoutine: 1,
    sets: 3,
    targetReps: type === 'weighted' || type === 'bodyweight' ? 10 : null,
    startingWeight: type === 'weighted' ? 100 : null,
    increment: type === 'weighted' ? 5 : null,
    durationSeconds: type === 'time-based' || type === 'cardio' ? 1800 : null,
    archivedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// formatWeight
// ---------------------------------------------------------------------------

describe('formatWeight', () => {
  it('formats an integer weight with lb suffix', () => {
    expect(formatWeight(105)).toBe('105 lb')
  })

  it('formats zero', () => {
    expect(formatWeight(0)).toBe('0 lb')
  })

  it('formats a larger weight', () => {
    expect(formatWeight(225)).toBe('225 lb')
  })
})

// ---------------------------------------------------------------------------
// formatJournalSessionDate
// ---------------------------------------------------------------------------

describe('formatJournalSessionDate', () => {
  // Pin to a mid-UTC-day instant to avoid tz-induced day-flip in CI.
  it('omits year for current-year dates', () => {
    // 2026-05-27 is a Wednesday; current year (per test suite) is 2026
    const at = new Date('2026-05-27T12:00:00Z')
    const result = formatJournalSessionDate(at)
    expect(result).toBe('Wed, May 27')
  })

  it('includes year for prior-year dates', () => {
    const at = new Date('2025-05-27T12:00:00Z')
    const result = formatJournalSessionDate(at)
    expect(result).toBe('Tue, May 27, 2025')
  })
})

// ---------------------------------------------------------------------------
// formatSetRow — weighted
// ---------------------------------------------------------------------------

describe('formatSetRow — weighted', () => {
  it('returns plain text for Increment action', () => {
    const setLog = makeSetLog({
      setNumber: 1,
      weight: 105,
      actualReps: 10,
      targetReps: 10,
      action: 'Increment',
    })
    const exercise = makeExercise('weighted')
    expect(formatSetRow(setLog, exercise)).toEqual({
      kind: 'plain',
      text: 'Set 1 — 105 × 10 · Increment',
    })
  })

  it('returns plain text for Complete action', () => {
    const setLog = makeSetLog({
      setNumber: 2,
      weight: 110,
      actualReps: 10,
      targetReps: 10,
      action: 'Complete',
    })
    const exercise = makeExercise('weighted')
    expect(formatSetRow(setLog, exercise)).toEqual({
      kind: 'plain',
      text: 'Set 2 — 110 × 10 · Complete',
    })
  })

  it('returns shortfall for Failed with actualReps < targetReps', () => {
    const setLog = makeSetLog({
      setNumber: 1,
      weight: 105,
      actualReps: 8,
      targetReps: 10,
      action: 'Failed',
    })
    const exercise = makeExercise('weighted')
    expect(formatSetRow(setLog, exercise)).toEqual({
      kind: 'shortfall',
      pre: 'Set 1 — ',
      fraction: '8/10',
      post: ' · Failed',
    })
  })

  it('returns plain for Failed when actualReps equals targetReps', () => {
    const setLog = makeSetLog({
      setNumber: 1,
      weight: 105,
      actualReps: 10,
      targetReps: 10,
      action: 'Failed',
    })
    const exercise = makeExercise('weighted')
    expect(formatSetRow(setLog, exercise)).toEqual({
      kind: 'plain',
      text: 'Set 1 — 105 × 10 · Failed',
    })
  })
})

// ---------------------------------------------------------------------------
// formatSetRow — bodyweight
// ---------------------------------------------------------------------------

describe('formatSetRow — bodyweight', () => {
  it('returns plain text for Complete action', () => {
    const setLog = makeSetLog({
      setNumber: 1,
      actualReps: 15,
      targetReps: 15,
      action: 'Complete',
    })
    const exercise = makeExercise('bodyweight')
    expect(formatSetRow(setLog, exercise)).toEqual({
      kind: 'plain',
      text: 'Set 1 — 15/15 · Complete',
    })
  })

  it('returns plain (NOT shortfall) for Failed', () => {
    const setLog = makeSetLog({
      setNumber: 1,
      actualReps: 12,
      targetReps: 15,
      action: 'Failed',
    })
    const exercise = makeExercise('bodyweight')
    expect(formatSetRow(setLog, exercise)).toEqual({
      kind: 'plain',
      text: 'Set 1 — 12/15 · Failed',
    })
  })
})

// ---------------------------------------------------------------------------
// formatSetRow — time-based
// ---------------------------------------------------------------------------

describe('formatSetRow — time-based', () => {
  it('AE4: returns plain for Hold using durationSeconds', () => {
    const setLog = makeSetLog({
      setNumber: 1,
      durationSeconds: 45,
      action: 'Hold',
    })
    const exercise = makeExercise('time-based', { durationSeconds: 45 })
    expect(formatSetRow(setLog, exercise)).toEqual({
      kind: 'plain',
      text: 'Set 1 — 45s · Hold',
    })
  })

  it('uses actualDurationSeconds when action is Failed', () => {
    const setLog = makeSetLog({
      setNumber: 1,
      durationSeconds: 45,
      actualDurationSeconds: 30,
      action: 'Failed',
    })
    const exercise = makeExercise('time-based', { durationSeconds: 45 })
    expect(formatSetRow(setLog, exercise)).toEqual({
      kind: 'plain',
      text: 'Set 1 — 30s · Failed',
    })
  })
})

// ---------------------------------------------------------------------------
// formatSetRow — cardio
// ---------------------------------------------------------------------------

describe('formatSetRow — cardio', () => {
  it('formats Done cardio', () => {
    const setLog = makeSetLog({
      setNumber: 1,
      durationSeconds: 1800,
      action: 'Done',
    })
    const exercise = makeExercise('cardio', { durationSeconds: 1800 })
    expect(formatSetRow(setLog, exercise)).toEqual({
      kind: 'plain',
      text: '30 min · Done',
    })
  })

  it('formats Skipped cardio', () => {
    const setLog = makeSetLog({
      setNumber: 1,
      durationSeconds: 1800,
      action: 'Skipped',
    })
    const exercise = makeExercise('cardio', { durationSeconds: 1800 })
    expect(formatSetRow(setLog, exercise)).toEqual({
      kind: 'plain',
      text: '30 min · Skipped',
    })
  })
})

// ---------------------------------------------------------------------------
// U4: formatRelativeDay
// ---------------------------------------------------------------------------

describe('formatRelativeDay', () => {
  // Pinned mid-day instants (PT noon) for TZ stability in CI (UTC) and dev (PT).
  // 2026-05-29T12:00:00-07:00 = 2026-05-29T19:00:00Z — all tests relative to this.
  const NOW = new Date('2026-05-29T19:00:00Z')

  it('same local calendar day → "Today"', () => {
    const earlier = new Date('2026-05-29T10:00:00-07:00') // same PT day, earlier
    expect(formatRelativeDay(earlier, NOW)).toBe('Today')
  })

  it('1 day ago → "Yesterday"', () => {
    const yesterday = new Date('2026-05-28T12:00:00-07:00')
    expect(formatRelativeDay(yesterday, NOW)).toBe('Yesterday')
  })

  it('3 days ago → "3d ago"', () => {
    const threeDays = new Date('2026-05-26T12:00:00-07:00')
    expect(formatRelativeDay(threeDays, NOW)).toBe('3d ago')
  })

  it('13 days ago → "13d ago" (boundary: still Nd)', () => {
    const thirteenDays = new Date('2026-05-16T12:00:00-07:00')
    expect(formatRelativeDay(thirteenDays, NOW)).toBe('13d ago')
  })

  it('14 days ago → "2w ago" (boundary: switches to Nw)', () => {
    const fourteenDays = new Date('2026-05-15T12:00:00-07:00')
    expect(formatRelativeDay(fourteenDays, NOW)).toBe('2w ago')
  })

  it('16 days ago → "2w ago"', () => {
    const sixteenDays = new Date('2026-05-13T12:00:00-07:00')
    expect(formatRelativeDay(sixteenDays, NOW)).toBe('2w ago')
  })

  it('60 days ago → a date string (not Nw ago)', () => {
    const sixtyDays = new Date('2026-03-30T12:00:00-07:00')
    const result = formatRelativeDay(sixtyDays, NOW)
    expect(result).not.toMatch(/ago/)
    expect(result.length).toBeGreaterThan(2) // some real date string
  })
})

describe('mapDeleteRoutineError', () => {
  it('RoutineHasHistory → error with history message', () => {
    const result = mapDeleteRoutineError({
      ok: false,
      kind: 'forbidden_transition',
      code: 'RoutineHasHistory',
    })
    expect(result.severity).toBe('error')
    expect(result.message).toMatch(/history/)
  })

  it('RoutineNotArchived → error with defensive message', () => {
    const result = mapDeleteRoutineError({
      ok: false,
      kind: 'forbidden_transition',
      code: 'RoutineNotArchived',
    })
    expect(result.severity).toBe('error')
    expect(result.message).toMatch(/archived/)
  })

  it('NotFoundError → benign warning (already deleted)', () => {
    const result = mapDeleteRoutineError({
      ok: false,
      kind: 'not_found',
      code: 'NotFoundError',
    })
    expect(result.severity).toBe('warning')
  })

  it('unknown code → generic fallback error', () => {
    const result = mapDeleteRoutineError({
      ok: false,
      kind: 'forbidden_transition',
      code: 'SomethingElse',
    })
    expect(result.severity).toBe('error')
    expect(result.message).toMatch(/Try again/)
  })
})

describe('mapUnarchiveRoutineError', () => {
  it('NotFoundError → benign warning (already gone)', () => {
    const result = mapUnarchiveRoutineError({
      ok: false,
      kind: 'not_found',
      code: 'NotFoundError',
    })
    expect(result.severity).toBe('warning')
  })

  it('unknown code → generic fallback error', () => {
    const result = mapUnarchiveRoutineError({
      ok: false,
      kind: 'forbidden_transition',
      code: 'SomethingUnexpected',
    })
    expect(result.severity).toBe('error')
    expect(result.message).toMatch(/Try again/)
  })
})

// ---------------------------------------------------------------------------
// formatSessionDuration
// ---------------------------------------------------------------------------

function makeDate(isoString: string): Date {
  return new Date(isoString)
}

describe('formatSessionDuration', () => {
  it('returns "47m" for a 47-minute session', () => {
    const start = makeDate('2026-01-01T10:00:00Z')
    const end = makeDate('2026-01-01T10:47:00Z')
    expect(formatSessionDuration(start, end)).toBe('47m')
  })

  it('returns "1h 12m" for a 72-minute session', () => {
    const start = makeDate('2026-01-01T10:00:00Z')
    const end = makeDate('2026-01-01T11:12:00Z')
    expect(formatSessionDuration(start, end)).toBe('1h 12m')
  })

  it('returns seconds for sub-minute sessions', () => {
    const start = makeDate('2026-01-01T10:00:00Z')
    const end = makeDate('2026-01-01T10:00:52Z')
    expect(formatSessionDuration(start, end)).toBe('52s')
  })

  it('returns "0m" when completedAt equals startedAt', () => {
    const d = makeDate('2026-01-01T10:00:00Z')
    expect(formatSessionDuration(d, d)).toBe('0m')
  })

  it('returns "0m" for negative delta', () => {
    const start = makeDate('2026-01-01T10:01:00Z')
    const end = makeDate('2026-01-01T10:00:00Z')
    expect(formatSessionDuration(start, end)).toBe('0m')
  })

  it('returns "1h 0m" for exactly 60 minutes', () => {
    const start = makeDate('2026-01-01T10:00:00Z')
    const end = makeDate('2026-01-01T11:00:00Z')
    expect(formatSessionDuration(start, end)).toBe('1h 0m')
  })
})

// ---------------------------------------------------------------------------
// mapDeleteSessionError
// ---------------------------------------------------------------------------

describe('mapDeleteSessionError', () => {
  it('SessionHasProgression → error with progression message', () => {
    const result = mapDeleteSessionError({
      ok: false,
      kind: 'forbidden_transition',
      code: 'SessionHasProgression',
    })
    expect(result.severity).toBe('error')
    expect(result.message).toMatch(/progression/)
  })

  it('SessionNotCompleted → error with completed message', () => {
    const result = mapDeleteSessionError({
      ok: false,
      kind: 'forbidden_transition',
      code: 'SessionNotCompleted',
    })
    expect(result.severity).toBe('error')
    expect(result.message).toMatch(/completed/i)
  })

  it('NotFoundError → warning', () => {
    const result = mapDeleteSessionError({
      ok: false,
      kind: 'not_found',
      code: 'NotFoundError',
    })
    expect(result.severity).toBe('warning')
    expect(result.message).toMatch(/not found/i)
  })

  it('unknown code → generic fallback', () => {
    const result = mapDeleteSessionError({
      ok: false,
      kind: 'forbidden_transition',
      code: 'SomethingUnexpected',
    })
    expect(result.severity).toBe('error')
    expect(result.message).toMatch(/Try again/)
  })
})
